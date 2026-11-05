import json
from datetime import timedelta, timezone
from zoneinfo import ZoneInfo
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from .db import get_db
from .models import Order, OrderItem, Product, Household, Notification, Review, User, now, Plan
from .schemas import Checkout, ReviewInput
from .security import current_user, roles, household, audit, digest
from .providers import TestDeliveryProvider, require_payment_enabled
from .config import settings
from .scheduling import reserve, release
from .models_ext import ScheduleSlot, DriverPosition
from .catalog import subscription_lapsed

CUSTOMER_SERVICE_FEE = 150  # 1.50 SAR in Halalas
HOUSEHOLD_FEE_RATE = 0.02   # 2.0% for 49 SAR households
RESTAURANT_FEE_RATE = 0.035 # 3.5% for 199 SAR official restaurants

def merchant_fee_rate_for_household(db, household_id: str) -> float:
    h = db.get(Household, household_id)
    if h and h.plan_id:
        plan = db.get(Plan, h.plan_id)
        if plan and (plan.monthly_price >= 19900 or "نخبة" in plan.name or "مطاعم" in plan.name):
            return RESTAURANT_FEE_RATE
    return HOUSEHOLD_FEE_RATE


def fee_split(db, h, subtotal, delivery_fee, quote_info):
    """One place for the price the customer pays and how it is divided; stored on the order at checkout."""
    rate = merchant_fee_rate_for_household(db, h.id)
    merchant_fee = int(round(subtotal * rate))
    return {
        "service_fee": CUSTOMER_SERVICE_FEE,
        "delivery_margin": int((quote_info or {}).get("platform_margin") or 0),
        "merchant_fee_rate": rate,
        "merchant_fee": merchant_fee,
        "merchant_payout": subtotal - merchant_fee,
        "total": subtotal + delivery_fee + CUSTOMER_SERVICE_FEE,
    }


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
    h = db.get(Household, order.household_id)
    family_side = user.role == "admin" or (user.role == "seller" and h.owner_id == user.id)
    # The family's home is shared with the customer only once the order is paid, never on a mere request.
    if (order.delivery_method == "pickup" and (family_side or (user.id == order.customer_id and order.payment_status == "paid"))) or (
        order.driver_id == user.id
    ):
        result["pickup_address"] = h.pickup_address
        result["pickup_latitude"], result["pickup_longitude"] = h.pickup_latitude, h.pickup_longitude
    result["service_fee"] = order.service_fee
    if family_side:
        result["merchant_fee"] = order.merchant_fee
        result["merchant_fee_rate"] = round(order.merchant_fee / order.subtotal, 4) if order.subtotal else 0
        result["merchant_payout"] = order.subtotal - order.merchant_fee
    if user.role == "admin" or order.driver_id == user.id:
        result["driver_fee"] = order.delivery_fee - order.delivery_margin
    return result


def family_telegram(db, order, text):
    """Alerts a family on its linked Telegram account for the events it must act on."""
    h = db.get(Household, order.household_id)
    if h and h.telegram_user_id and settings.telegram_bot_token:
        from .telegram import queue

        queue(db, h.telegram_user_id, f"{text} • {order.id[:8]}\n{settings.public_origin}/orders/{order.id}")


def notify(db, order, text):
    h = db.get(Household, order.household_id)
    db.add(Notification(user_id=order.customer_id, message=text + " • " + order.id[:8]))
    db.add(Notification(user_id=h.owner_id, message=text + " • " + order.id[:8]))
    try:
        from .order_chat import trigger_order_chat_status_event
        trigger_order_chat_status_event(db, order, order.status, extra=text if text and not text.startswith("تحديث حالة الطلب") else None)
    except Exception:
        pass


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
    if data.delivery_method == "pickup" and not getattr(h, "pickup_enabled", True):
        raise HTTPException(422, "هذه الأسرة لا تتيح خيار الاستلام من المنزل؛ يتوفر التوصيل فقط")
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
            dist = 5.0
            if (
                data.latitude is not None
                and data.longitude is not None
                and h.pickup_latitude is not None
                and h.pickup_longitude is not None
            ):
                from .delivery import distance_km

                dist = round(distance_km(data.latitude, data.longitude, h.pickup_latitude, h.pickup_longitude), 1)

            if dist > rule.max_km:
                raise HTTPException(422, "المسافة تتجاوز الحد الأقصى للتوصيل المدعوم")

            # Al-Darb Platform Margin Rule:
            # - Delivery fee under 10 SAR (< 1000 Halalas): Platform margin = 0 SAR (driver gets 100%)
            # - Delivery fee 10 SAR or higher (>= 1000 Halalas): Platform margin = 2.50 SAR (250 Halalas)
            raw_driver_fee = rule.base_fee + int(dist * rule.per_km)
            if raw_driver_fee < 1000:
                platform_margin = 0
                fee = raw_driver_fee
            else:
                platform_margin = 250
                fee = raw_driver_fee + platform_margin
            driver_fee = raw_driver_fee
            quote["fee"] = fee
            quote["driver_fee"] = driver_fee
            quote["platform_margin"] = platform_margin
            quote["breakdown"] = f"توصيل ({dist} كم): {driver_fee / 100:.2f} ر.س للكابتن + {platform_margin / 100:.2f} ر.س هامش المنصة"
        else:
            fee = quote["fee"]
    subtotal = sum(quantity * unit for p, quantity, unit, option_id, option_label in price_lines(products, data.items))
    if subtotal + fee > 2147483647:
        raise HTTPException(422, "قيمة الطلب تتجاوز الحد المدعوم؛ قسمه إلى طلبات أصغر")
    return products, h, scheduled, subtotal, fee, quote


@router.post("/checkout/quote")
def quote(data: Checkout, user=Depends(roles("customer")), db=Depends(get_db)):
    products, h, scheduled, subtotal, fee, quote_info = calculate(db, data)
    split = fee_split(db, h, subtotal, fee, quote_info)
    return {
        "subtotal": subtotal,
        "delivery_fee": fee,
        "service_fee": split["service_fee"],
        "total": split["total"],
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
    require_payment_enabled()
    if settings.require_email_verification and not user.email_verified:
        raise HTTPException(403, "أكد بريدك الإلكتروني قبل إنشاء الطلب")
    fingerprint = digest(json.dumps(data.model_dump(mode="json", exclude={"idempotency_key", "quoted_total"}), sort_keys=True))
    existing = db.scalar(select(Order).where(Order.customer_id == user.id, Order.idempotency_key == data.idempotency_key))
    if existing:
        if existing.request_hash != fingerprint:
            raise HTTPException(409, "مفتاح التكرار مستخدم لطلب مختلف")
        return order_json(db, existing, user)
    products, h, scheduled, subtotal, fee, quote_info = calculate(db, data)
    split = fee_split(db, h, subtotal, fee, quote_info)
    total = split["total"]
    if data.quoted_total is not None and data.quoted_total != total:
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
        total=total,
        service_fee=split["service_fee"],
        delivery_margin=split["delivery_margin"],
        merchant_fee=split["merchant_fee"],
        status="pending_acceptance",
        payment_status="unpaid",
        payment_expires_at=now() + timedelta(hours=24),
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
        db.add(Notification(user_id=h.owner_id, message="طلب جديد بانتظار موافقتك • " + order.id[:8]))
        family_telegram(db, order, "🛎️ طلب جديد بانتظار موافقتك")
        try:
            from .order_chat import trigger_order_chat_status_event
            trigger_order_chat_status_event(db, order, "pending_acceptance")
        except Exception:
            pass
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
    if old == state and state != "cancelled":
        return order_json(db, order, user)
    if state == "cancelled":
        valid = (order.customer_id == user.id and old in {"pending_payment", "pending_acceptance", "confirmed"}) or (
            seller and old in {"pending_acceptance", "pending_payment", "confirmed"}
        )
    elif seller:
        allowed = {
            "pending_acceptance": "pending_payment",
            "confirmed": "preparing",
            "preparing": "ready",
        }
        # "confirmed" is reached only through a recorded payment, never by the family.
        valid = allowed.get(old) == state
        if old == "ready" and order.delivery_method == "pickup" and state == "completed":
            valid = True
        if order.delivery_method == "free":
            valid = valid or {"ready": "in_transit", "in_transit": "delivered"}.get(old) == state
    if not valid:
        raise HTTPException(409, "انتقال الحالة غير مسموح")
    updates = {"status": state}
    if state == "pending_payment":
        updates["payment_expires_at"] = now() + timedelta(minutes=30)
    changed = db.execute(update(Order).where(Order.id == order.id, Order.status == old).values(**updates))
    if changed.rowcount != 1:
        raise HTTPException(409, "تغيرت حالة الطلب؛ أعد المحاولة")
    order.status = state
    if "payment_expires_at" in updates:
        order.payment_expires_at = updates["payment_expires_at"]
    if state == "cancelled":
        restore_stock(db, order)
        if order.payment_status == "paid":
            order.payment_status = "refund_pending"
        if user.id == order.customer_id:
            family_telegram(db, order, "❌ ألغى العميل الطلب")
    if state == "pending_payment":
        notify(db, order, "وافقت الأسرة على طلبك! يرجى إتمام الدفع لبدء التحضير")
    elif state == "ready" and order.delivery_method == "paid":
        order.offer_expires_at = now() + timedelta(minutes=15)
        notify(db, order, "الطلب جاهز للتسليم")
    else:
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
