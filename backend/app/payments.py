import hashlib
import hmac
import logging
from datetime import timedelta
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from starlette.responses import RedirectResponse
from .config import settings
from .db import get_db
from .models import Order, PaymentEvent, Ledger, now, Household, User, Notification, Audit
from .models_ext import Invoice, TapCharge
from .orders import visible_order, restore_stock, notify, family_telegram
from .security import roles, audit, household, limit
from .providers import require_test_payment, TapPaymentProvider
from .subscriptions import activate_invoice_paid

log = logging.getLogger("payments")
router = APIRouter(prefix="/payments", tags=["payments"])

# Opening Tap's page keeps the order reserved long enough to finish 3-D Secure near the end of the window.
CHECKOUT_GRACE = timedelta(minutes=20)


class EventInput(BaseModel):
    event_id: str = Field(min_length=8, max_length=100)
    order_id: str = Field(max_length=32)
    amount: int = Field(ge=1)
    currency: Literal["SAR"] = "SAR"
    outcome: Literal["paid", "failed"]


def ledger_note(event_id):
    return "دفع Tap " + event_id if event_id.startswith("chg_") else "تجريبي؛ ليس تحويل أموال"


def process_event(db, data, allow_late=False):
    """Applies a payment result once. `allow_late` keeps money already captured by a provider from
    being rejected only because the payment window passed while the order is still awaiting payment."""
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
    if order.status == "pending_acceptance":
        raise HTTPException(409, "لا يُقبل الدفع قبل موافقة الأسرة على الطلب")
    expired = order.payment_expires_at < now() and not allow_late
    if order.payment_status != "unpaid" or order.status != "pending_payment" or expired:
        raise HTTPException(409, "الطلب لا يقبل هذا الدفع؛ انتهت مهلة الدفع أو تغيرت حالة الطلب")
    paid = data.outcome == "paid"
    changed = db.execute(
        update(Order)
        .where(Order.id == order.id, Order.payment_status == "unpaid", Order.status == "pending_payment")
        .values(payment_status="paid" if paid else "failed", status="confirmed" if paid else "cancelled")
    )
    if changed.rowcount != 1:
        raise HTTPException(409, "تمت معالجة الطلب بالفعل")
    order.payment_status = "paid" if paid else "failed"
    order.status = "confirmed" if paid else "cancelled"
    db.add(PaymentEvent(id=data.event_id, order_id=order.id, kind=data.outcome, amount=data.amount))
    if paid:
        note = ledger_note(data.event_id)
        db.add(Ledger(order_id=order.id, kind="product_sales", amount=order.subtotal, note=note))
        for kind, amount in (
            ("merchant_commission", -order.merchant_fee),
            ("delivery_charge", order.delivery_fee),
            ("service_fee", order.service_fee),
        ):
            if amount:
                db.add(Ledger(order_id=order.id, kind=kind, amount=amount, note=note))
        family_telegram(db, order, "✅ دفع العميل قيمة الطلب؛ ابدأ التجهيز")
    else:
        restore_stock(db, order)
    notify(db, order, "تم سداد قيمة الطلب بنجاح! بدأ المطبخ في تجهيز طلبك 🍳" if paid else "تعذر الدفع وألغي الطلب")
    try:
        from .order_chat import trigger_order_chat_status_event
        trigger_order_chat_status_event(db, order, order.status)
    except Exception:
        pass
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
    """Refunds part or all of a paid order: a real Tap refund in Tap mode, a recorded simulation in test mode."""
    tap = settings.payment_provider == "tap"
    if not tap:
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
    note = "استرداد تجريبي فقط"
    if tap:
        payment = db.scalar(select(PaymentEvent).where(PaymentEvent.order_id == order.id, PaymentEvent.kind == "paid"))
        if not payment or not TapPaymentProvider.CHARGE_ID.fullmatch(payment.id):
            raise HTTPException(409, "هذا الطلب لم يُدفع عبر Tap؛ لا يمكن استرداده من هنا")
        result = TapPaymentProvider().create_refund(payment.id, amount, idempotent=event_id)
        note = f"استرداد Tap {result['id']} ({result['status']})"
    total_refunded = order.refunded + amount
    result = db.execute(
        update(Order)
        .where(Order.id == order.id, Order.refunded == order.refunded)
        .values(refunded=total_refunded, payment_status="refunded" if total_refunded == order.total else "partial_refund")
    )
    if result.rowcount != 1:
        log.error("Refund recorded at the provider but the order changed concurrently: order=%s event=%s", order.id, event_id)
        raise HTTPException(409, "تعارض استرداد")
    db.add(PaymentEvent(id=event_id, order_id=order.id, amount=amount, kind="refund"))
    db.add(Ledger(order_id=order.id, kind="refund", amount=-amount, note=note))
    if tap:
        db.add(Notification(user_id=order.customer_id, message=f"تم استرداد {amount / 100:.2f} ر.س لطلبك • {order.id[:8]}"))
    audit(db, user, "payment.refund.tap" if tap else "payment.refund.test", order.id)
    db.commit()
    return {"ok": True, "refunded": total_refunded}


def require_tap():
    if settings.payment_provider != "tap":
        raise HTTPException(400, "مزود الدفع Tap غير مفعّل حالياً")


@router.post("/tap/create/{order_id}")
def create_tap_order(order_id: str, user=Depends(roles("customer")), db=Depends(get_db)):
    require_tap()
    order = visible_order(db, order_id, user, lock=True)
    if order.customer_id != user.id:
        raise HTTPException(404, "الطلب غير موجود")
    if order.status == "pending_acceptance":
        raise HTTPException(409, "لا يمكن الدفع قبل مراجعة الأسرة للطلب وتأكيد توفره")
    if order.payment_status != "unpaid" or order.status != "pending_payment" or order.payment_expires_at < now():
        raise HTTPException(409, "الطلب لا يقبل الدفع حالياً أو انتهت مهلة الدفع")
    limit("tap-charge:" + user.id, 10, 600)
    result = TapPaymentProvider().create_order_charge(order, user)
    db.add(TapCharge(id=result["charge_id"], kind="order", target_id=order.id, amount=order.total))
    order.payment_expires_at = max(order.payment_expires_at, now() + CHECKOUT_GRACE)
    audit(db, user, "payment.tap.charge", order.id)
    db.commit()
    return result


@router.post("/tap/subscription/{invoice_id}")
def create_tap_subscription(invoice_id: str, user=Depends(roles("seller")), db=Depends(get_db)):
    require_tap()
    h = household(db, user)
    invoice = db.scalar(select(Invoice).where(Invoice.id == invoice_id).with_for_update())
    if not invoice or invoice.household_id != h.id:
        raise HTTPException(404, "الفاتورة غير موجودة")
    if invoice.status not in {"unpaid", "failed"}:
        raise HTTPException(409, "الفاتورة لا تقبل الدفع")
    limit("tap-charge:" + user.id, 10, 600)
    result = TapPaymentProvider().create_invoice_charge(invoice, user)
    db.add(TapCharge(id=result["charge_id"], kind="invoice", target_id=invoice.id, amount=invoice.amount))
    audit(db, user, "payment.tap.charge", invoice.id)
    db.commit()
    return result


def captured_amount(charge):
    try:
        return int(round(float(charge.get("amount") or 0) * 100))
    except (TypeError, ValueError):
        return 0


def charge_target(charge):
    """What a charge pays for, read only from metadata the platform set when opening it."""
    meta = charge.get("metadata") if isinstance(charge.get("metadata"), dict) else {}
    if meta.get("invoice_id"):
        return "invoice", str(meta["invoice_id"])[:32]
    if meta.get("order_id"):
        return "order", str(meta["order_id"])[:32]
    return None, None


def payer_id(db, kind, target_id):
    if kind == "order":
        order = db.get(Order, target_id)
        return order.customer_id if order else None
    invoice = db.get(Invoice, target_id)
    h = db.get(Household, invoice.household_id) if invoice else None
    return h.owner_id if h else None


def flag_charge(db, charge_id, kind, target_id, amount, reason):
    """Captured money that could not be applied: keep it visible to the administration until refunded."""
    db.rollback()
    row = db.get(TapCharge, charge_id)
    if row and row.status == "applied":
        # The redirect, the webhook and the sweep can race; the other one already applied this charge.
        return kind, target_id, "paid"
    if not row:
        row = TapCharge(id=charge_id, kind=kind, target_id=target_id, amount=amount)
        db.add(row)
    if row.status != "needs_refund":
        row.status, row.amount, row.detail, row.updated_at = "needs_refund", amount, str(reason)[:500], now()
        db.add(Audit(action="payment.tap.unapplied", resource_id=charge_id))
        label = "طلب" if kind == "order" else "فاتورة اشتراك"
        alert = f"دفعة Tap مكتملة بقيمة {amount / 100:.2f} ر.س لم تُطبّق على {label} {target_id[:8]}: {reason} — استردّها من «معاملات Tap»"
        for admin_id in db.scalars(select(User.id).where(User.role == "admin", User.active.is_(True))):
            db.add(Notification(user_id=admin_id, message=alert))
        payer = payer_id(db, kind, target_id)
        if payer:
            db.add(Notification(user_id=payer, message="وصلتنا دفعتك لكن تعذر ربطها؛ ستراجعها الإدارة وتسترد المبلغ كاملًا"))
    db.commit()
    log.warning("Unapplied Tap charge %s for %s %s: %s", charge_id, kind, target_id, reason)
    return kind, target_id, "review"


def apply_tap_charge(db, charge):
    """Applies a charge fetched from Tap; safe to repeat from the redirect, the webhook and the sweep.

    Returns (kind, target_id, outcome) where outcome is paid | pending | failed | review | ignored."""
    try:
        return _apply_tap_charge(db, charge)
    except IntegrityError:
        # A concurrent request recorded the same charge first; report what it stored.
        db.rollback()
        row = db.get(TapCharge, str(charge.get("id") or ""))
        if not row:
            return None, None, "pending"
        return row.kind, row.target_id, {"applied": "paid", "failed": "failed", "initiated": "pending"}.get(row.status, "review")


def _apply_tap_charge(db, charge):
    charge_id = str(charge.get("id") or "")
    status = str(charge.get("status") or "").upper()
    amount = captured_amount(charge)
    row = db.get(TapCharge, charge_id)
    kind, target_id = (row.kind, row.target_id) if row else charge_target(charge)
    if not kind:
        return None, None, "ignored"
    if row and row.status == "applied":
        return kind, target_id, "paid"
    if row and row.status in {"needs_refund", "refunded", "resolved"}:
        return kind, target_id, "review"
    if status in TapPaymentProvider.FAILED:
        if not row:
            row = TapCharge(id=charge_id, kind=kind, target_id=target_id, amount=amount)
            db.add(row)
        row.status, row.detail, row.updated_at = "failed", status, now()
        db.commit()
        return kind, target_id, "failed"
    if status != "CAPTURED":
        return kind, target_id, "pending"
    if str(charge.get("currency") or "").upper() != "SAR" or amount <= 0:
        return flag_charge(db, charge_id, kind, target_id, amount, "عملة أو مبلغ غير متوقع")
    if not row:
        row = TapCharge(id=charge_id, kind=kind, target_id=target_id, amount=amount)
        db.add(row)
    row.status, row.detail, row.updated_at = "applied", "", now()
    if kind == "order":
        try:
            process_event(db, EventInput(event_id=charge_id, order_id=target_id, amount=amount, outcome="paid"), allow_late=True)
        except HTTPException as error:
            return flag_charge(db, charge_id, kind, target_id, amount, error.detail)
        db.commit()
        return kind, target_id, "paid"
    invoice = db.scalar(select(Invoice).where(Invoice.id == target_id).with_for_update())
    h = db.get(Household, invoice.household_id) if invoice else None
    meta = charge.get("metadata") if isinstance(charge.get("metadata"), dict) else {}
    if not invoice or not h:
        return flag_charge(db, charge_id, kind, target_id, amount, "الفاتورة غير موجودة")
    if meta.get("household_id") and meta["household_id"] != invoice.household_id:
        return flag_charge(db, charge_id, kind, target_id, amount, "الفاتورة تخص أسرة أخرى")
    if invoice.amount != amount:
        return flag_charge(db, charge_id, kind, target_id, amount, "المبلغ لا يطابق الفاتورة")
    if invoice.status == "paid":
        return flag_charge(db, charge_id, kind, target_id, amount, "الفاتورة مدفوعة مسبقًا؛ دفعة مكررة")
    if invoice.status not in {"unpaid", "failed"}:
        return flag_charge(db, charge_id, kind, target_id, amount, "الفاتورة لا تقبل الدفع")
    activate_invoice_paid(db, invoice, db.get(User, h.owner_id), provider="tap")
    return kind, target_id, "paid"


def result_url(kind, target_id, outcome):
    if kind == "invoice":
        # The subscription panel lives in the family dashboard's reports tab.
        return f"{settings.public_origin}/seller?tab=reports&payment={outcome}"
    return f"{settings.public_origin}/orders/{target_id}?payment={outcome}"


@router.get("/tap/redirect")
def tap_redirect(request: Request, tap_id: str = "", db=Depends(get_db)):
    """Where Tap returns the payer. The charge is re-read from Tap; query parameters are never trusted."""
    limit("tap-redirect:" + (request.client.host if request.client else "unknown"), 120, 60)
    if not TapPaymentProvider.CHARGE_ID.fullmatch(tap_id):
        return RedirectResponse(url=f"{settings.public_origin}/account?payment=error")
    row = db.get(TapCharge, tap_id)
    try:
        charge = TapPaymentProvider().get_charge(tap_id)
    except HTTPException:
        if row:
            return RedirectResponse(url=result_url(row.kind, row.target_id, "pending"))
        return RedirectResponse(url=f"{settings.public_origin}/account?payment=error")
    kind, target_id, outcome = apply_tap_charge(db, charge)
    if not kind:
        return RedirectResponse(url=f"{settings.public_origin}/account?payment=error")
    return RedirectResponse(url=result_url(kind, target_id, outcome))


@router.post("/webhook/tap")
async def tap_webhook(request: Request, db=Depends(get_db)):
    limit("tap-webhook:" + (request.client.host if request.client else "unknown"), 300, 60)
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(400, "بيانات غير صالحة") from None
    tap_id = body.get("id") if isinstance(body, dict) else None
    if not isinstance(tap_id, str) or not TapPaymentProvider.CHARGE_ID.fullmatch(tap_id):
        return {"status": "ignored"}
    # The body is only a hint; the state applied is the one Tap returns for this id.
    charge = TapPaymentProvider().get_charge(tap_id)
    _, _, outcome = apply_tap_charge(db, charge)
    return {"status": outcome}


def tap_charge_json(row):
    return {
        k: getattr(row, k)
        for k in ["id", "kind", "target_id", "amount", "currency", "status", "detail", "refund_id", "created_at", "updated_at"]
    }


@router.get("/admin/tap-charges")
def list_tap_charges(status: str = "", user=Depends(roles("admin")), db=Depends(get_db)):
    statement = select(TapCharge).order_by(TapCharge.created_at.desc()).limit(200)
    if status:
        statement = statement.where(TapCharge.status == status)
    return [tap_charge_json(row) for row in db.scalars(statement)]


class ChargeCheckInput(BaseModel):
    charge_id: str = Field(min_length=10, max_length=80)


@router.post("/admin/tap-charges/check")
def check_tap_charge(data: ChargeCheckInput, user=Depends(roles("admin")), db=Depends(get_db)):
    """Re-reads a charge from Tap and applies it; repairs payments whose redirect and webhook were missed."""
    require_tap()
    charge_id = data.charge_id.strip()
    if not TapPaymentProvider.CHARGE_ID.fullmatch(charge_id):
        raise HTTPException(422, "معرّف معاملة Tap غير صالح؛ يبدأ بـ chg_")
    charge = TapPaymentProvider().get_charge(charge_id)
    kind, target_id, outcome = apply_tap_charge(db, charge)
    audit(db, user, "payment.tap.check", charge_id)
    db.commit()
    return {"charge_id": charge_id, "tap_status": charge.get("status"), "kind": kind, "target_id": target_id, "outcome": outcome}


def pending_refund(db, charge_id):
    row = db.scalar(select(TapCharge).where(TapCharge.id == charge_id).with_for_update())
    if not row or row.status != "needs_refund":
        raise HTTPException(409, "لا يوجد مبلغ معلّق للاسترداد لهذه المعاملة")
    return row


@router.post("/admin/tap-charges/{charge_id}/refund")
def refund_tap_charge(charge_id: str, user=Depends(roles("admin")), db=Depends(get_db)):
    require_tap()
    row = pending_refund(db, charge_id)
    result = TapPaymentProvider().create_refund(row.id, row.amount, idempotent="unapplied-" + row.id)
    row.status, row.refund_id, row.updated_at = "refunded", result["id"], now()
    row.detail = (row.detail + f" • استرداد Tap {result['id']} ({result['status']})")[:500]
    payer = payer_id(db, row.kind, row.target_id)
    if payer:
        db.add(Notification(user_id=payer, message=f"تم استرداد دفعتك ({row.amount / 100:.2f} ر.س) التي تعذر ربطها"))
    audit(db, user, "payment.tap.refund_unapplied", row.id)
    db.commit()
    return tap_charge_json(row)


class ResolveInput(BaseModel):
    note: str = Field(min_length=5, max_length=300)


@router.post("/admin/tap-charges/{charge_id}/resolve")
def resolve_tap_charge(charge_id: str, data: ResolveInput, user=Depends(roles("admin")), db=Depends(get_db)):
    """For payments settled outside the platform (for example refunded from Tap's dashboard)."""
    row = pending_refund(db, charge_id)
    row.status, row.updated_at = "resolved", now()
    row.detail = (row.detail + " • " + data.note.strip())[:500]
    audit(db, user, "payment.tap.resolve", row.id)
    db.commit()
    return tap_charge_json(row)
