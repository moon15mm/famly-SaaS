import hashlib
import hmac
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from starlette.responses import RedirectResponse
from .config import settings
from .db import get_db
from .models import Order, PaymentEvent, Ledger, now, Household, User, Plan
from .models_ext import Invoice
from .orders import visible_order, restore_stock, notify
from .security import roles, audit, household
from .providers import require_test_payment, TapPaymentProvider
from .subscriptions import activate_invoice_paid

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


@router.post("/tap/create/{order_id}")
def create_tap_order(order_id: str, user=Depends(roles("customer")), db=Depends(get_db)):
    if settings.payment_provider != "tap":
        raise HTTPException(400, "مزود الدفع Tap غير مفعّل حالياً")
    order = visible_order(db, order_id, user)
    if order.customer_id != user.id:
        raise HTTPException(404, "الطلب غير موجود")
    if order.payment_status != "unpaid" or order.status != "pending_payment" or order.payment_expires_at < now():
        raise HTTPException(409, "الطلب لا يقبل الدفع حالياً")
    provider = TapPaymentProvider()
    return provider.create_order_charge(order, user)


@router.post("/tap/subscription/{invoice_id}")
def create_tap_subscription(invoice_id: str, user=Depends(roles("seller")), db=Depends(get_db)):
    if settings.payment_provider != "tap":
        raise HTTPException(400, "مزود الدفع Tap غير مفعّل حالياً")
    h = household(db, user)
    invoice = db.scalar(select(Invoice).where(Invoice.id == invoice_id))
    if not invoice or invoice.household_id != h.id:
        raise HTTPException(404, "الفاتورة غير موجودة")
    if invoice.status != "unpaid":
        raise HTTPException(409, "الفاتورة لا تقبل الدفع")
    provider = TapPaymentProvider()
    return provider.create_invoice_charge(invoice, user)


@router.get("/tap/redirect")
def tap_redirect(tap_id: str = "", order_id: str = "", invoice_id: str = "", db=Depends(get_db)):
    if not tap_id:
        return RedirectResponse(url=f"{settings.public_origin}/account?payment_error=missing_tap_id")
    provider = TapPaymentProvider()
    charge = provider.get_charge(tap_id)
    status = charge.get("status")

    target_order_id = order_id or charge.get("metadata", {}).get("order_id") or charge.get("reference", {}).get("order")
    target_invoice_id = invoice_id or charge.get("metadata", {}).get("invoice_id")

    if target_order_id:
        if status == "CAPTURED":
            amount_halalas = int(round(float(charge.get("amount", 0)) * 100))
            try:
                process_event(db, EventInput(event_id=tap_id, order_id=target_order_id, amount=amount_halalas, outcome="paid"))
            except HTTPException:
                pass
            return RedirectResponse(url=f"{settings.public_origin}/orders/{target_order_id}?paid=1")
        return RedirectResponse(url=f"{settings.public_origin}/orders/{target_order_id}?payment_failed=1")

    if target_invoice_id:
        invoice = db.scalar(select(Invoice).where(Invoice.id == target_invoice_id).with_for_update())
        if invoice and status == "CAPTURED":
            if invoice.status != "paid":
                h = db.get(Household, invoice.household_id)
                h_user = db.get(User, h.owner_id) if h else None
                activate_invoice_paid(db, invoice, h_user or User(id="system", role="seller"))
            return RedirectResponse(url=f"{settings.public_origin}/seller/subscription?paid=1")
        return RedirectResponse(url=f"{settings.public_origin}/seller/subscription?payment_failed=1")

    return RedirectResponse(url=f"{settings.public_origin}/account")


@router.post("/webhook/tap")
async def tap_webhook(request: Request, db=Depends(get_db)):
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(400, "بيانات غير صالحة")
    tap_id = body.get("id")
    if not tap_id or not tap_id.startswith("chg_"):
        return {"status": "ignored"}

    provider = TapPaymentProvider()
    charge = provider.get_charge(tap_id)
    status = charge.get("status")
    target_order_id = charge.get("metadata", {}).get("order_id") or charge.get("reference", {}).get("order")
    target_invoice_id = charge.get("metadata", {}).get("invoice_id")

    if target_order_id and status == "CAPTURED":
        amount_halalas = int(round(float(charge.get("amount", 0)) * 100))
        try:
            process_event(db, EventInput(event_id=tap_id, order_id=target_order_id, amount=amount_halalas, outcome="paid"))
        except HTTPException:
            pass

    elif target_invoice_id and status == "CAPTURED":
        invoice = db.scalar(select(Invoice).where(Invoice.id == target_invoice_id).with_for_update())
        if invoice and invoice.status != "paid":
            h = db.get(Household, invoice.household_id)
            h_user = db.get(User, h.owner_id) if h else None
            activate_invoice_paid(db, invoice, h_user or User(id="system", role="seller"))

    return {"status": "ok"}
