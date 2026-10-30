import hashlib
import hmac
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from .config import settings
from .db import get_db
from .models import Order, PaymentEvent, Ledger, now
from .orders import visible_order, restore_stock, notify
from .security import roles, audit
from .providers import require_test_payment

router = APIRouter(prefix="/payments", tags=["payments"])


class EventInput(BaseModel):
    event_id: str = Field(min_length=8, max_length=100)
    order_id: str = Field(max_length=32)
    amount: int = Field(ge=1)
    currency: Literal["SAR"] = "SAR"
    outcome: Literal["paid", "failed"]


def process_event(db, data):
    duplicate = db.get(PaymentEvent, data.event_id)
    if duplicate:
        if (duplicate.order_id, duplicate.amount, duplicate.kind) != (data.order_id, data.amount, data.outcome):
            raise HTTPException(409, "تعارض مع حدث دفع سابق")
        return {"ok": True, "duplicate": True}
    order = db.scalar(select(Order).where(Order.id == data.order_id).with_for_update())
    if not order:
        raise HTTPException(404, "الطلب غير موجود")
    if order.total != data.amount:
        raise HTTPException(422, "مبلغ الدفع لا يطابق الطلب")
    if order.payment_status != "unpaid" or order.status != "pending_payment" or order.payment_expires_at < now():
        raise HTTPException(409, "الطلب لا يقبل هذا الدفع؛ يلزم تحقق أو استرداد لدى المزود")
    changed = db.execute(
        update(Order)
        .where(Order.id == order.id, Order.payment_status == "unpaid", Order.status == "pending_payment")
        .values(
            payment_status="paid" if data.outcome == "paid" else "failed",
            status="pending_acceptance" if data.outcome == "paid" else "cancelled",
        )
    )
    if changed.rowcount != 1:
        raise HTTPException(409, "تمت معالجة الطلب بالفعل")
    db.add(PaymentEvent(id=data.event_id, order_id=order.id, kind=data.outcome, amount=data.amount))
    if data.outcome == "paid":
        db.add(Ledger(order_id=order.id, kind="product_sales", amount=order.subtotal, note="تجريبي؛ ليس تحويل أموال"))
        db.add(Ledger(order_id=order.id, kind="delivery_charge", amount=order.delivery_fee, note="تجريبي"))
    else:
        restore_stock(db, order)
    notify(db, order, "تم الدفع التجريبي" if data.outcome == "paid" else "تعذر الدفع وأعيد المخزون")
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "تم استقبال الحدث بالتزامن؛ أعد الإرسال بنفس المعرف") from None
    return {"ok": True, "duplicate": False}


@router.post("/webhook/test")
async def webhook(request: Request, db=Depends(get_db)):
    require_test_payment()
    if len(settings.payment_webhook_secret) < 32:
        raise HTTPException(503, "لم تتم تهيئة توقيع Webhook")
    body = await request.body()
    if len(body) > 16384:
        raise HTTPException(413, "الطلب كبير جدًا")
    expected = hmac.new(settings.payment_webhook_secret.encode(), body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, request.headers.get("x-signature", "")):
        raise HTTPException(401, "توقيع غير صالح")
    try:
        data = EventInput.model_validate_json(body)
    except ValueError:
        raise HTTPException(422, "حدث غير صالح") from None
    return process_event(db, data)


@router.post("/test/{order_id}")
def test_payment(order_id: str, outcome: Literal["paid", "failed"] = "paid", user=Depends(roles("customer")), db=Depends(get_db)):
    require_test_payment()
    order = visible_order(db, order_id, user)
    if order.customer_id != user.id:
        raise HTTPException(404, "الطلب غير موجود")
    return process_event(
        db, EventInput(event_id="test-" + order.id + "-" + outcome, order_id=order.id, amount=order.total, outcome=outcome)
    )


@router.post("/refund/{order_id}")
def refund(order_id: str, amount: int, event_id: str, user=Depends(roles("admin")), db=Depends(get_db)):
    require_test_payment()
    if not 8 <= len(event_id) <= 100:
        raise HTTPException(422, "معرف حدث غير صالح")
    previous = db.get(PaymentEvent, event_id)
    if previous:
        if previous.order_id != order_id or previous.kind != "refund" or previous.amount != amount:
            raise HTTPException(409, "معرف استرداد مستخدم")
        return {"ok": True, "duplicate": True}
    order = visible_order(db, order_id, user, lock=True)
    if order.payment_status not in {"paid", "refund_pending", "partial_refund"} or amount < 1 or amount > order.total - order.refunded:
        raise HTTPException(422, "مبلغ الاسترداد غير صالح")
    total_refunded = order.refunded + amount
    result = db.execute(
        update(Order)
        .where(Order.id == order.id, Order.refunded == order.refunded)
        .values(refunded=total_refunded, payment_status="refunded" if total_refunded == order.total else "partial_refund")
    )
    if result.rowcount != 1:
        raise HTTPException(409, "تعارض استرداد")
    db.add(PaymentEvent(id=event_id, order_id=order.id, amount=amount, kind="refund"))
    db.add(Ledger(order_id=order.id, kind="refund", amount=-amount, note="استرداد تجريبي فقط"))
    audit(db, user, "payment.refund.test", order.id)
    db.commit()
    return {"ok": True, "refunded": total_refunded}
