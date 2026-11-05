import calendar
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select, update
from .db import get_db
from .models import Household, Plan, Notification, now
from .models_ext import Subscription, Invoice
from .security import roles, household, audit
from .providers import require_test_payment, require_payment_enabled

router = APIRouter(tags=["subscriptions"])


def add_months(value, months):
    year = value.year + (value.month - 1 + months) // 12
    month = (value.month - 1 + months) % 12 + 1
    return value.replace(year=year, month=month, day=min(value.day, calendar.monthrange(year, month)[1]))


def invoice_json(invoice):
    return {
        k: getattr(invoice, k)
        for k in [
            "id",
            "household_id",
            "plan_name",
            "amount",
            "status",
            "provider",
            "interval",
            "created_at",
            "paid_at",
            "period_start",
            "period_end",
        ]
    }


def invoice_for(db, h, plan, interval, key):
    previous = db.scalar(select(Invoice).where(Invoice.household_id == h.id, Invoice.idempotency_key == key))
    if previous:
        if previous.plan_id != plan.id or previous.interval != interval:
            raise HTTPException(409, "معرف الطلب مستخدم لفاتورة مختلفة")
        return previous
    if not plan.active or (interval == "annual" and plan.annual_price is None):
        raise HTTPException(422, "الباقة أو الفترة غير متاحة")
    invoice = Invoice(
        household_id=h.id,
        plan_id=plan.id,
        plan_name=plan.name,
        interval=interval,
        amount=plan.annual_price if interval == "annual" else plan.monthly_price,
        idempotency_key=key,
    )
    db.add(invoice)
    db.flush()
    return invoice


class SubscribeInput(BaseModel):
    plan_id: str = Field(max_length=32)
    interval: Literal["monthly", "annual"] = "monthly"
    idempotency_key: str = Field(min_length=16, max_length=100)


@router.get("/seller/subscription")
def subscription(user=Depends(roles("seller")), db=Depends(get_db)):
    h = household(db, user)
    item = db.get(Subscription, h.id)
    return {
        "status": item.status if item else h.subscription_status,
        "plan_id": item.plan_id if item else h.plan_id,
        "interval": item.interval if item else None,
        "ends_at": item.ends_at if item else h.trial_ends_at,
        "auto_renew": item.auto_renew if item else False,
        "invoices": [
            invoice_json(i)
            for i in db.scalars(select(Invoice).where(Invoice.household_id == h.id).order_by(Invoice.created_at.desc()).limit(100))
        ],
    }


@router.get("/subscription/invoices/{invoice_id}")
def get_invoice(invoice_id: str, user=Depends(roles("seller", "admin")), db=Depends(get_db)):
    invoice = db.get(Invoice, invoice_id)
    if not invoice or (user.role != "admin" and invoice.household_id != household(db, user).id):
        raise HTTPException(404, "الفاتورة غير موجودة")
    return invoice_json(invoice)


@router.post("/seller/subscription/invoices", status_code=201)
def create_invoice(data: SubscribeInput, user=Depends(roles("seller")), db=Depends(get_db)):
    require_payment_enabled()
    h = household(db, user)
    plan = db.get(Plan, data.plan_id)
    if not plan:
        raise HTTPException(404, "الباقة غير موجودة")
    invoice = invoice_for(db, h, plan, data.interval, data.idempotency_key)
    audit(db, user, "subscription.invoice.create", invoice.id)
    db.commit()
    return invoice_json(invoice)


def activate_invoice_paid(db, invoice, user, provider=None):
    h = db.scalar(select(Household).where(Household.id == invoice.household_id).with_for_update())
    if provider:
        invoice.provider = provider
    current = db.get(Subscription, h.id)
    start = max(now(), current.ends_at) if current and current.ends_at else now()
    end = add_months(start, 12 if invoice.interval == "annual" else 1)
    if not current:
        current = Subscription(household_id=h.id, plan_id=invoice.plan_id, interval=invoice.interval)
        db.add(current)
    current.plan_id, current.interval, current.status, current.ends_at = invoice.plan_id, invoice.interval, "active", end
    h.plan_id, h.subscription_status, h.trial_ends_at = invoice.plan_id, "active", None
    invoice.status = "paid"
    invoice.paid_at, invoice.period_start, invoice.period_end = now(), start, end
    db.add(Notification(user_id=user.id, message="تم تفعيل اشتراكك حتى " + end.strftime("%Y-%m-%d")))
    audit(db, user, "subscription.payment.paid", invoice.id)
    db.commit()


@router.post("/seller/subscription/invoices/{invoice_id}/test-pay")
def pay(invoice_id: str, outcome: Literal["paid", "failed"] = "paid", user=Depends(roles("seller")), db=Depends(get_db)):
    require_test_payment()
    h = household(db, user)
    invoice = db.scalar(select(Invoice).where(Invoice.id == invoice_id).with_for_update())
    if not invoice or invoice.household_id != h.id:
        raise HTTPException(404, "الفاتورة غير موجودة")
    if invoice.status == "paid":
        return {**invoice_json(invoice), "duplicate": True}
    if invoice.status not in {"unpaid", "failed"}:
        raise HTTPException(409, "الفاتورة لا تقبل الدفع")
    if outcome == "paid":
        activate_invoice_paid(db, invoice, user)
    else:
        invoice.status = "failed"
        db.add(Notification(user_id=user.id, message="فشلت محاكاة دفع الاشتراك؛ لم تمدد الفترة"))
        audit(db, user, "subscription.payment.failed", invoice.id)
        db.commit()
    return invoice_json(invoice)


@router.post("/seller/subscription/renewal")
def renewal(enabled: bool, user=Depends(roles("seller")), db=Depends(get_db)):
    item = db.get(Subscription, household(db, user).id)
    if not item:
        raise HTTPException(409, "لا يوجد اشتراك مفعل")
    item.auto_renew = enabled
    audit(db, user, "subscription.renewal." + str(enabled), item.household_id)
    db.commit()
    return {"ok": True, "message": "التجديد يصدر طلب دفع للمراجعة ولا يخصم أموالًا تلقائيًا"}
