import json
from datetime import timedelta, timezone
from zoneinfo import ZoneInfo
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from .db import get_db
from .models import Order, OrderItem, Product, Household, Notification, Review, User, now
from .schemas import Checkout, ReviewInput
from .security import current_user, roles, household, audit, digest
from .providers import TestDeliveryProvider, require_test_payment
from .config import settings
from .scheduling import reserve, release
from .models_ext import ScheduleSlot, DriverPosition
from .catalog import subscription_lapsed

router = APIRouter(tags=["orders"])
SAUDI = ZoneInfo("Asia/Riyadh")


def visible_order(db, order_id, user, lock=False):
    query = select(Order).where(Order.id == order_id)
    if lock:
        query = query.with_for_update()
    order = db.scalar(query)
    h = db.get(Household, order.household_id) if order else None
    if not order or not (
        user.role == "admin"
        or order.customer_id == user.id
        or (user.role == "seller" and h.owner_id == user.id)
        or order.driver_id == user.id
    ):
        raise HTTPException(404, "الطلب غير موجود")
    return order


def order_json(db, order, user):
    result = {
        k: getattr(order, k)
        for k in [
            "id",
            "household_id",
            "status",
            "payment_status",
            "delivery_method",
            "scheduled_at",
            "subtotal",
            "delivery_fee",
            "total",
            "refunded",
            "created_at",
            "driver_id",
            "latitude",
            "longitude",
        ]
    }
    result["household_name"] = db.get(Household, order.household_id).name
    result["items"] = [
        {
            "product_id": i.product_id,
            "name": i.name,
            "quantity": i.quantity,
            "unit_price": i.unit_price,
            "option_id": i.option_id,
            "option_label": i.option_label,
        }
        for i in db.scalars(select(OrderItem).where(OrderItem.order_id == order.id))
    ]
    if user.id == order.customer_id or user.role in {"seller", "admin"} or order.driver_id == user.id:
        result["address"] = order.address
    if (order.delivery_method == "pickup" and order.payment_status == "paid") or order.driver_id == user.id:
        h = db.get(Household, order.household_id)
        result["pickup_address"] = h.pickup_address
        result["pickup_latitude"], result["pickup_longitude"] = h.pickup_latitude, h.pickup_longitude
    return result


def notify(db, order, text):
    h = db.get(Household, order.household_id)
    db.add(Notification(user_id=order.customer_id, message=text + " • " + order.id[:8]))
    db.add(Notification(user_id=h.owner_id, message=text + " • " + order.id[:8]))


def restore_stock(db, order):
    for item in db.scalars(select(OrderItem).where(OrderItem.order_id == order.id)):
        db.execute(update(Product).where(Product.id == item.product_id).values(stock=Product.stock + item.quantity))
    release(db, order)


def quantities_for(items):
    result = {}
    for item in items:
        result[item.product_id] = result.get(item.product_id, 0) + item.quantity
    return result


def price_lines(products, items):
    by_id = {p.id: p for p in products}
    result = []
    for item in items:
        p = by_id[item.product_id]
        options = {o["id"]: o for o in p.options}
        option = options.get(item.option_id)
        if (options and not option) or (not options and item.option_id):
            raise HTTPException(422, "اختر خيارًا صحيحًا للمنتج")
        unit = p.price + (option["price_delta"] if option else 0)
        if unit < 100:
            raise HTTPException(422, "سعر خيار المنتج غير صالح")
        result.append((p, item.quantity, unit, item.option_id, option["name"] if option else ""))
    return result


def calculate(db, data):
    ids = list({i.product_id for i in data.items})
    keys = [(i.product_id, i.option_id) for i in data.items]
    if len(set(keys)) != len(keys):
        raise HTTPException(422, "اجمع كميات المنتج في بند واحد")
    products = list(db.scalars(select(Product).where(Product.id.in_(ids)).order_by(Product.id).with_for_update()))
    if len(products) != len(ids) or any(p.status != "published" for p in products):
        raise HTTPException(409, "أحد المنتجات لم يعد متاحًا")
    households = {p.household_id for p in products}
    if len(households) != 1:
        raise HTTPException(409, "السلة مخصصة لأسرة واحدة؛ أكمل طلبك ثم اطلب من الأسرة الأخرى")
    h = db.get(Household, next(iter(households)))
    if not h.verified or h.on_vacation or subscription_lapsed(h) or not db.get(User, h.owner_id).active:
        raise HTTPException(409, "الأسرة غير متاحة لاستقبال الطلبات")
    quantities = quantities_for(data.items)
    if any(p.stock < quantities[p.id] for p in products):
        raise HTTPException(409, "الكمية المطلوبة غير متوفرة")
    scheduled = data.scheduled_at
    if not scheduled.tzinfo:
        raise HTTPException(422, "الموعد يجب أن يتضمن المنطقة الزمنية")
    try:
        scheduled = scheduled.astimezone(timezone.utc).replace(tzinfo=None)
    except (OverflowError, ValueError):
        raise HTTPException(422, "الموعد خارج النطاق المدعوم") from None
    if scheduled < now() + timedelta(hours=max(p.prep_hours for p in products)) or scheduled > now() + timedelta(days=30):
        raise HTTPException(422, "اختر موعدًا بعد مدة التجهيز وخلال 30 يومًا")
    local = scheduled.replace(tzinfo=timezone.utc).astimezone(SAUDI)
    if not h.opening_hour <= local.hour < h.closing_hour:
        raise HTTPException(422, "الموعد خارج أوقات عمل الأسرة")
    bucket = scheduled.replace(minute=0, second=0, microsecond=0)
    occupied = db.scalar(select(ScheduleSlot).where(ScheduleSlot.household_id == h.id, ScheduleSlot.starts_at == bucket))
    if occupied and occupied.reserved >= h.slot_capacity:
        raise HTTPException(409, "اكتملت سعة هذا الموعد")
    if (data.latitude is None) != (data.longitude is None):
        raise HTTPException(422, "حدد إحداثيي الموقع معًا")
    fee, quote = 0, None
    if data.delivery_method != "pickup" and len(data.address.strip()) < 10:
        raise HTTPException(422, "أدخل عنوان التوصيل بالتفصيل")
    if data.delivery_method == "free" and not h.free_delivery:
        raise HTTPException(422, "هذه الأسرة لا تقدم توصيلًا مجانيًا")
    if data.delivery_method == "paid":
        if not h.delivery_enabled:
            raise HTTPException(422, "التوصيل المدفوع غير متاح")
        quote = TestDeliveryProvider().quote("paid")
        from .models import DeliveryRule

        rule = db.get(DeliveryRule, 1)
        if rule:
            if rule.max_km < 5:
                raise HTTPException(422, "المسافة التجريبية خارج نطاق قاعدة التوصيل")
            fee = rule.base_fee + 5 * rule.per_km
            quote["fee"] = fee
            quote["breakdown"] = f"تجريبي: {rule.base_fee / 100} أساس + 5 كم افتراضية × {rule.per_km / 100}"
        else:
            fee = quote["fee"]
    subtotal = sum(quantity * unit for p, quantity, unit, option_id, option_label in price_lines(products, data.items))
    if subtotal + fee > 2147483647:
        raise HTTPException(422, "قيمة الطلب تتجاوز الحد المدعوم؛ قسمه إلى طلبات أصغر")
    return products, h, scheduled, subtotal, fee, quote


@router.post("/checkout/quote")
def quote(data: Checkout, user=Depends(roles("customer")), db=Depends(get_db)):
    products, h, scheduled, subtotal, fee, quote_info = calculate(db, data)
    return {
        "subtotal": subtotal,
        "delivery_fee": fee,
        "total": subtotal + fee,
        "quote": quote_info,
        "household_name": h.name,
        "scheduled_at": scheduled,
        "items": [
            {
                "product_id": p.id,
                "name": p.name,
                "quantity": quantity,
                "unit_price": unit,
                "option_id": option_id,
                "option_label": option_label,
            }
            for p, quantity, unit, option_id, option_label in price_lines(products, data.items)
        ],
    }


@router.post("/orders", status_code=201)
def checkout(data: Checkout, user=Depends(roles("customer")), db=Depends(get_db)):
    require_test_payment()
    if settings.require_email_verification and not user.email_verified:
        raise HTTPException(403, "أكد بريدك الإلكتروني قبل إنشاء الطلب")
    fingerprint = digest(json.dumps(data.model_dump(mode="json", exclude={"idempotency_key", "quoted_total"}), sort_keys=True))
    existing = db.scalar(select(Order).where(Order.customer_id == user.id, Order.idempotency_key == data.idempotency_key))
    if existing:
        if existing.request_hash != fingerprint:
            raise HTTPException(409, "مفتاح التكرار مستخدم لطلب مختلف")
        return order_json(db, existing, user)
    products, h, scheduled, subtotal, fee, quote_info = calculate(db, data)
    if data.quoted_total is not None and data.quoted_total != subtotal + fee:
        raise HTTPException(409, "تغير السعر أو رسوم التسليم؛ راجع الإجمالي الجديد قبل إنشاء الطلب")
    order = Order(
        customer_id=user.id,
        household_id=h.id,
        idempotency_key=data.idempotency_key,
        request_hash=fingerprint,
        delivery_method=data.delivery_method,
        address=data.address.strip() if data.delivery_method != "pickup" else "",
        scheduled_at=scheduled,
        subtotal=subtotal,
        delivery_fee=fee,
        total=subtotal + fee,
        payment_expires_at=now() + timedelta(minutes=20),
        latitude=data.latitude if data.delivery_method != "pickup" else None,
        longitude=data.longitude if data.delivery_method != "pickup" else None,
    )
    db.add(order)
    try:
        order.slot_id = reserve(db, h, scheduled)
        db.flush()
        quantities = quantities_for(data.items)
        for p in sorted(products, key=lambda x: x.id):
            quantity = quantities[p.id]
            changed = db.execute(
                update(Product)
                .where(Product.id == p.id, Product.status == "published", Product.stock >= quantity)
                .values(stock=Product.stock - quantity)
            )
            if changed.rowcount != 1:
                raise HTTPException(409, "نفدت الكمية أثناء إتمام الطلب")
        for p, quantity, unit, option_id, option_label in price_lines(products, data.items):
            db.add(
                OrderItem(
                    order_id=order.id,
                    product_id=p.id,
                    name=p.name,
                    unit_price=unit,
                    quantity=quantity,
                    option_id=option_id,
                    option_label=option_label,
                )
            )
        audit(db, user, "order.create", order.id)
        if quote_info:
            audit(db, user, "delivery.quote.test", order.id)
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = db.scalar(select(Order).where(Order.customer_id == user.id, Order.idempotency_key == data.idempotency_key))
        if not existing or existing.request_hash != fingerprint:
            raise HTTPException(409, "تعارض الطلب؛ أعد تحميل السلة") from None
        return order_json(db, existing, user)
    return order_json(db, order, user)


@router.get("/orders")
def list_orders(user=Depends(current_user), db=Depends(get_db)):
    statement = select(Order)
    if user.role == "customer":
        statement = statement.where(Order.customer_id == user.id)
    elif user.role == "seller":
        statement = statement.where(Order.household_id == household(db, user).id)
    elif user.role == "driver":
        statement = statement.where(Order.driver_id == user.id)
    return [order_json(db, o, user) for o in db.scalars(statement.order_by(Order.created_at.desc()).limit(100))]


@router.get("/orders/{order_id}")
def get_order(order_id: str, user=Depends(current_user), db=Depends(get_db)):
    return order_json(db, visible_order(db, order_id, user), user)


@router.post("/orders/{order_id}/transition")
def transition(order_id: str, state: str, user=Depends(current_user), db=Depends(get_db)):
    order = visible_order(db, order_id, user, lock=True)
    old = order.status
    seller = user.role == "seller" and household(db, user).id == order.household_id
    valid = False
    if state == "cancelled":
        valid = (order.customer_id == user.id and old in {"pending_payment", "pending_acceptance", "confirmed"}) or (
            seller and old in {"pending_acceptance", "confirmed"}
        )
    elif seller:
        allowed = {"pending_acceptance": "confirmed", "confirmed": "preparing", "preparing": "ready"}
        valid = allowed.get(old) == state
        if old == "ready" and order.delivery_method == "pickup" and state == "completed":
            valid = True
        if order.delivery_method == "free":
            valid = valid or {"ready": "in_transit", "in_transit": "delivered"}.get(old) == state
    if not valid:
        raise HTTPException(409, "انتقال الحالة غير مسموح")
    changed = db.execute(update(Order).where(Order.id == order.id, Order.status == old).values(status=state))
    if changed.rowcount != 1:
        raise HTTPException(409, "تغيرت حالة الطلب؛ أعد المحاولة")
    if state == "cancelled":
        restore_stock(db, order)
        if order.payment_status == "paid":
            order.payment_status = "refund_pending"
    if state == "ready" and order.delivery_method == "paid":
        order.offer_expires_at = now() + timedelta(minutes=15)
    notify(db, order, "تحديث حالة الطلب: " + state)
    audit(db, user, "order." + state, order.id)
    db.commit()
    db.refresh(order)
    return order_json(db, order, user)


# The driver's location is shared from acceptance until delivery, never before or after.
TRACKED = {"assigned", "picked_up", "in_transit"}


@router.get("/orders/{order_id}/driver-location")
def driver_location(order_id: str, user=Depends(current_user), db=Depends(get_db)):
    order = visible_order(db, order_id, user)
    if order.delivery_method != "paid" or order.status not in TRACKED or not order.driver_id:
        raise HTTPException(404, "موقع السائق يظهر أثناء التوصيل فقط")
    position = db.get(DriverPosition, order.driver_id)
    h = db.get(Household, order.household_id)
    result = {"status": order.status, "driver": None, "pickup": None, "dropoff": None}
    if position:
        result["driver"] = {
            "latitude": position.latitude,
            "longitude": position.longitude,
            "accuracy": position.accuracy,
            "updated_at": position.updated_at,
            "stale": position.updated_at < now() - timedelta(minutes=5),
        }
    if order.latitude is not None and order.longitude is not None:
        result["dropoff"] = {"latitude": order.latitude, "longitude": order.longitude}
    # Customers of paid deliveries never receive the family's exact pickup point.
    if user.id != order.customer_id and h.pickup_latitude is not None and h.pickup_longitude is not None:
        result["pickup"] = {"latitude": h.pickup_latitude, "longitude": h.pickup_longitude}
    return result


@router.post("/orders/{order_id}/review", status_code=201)
def review(order_id: str, data: ReviewInput, user=Depends(roles("customer")), db=Depends(get_db)):
    order = visible_order(db, order_id, user)
    if order.customer_id != user.id or order.status not in {"completed", "delivered"}:
        raise HTTPException(409, "يمكن التقييم بعد استلام الطلب فقط")
    if db.scalar(select(Review).where(Review.order_id == order.id)):
        raise HTTPException(409, "تم تقييم هذا الطلب")
    db.add(Review(order_id=order.id, customer_id=user.id, household_id=order.household_id, **data.model_dump()))
    db.commit()
    return {"ok": True}
