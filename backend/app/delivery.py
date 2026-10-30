import secrets
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, update
from .db import get_db
from .models import Order, Household, Notification, now
from .security import roles, digest, audit
from .orders import visible_order, notify
from .models_ext import DeliveryIssue, DeliveryRejection
from pydantic import BaseModel, Field
from datetime import timedelta

router = APIRouter(prefix="/driver", tags=["delivery"])


def qualified(user):
    if not user.driver_verified:
        raise HTTPException(403, "حساب السائق ينتظر مراجعة الإدارة")


@router.post("/availability")
def availability(available: bool, user=Depends(roles("driver")), db=Depends(get_db)):
    qualified(user)
    user.available = available
    db.commit()
    return {"available": available}


@router.get("/offers")
def offers(user=Depends(roles("driver")), db=Depends(get_db)):
    qualified(user)
    if not user.available:
        return []
    rejected = select(DeliveryRejection.order_id).where(DeliveryRejection.driver_id == user.id)
    items = db.scalars(
        select(Order)
        .where(
            Order.delivery_method == "paid",
            Order.status == "ready",
            Order.driver_id.is_(None),
            Order.offer_expires_at > now(),
            Order.id.not_in(rejected),
        )
        .limit(30)
    )
    return [
        {
            "id": o.id,
            "city": db.get(Household, o.household_id).city,
            "scheduled_at": o.scheduled_at,
            "fee": o.delivery_fee,
            "expires_at": o.offer_expires_at,
            "source": "test",
        }
        for o in items
    ]


@router.post("/offers/{order_id}/accept")
def accept(order_id: str, user=Depends(roles("driver")), db=Depends(get_db)):
    qualified(user)
    if not user.available:
        raise HTTPException(409, "فعّل التوفر أولًا")
    active = db.scalar(select(Order).where(Order.driver_id == user.id, Order.status.in_(["assigned", "picked_up", "in_transit"])))
    if active:
        raise HTTPException(409, "أكمل رحلتك الحالية أولًا")
    # Lock the driver row as well on PostgreSQL to prevent accepting two concurrent offers.
    from .models import User

    db.scalar(select(User).where(User.id == user.id).with_for_update())
    active = db.scalar(select(Order).where(Order.driver_id == user.id, Order.status.in_(["assigned", "picked_up", "in_transit"])))
    if active:
        raise HTTPException(409, "لديك رحلة نشطة")
    claimed = db.execute(
        update(User)
        .where(
            User.id == user.id,
            User.active_trip_id.is_(None),
            User.available.is_(True),
            User.active.is_(True),
            User.driver_verified.is_(True),
        )
        .values(active_trip_id=order_id)
    )
    if claimed.rowcount != 1:
        raise HTTPException(409, "لديك رحلة نشطة أو تغير توفرك")
    code = str(secrets.randbelow(900000) + 100000)
    pickup_code = str(secrets.randbelow(900000) + 100000)
    result = db.execute(
        update(Order)
        .where(
            Order.id == order_id,
            Order.status == "ready",
            Order.delivery_method == "paid",
            Order.driver_id.is_(None),
            Order.offer_expires_at > now(),
        )
        .values(driver_id=user.id, status="assigned", delivery_code_hash=digest(code), pickup_code_hash=digest(pickup_code))
    )
    if result.rowcount != 1:
        raise HTTPException(409, "العرض لم يعد متاحًا")
    order = db.get(Order, order_id)
    db.add(Notification(user_id=order.customer_id, message="رمز إثبات التسليم لطلب " + order.id[:8] + ": " + code))
    h = db.get(Household, order.household_id)
    db.add(Notification(user_id=h.owner_id, message="رمز إثبات الاستلام من الأسرة لطلب " + order.id[:8] + ": " + pickup_code))
    audit(db, user, "delivery.accept", order.id)
    db.commit()
    return {"ok": True}


@router.get("/trips/{order_id}")
def trip(order_id: str, user=Depends(roles("driver")), db=Depends(get_db)):
    qualified(user)
    order = visible_order(db, order_id, user)
    if order.driver_id != user.id:
        raise HTTPException(404, "الرحلة غير موجودة")
    h = db.get(Household, order.household_id)
    return {"id": order.id, "pickup_address": h.pickup_address, "address": order.address, "status": order.status, "fee": order.delivery_fee}


@router.post("/trips/{order_id}/transition")
def trip_transition(order_id: str, state: str, code: str = "", user=Depends(roles("driver")), db=Depends(get_db)):
    qualified(user)
    order = visible_order(db, order_id, user, lock=True)
    if (
        order.driver_id != user.id
        or {"assigned": "picked_up", "picked_up": "in_transit", "in_transit": "delivered"}.get(order.status) != state
    ):
        raise HTTPException(409, "انتقال الرحلة غير مسموح")
    if state in {"picked_up", "delivered"}:
        from .security import limit

        limit("proof:" + order.id, 8, 300)
        expected = order.pickup_code_hash if state == "picked_up" else order.delivery_code_hash
        if not secrets.compare_digest(expected or "", digest(code)):
            raise HTTPException(422, "رمز إثبات الاستلام أو التسليم غير صحيح")
    order.status = state
    if state == "delivered":
        user.active_trip_id = None
    notify(db, order, "تحديث التوصيل: " + state)
    audit(db, user, "delivery." + state, order.id)
    db.commit()
    return {"ok": True}


@router.post("/offers/{order_id}/reject")
def reject(order_id: str, user=Depends(roles("driver")), db=Depends(get_db)):
    qualified(user)
    order = db.get(Order, order_id)
    if not order or order.status != "ready" or order.driver_id:
        raise HTTPException(409, "العرض غير متاح")
    if not db.get(DeliveryRejection, (order.id, user.id)):
        db.add(DeliveryRejection(order_id=order.id, driver_id=user.id))
        audit(db, user, "delivery.reject", order.id)
        db.commit()
    return {"ok": True}


class IssueInput(BaseModel):
    reason: str = Field(min_length=10, max_length=1000)


@router.post("/trips/{order_id}/issue", status_code=201)
def issue(order_id: str, data: IssueInput, user=Depends(roles("driver")), db=Depends(get_db)):
    qualified(user)
    order = visible_order(db, order_id, user, lock=True)
    if order.driver_id != user.id or order.status not in {"assigned", "picked_up", "in_transit"}:
        raise HTTPException(409, "لا يمكن تسجيل تعثر لهذه الرحلة")
    db.add(DeliveryIssue(order_id=order.id, driver_id=user.id, reason=data.reason, resolved=order.status == "assigned"))
    if order.status == "assigned":
        order.driver_id, order.status, order.delivery_code_hash, order.pickup_code_hash = None, "ready", None, None
        order.offer_expires_at = now() + timedelta(minutes=15)
        user.active_trip_id = None
        if not db.get(DeliveryRejection, (order.id, user.id)):
            db.add(DeliveryRejection(order_id=order.id, driver_id=user.id))
        notify(db, order, "تعذر حضور السائق؛ يجري عرض الطلب لسائق آخر")
    else:
        notify(db, order, "أبلغ السائق عن مشكلة؛ الإدارة تتابع الرحلة")
    audit(db, user, "delivery.issue", order.id)
    db.commit()
    return {"ok": True}
