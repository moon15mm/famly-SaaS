from datetime import timedelta, timezone
from zoneinfo import ZoneInfo
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select, func, update, or_
from .db import get_db
from .models import Product, Household, Order, Outbox, now
from .models_ext import DataRequest, Invoice, DeliveryIssue
from .security import roles, audit, current_user, household
from .catalog import product_json, validate_product, sync_media
from .schemas import ProductInput

router = APIRouter(tags=["extended administration"])


@router.get("/admin/products")
def products(user=Depends(roles("admin")), db=Depends(get_db)):
    return [
        product_json(p, h) for p, h in db.execute(select(Product, Household).join(Household).order_by(Product.created_at.desc()).limit(500))
    ]


class ProductState(BaseModel):
    status: str = Field(pattern=r"^(published|draft|paused)$")
    featured: bool = False


@router.post("/admin/products/{product_id}/status")
def product_status(product_id: str, data: ProductState, user=Depends(roles("admin")), db=Depends(get_db)):
    p = db.get(Product, product_id)
    if not p:
        raise HTTPException(404, "المنتج غير موجود")
    if p.status == "archived":
        raise HTTPException(409, "حذفت الأسرة هذا المنتج؛ لا يعاد نشره من الإدارة")
    h = db.get(Household, p.household_id)
    fields = {k: getattr(p, k) for k in ProductInput.model_fields}
    fields["status"] = data.status
    if data.status == "published":
        validate_product(db, h, ProductInput(**fields))
    p.status, p.featured = data.status, data.featured
    sync_media(db, h)
    audit(db, user, "admin.product." + data.status, p.id)
    db.commit()
    return product_json(p, h)


def financial_report(db, household_id=None):
    statement = select(Order).where(Order.created_at >= now() - timedelta(days=90))
    if household_id:
        statement = statement.where(Order.household_id == household_id)
    orders = list(db.scalars(statement))
    days = {}
    paid = {"paid", "partial_refund", "refunded", "refund_pending"}
    for order in orders:
        day = order.created_at.replace(tzinfo=timezone.utc).astimezone(ZoneInfo("Asia/Riyadh")).strftime("%Y-%m-%d")
        entry = days.setdefault(day, {"day": day, "orders": 0, "product_sales": 0, "delivery_charges": 0, "refunds": 0})
        entry["orders"] += 1
        if order.payment_status in paid:
            entry["product_sales"] += order.subtotal
            entry["delivery_charges"] += order.delivery_fee
            entry["refunds"] += order.refunded
    return {
        "period_days": 90,
        "timezone": "Asia/Riyadh",
        "orders": len(orders),
        "paid_orders": sum(o.payment_status in paid for o in orders),
        "product_sales": sum(o.subtotal for o in orders if o.payment_status in paid),
        "delivery_charges": sum(o.delivery_fee for o in orders if o.payment_status in paid),
        "refunds": sum(o.refunded for o in orders),
        "settled": None,
        "provider_fees": None,
        "net_profit": None,
        "mode": "test",
        "daily": sorted(days.values(), key=lambda d: d["day"]),
    }


@router.get("/admin/reports")
def reports(user=Depends(roles("admin")), db=Depends(get_db)):
    result = financial_report(db)
    result["subscription_invoices"] = db.scalar(select(func.count()).select_from(Invoice))
    result["subscription_receipts"] = db.scalar(select(func.coalesce(func.sum(Invoice.amount), 0)).where(Invoice.status == "paid"))
    return result


@router.get("/seller/reports")
def seller_reports(user=Depends(roles("seller")), db=Depends(get_db)):
    return financial_report(db, household(db, user).id)


@router.get("/admin/outbox")
def outbox(user=Depends(roles("admin")), db=Depends(get_db)):
    return [
        {k: getattr(o, k) for k in ["id", "kind", "attempts", "dead_letter", "last_error", "next_attempt_at", "sent_at", "claimed_until"]}
        for o in db.scalars(select(Outbox).order_by(Outbox.next_attempt_at.desc()).limit(200))
    ]


@router.post("/admin/outbox/{job_id}/retry")
def retry(job_id: str, user=Depends(roles("admin")), db=Depends(get_db)):
    changed = db.execute(
        update(Outbox)
        .where(Outbox.id == job_id, Outbox.sent_at.is_(None), or_(Outbox.claimed_until.is_(None), Outbox.claimed_until < now()))
        .values(dead_letter=False, attempts=0, next_attempt_at=now(), last_error="", lease_token=None, claimed_until=None)
    )
    if changed.rowcount != 1:
        raise HTTPException(409, "الرسالة مرسلة أو قيد المعالجة أو غير موجودة")
    audit(db, user, "outbox.retry", job_id)
    db.commit()
    return {"ok": True}


@router.get("/admin/privacy-requests")
def privacy(user=Depends(roles("admin")), db=Depends(get_db)):
    return [
        {k: getattr(d, k) for k in ["id", "user_id", "kind", "status", "note", "created_at"]}
        for d in db.scalars(select(DataRequest).order_by(DataRequest.created_at.desc()).limit(100))
    ]


class PrivacyReview(BaseModel):
    status: str = Field(pattern=r"^(in_review|rejected)$")
    note: str = Field(min_length=10, max_length=1000)


@router.post("/admin/privacy-requests/{request_id}/review")
def review_privacy(request_id: str, data: PrivacyReview, user=Depends(roles("admin")), db=Depends(get_db)):
    d = db.get(DataRequest, request_id)
    if not d:
        raise HTTPException(404, "الطلب غير موجود")
    d.status, d.note = data.status, data.note
    audit(db, user, "privacy.review." + data.status, d.id)
    db.commit()
    return {"ok": True}


@router.get("/orders/{order_id}/receipt")
def receipt(order_id: str, user=Depends(current_user), db=Depends(get_db)):
    from .orders import visible_order, order_json

    order = visible_order(db, order_id, user)
    return {
        "kind": "order_receipt",
        "order": order_json(db, order, user),
        "currency": "SAR",
        "tax_invoice": False,
        "notice": "إيصال طلب تجريبي، لا يمثل فاتورة ضريبية معتمدة أو إثبات تحويل أموال",
    }


@router.get("/admin/delivery-issues")
def delivery_issues(user=Depends(roles("admin")), db=Depends(get_db)):
    return [
        {k: getattr(i, k) for k in ["id", "order_id", "driver_id", "reason", "resolved", "created_at"]}
        for i in db.scalars(select(DeliveryIssue).order_by(DeliveryIssue.created_at.desc()).limit(100))
    ]


class ReassignInput(BaseModel):
    returned_to_seller: bool = False
    note: str = Field(min_length=10, max_length=1000)


@router.post("/admin/delivery/{order_id}/reassign")
def reassign(order_id: str, data: ReassignInput, user=Depends(roles("admin")), db=Depends(get_db)):
    from .models import User, SupportTicket
    from .orders import notify

    order = db.scalar(select(Order).where(Order.id == order_id).with_for_update())
    if not order or order.status not in {"assigned", "picked_up", "in_transit"} or not order.driver_id:
        raise HTTPException(409, "الطلب لا يقبل إعادة الإسناد")
    if order.status in {"picked_up", "in_transit"} and not data.returned_to_seller:
        raise HTTPException(409, "يلزم التحقق التشغيلي من عودة الطلب للأسرة قبل إسناده مجددًا")
    driver = db.get(User, order.driver_id)
    driver.active_trip_id = None
    order.driver_id, order.status, order.delivery_code_hash, order.pickup_code_hash = None, "ready", None, None
    order.offer_expires_at = now() + timedelta(minutes=15)
    for i in db.scalars(select(DeliveryIssue).where(DeliveryIssue.order_id == order.id, DeliveryIssue.resolved.is_(False))):
        i.resolved = True
    notify(db, order, "أعيد عرض التوصيل بعد مراجعة الإدارة")
    db.add(SupportTicket(user_id=user.id, order_id=order.id, message=data.note, status="resolved"))
    audit(db, user, "delivery.reassign", order.id)
    db.commit()
    return {"ok": True}


@router.get("/admin/deliveries/active")
def active_deliveries(user=Depends(roles("admin")), db=Depends(get_db)):
    from .models import User
    from .models_ext import DriverPosition

    stale = now() - timedelta(minutes=5)
    result = []
    for o in db.scalars(
        select(Order)
        .where(Order.status.in_(["assigned", "picked_up", "in_transit"]), Order.driver_id.is_not(None))
        .order_by(Order.scheduled_at)
        .limit(100)
    ):
        position = db.get(DriverPosition, o.driver_id)
        result.append(
            {
                "order_id": o.id,
                "status": o.status,
                "household_name": db.get(Household, o.household_id).name,
                "driver_name": db.get(User, o.driver_id).name,
                "scheduled_at": o.scheduled_at,
                "position_updated_at": position.updated_at if position else None,
                "stale": not position or position.updated_at < stale,
            }
        )
    return result


@router.get("/admin/delivery/waiting")
def waiting_deliveries(user=Depends(roles("admin")), db=Depends(get_db)):
    current = now()
    return [
        {
            "order_id": o.id,
            "household_name": db.get(Household, o.household_id).name,
            "scheduled_at": o.scheduled_at,
            "overdue": o.scheduled_at < current,
        }
        for o in db.scalars(
            select(Order)
            .where(Order.status == "ready", Order.delivery_method == "paid", Order.driver_id.is_(None))
            .order_by(Order.scheduled_at)
            .limit(100)
        )
    ]


# Before a driver holds the order; trips in progress go through reassignment first.
ADMIN_CANCELLABLE = {"pending_payment", "pending_acceptance", "confirmed", "preparing", "ready"}


class CancelInput(BaseModel):
    note: str = Field(min_length=10, max_length=1000)


@router.post("/admin/orders/{order_id}/cancel")
def cancel_order(order_id: str, data: CancelInput, user=Depends(roles("admin")), db=Depends(get_db)):
    from .models import SupportTicket
    from .orders import notify, order_json, restore_stock

    order = db.scalar(select(Order).where(Order.id == order_id).with_for_update())
    if not order or order.status not in ADMIN_CANCELLABLE:
        raise HTTPException(409, "لا يمكن إلغاء الطلب في حالته الحالية؛ إن كان مع سائق فأعد إسناده أولًا")
    old = order.status
    changed = db.execute(update(Order).where(Order.id == order.id, Order.status == old).values(status="cancelled"))
    if changed.rowcount != 1:
        raise HTTPException(409, "تغيرت حالة الطلب؛ أعد المحاولة")
    restore_stock(db, order)
    if order.payment_status == "paid":
        order.payment_status = "refund_pending"
    notify(db, order, "ألغت الإدارة الطلب")
    db.add(SupportTicket(user_id=user.id, order_id=order.id, message=data.note, status="resolved"))
    audit(db, user, "admin.order.cancel", order.id)
    db.commit()
    db.refresh(order)
    return order_json(db, order, user)
