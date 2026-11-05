import logging
import secrets
import time
from datetime import timedelta
import httpx
from sqlalchemy import select, update, or_
from .config import settings
from .models import Order, Outbox, Household, Notification, Session, User, Audit, now
from .models_ext import Subscription, EmailMessage, DriverPosition
from .orders import restore_stock, notify

log = logging.getLogger("worker")
SWEEP_SECONDS = 60
_swept_at = 0.0


def compliance_sweep(db):
    """Ends shifts whose contract or required documents lapsed, and warns once before documents expire."""
    from sqlalchemy import delete
    from .compliance import EXPIRY_NOTICE_DAYS, status as compliance_status, today
    from .models_ext import DocumentRequirement, VerificationDocument

    for driver in db.scalars(select(User).where(User.role == "driver", User.available.is_(True))):
        state = compliance_status(db, driver, include_body=False)
        if state["complete"]:
            continue
        driver.available = False
        if not driver.active_trip_id:
            db.execute(delete(DriverPosition).where(DriverPosition.driver_id == driver.id))
        db.add(Notification(user_id=driver.id, message="توقف استقبال المشاوير لنقص المتطلبات: " + "، ".join(state["missing"])))
    day = today()
    noticed = select(Audit.resource_id).where(Audit.action == "document.expiry.notice")
    for document in db.scalars(
        select(VerificationDocument)
        .join(DocumentRequirement, DocumentRequirement.id == VerificationDocument.requirement_id)
        .where(
            VerificationDocument.status == "accepted",
            DocumentRequirement.needs_expiry.is_(True),
            DocumentRequirement.active.is_(True),
            VerificationDocument.expires_on >= day,
            VerificationDocument.expires_on <= day + timedelta(days=EXPIRY_NOTICE_DAYS),
            VerificationDocument.id.not_in(noticed),
        )
    ):
        db.add(Audit(action="document.expiry.notice", resource_id=document.id))
        db.add(
            Notification(
                user_id=document.owner_id,
                message="ينتهي «" + document.kind + "» في " + document.expires_on.isoformat() + "؛ يلزم رفع نسخة سارية قبل انتهائه",
            )
        )


def maintenance(db):
    from .subscriptions import invoice_for
    from .models import Plan

    for h in db.scalars(
        select(Household).where(Household.subscription_status == "trial", Household.trial_ends_at < now()).with_for_update()
    ):
        h.subscription_status = "expired"
        db.add(Notification(user_id=h.owner_id, message="انتهت الفترة التجريبية؛ تبقى إدارة الطلبات متاحة"))
    for item in db.scalars(select(Subscription).where(Subscription.status == "active").with_for_update()):
        h = db.get(Household, item.household_id)
        if item.ends_at and item.ends_at < now():
            changed = db.execute(
                update(Subscription).where(Subscription.household_id == h.id, Subscription.status == "active").values(status="expired")
            )
            if changed.rowcount:
                h.subscription_status = "expired"
                db.add(Notification(user_id=h.owner_id, message="انتهى الاشتراك. جدد اشتراكك من لوحة الأسرة"))
        elif item.auto_renew and item.ends_at and item.ends_at < now() + timedelta(days=7):
            plan = db.get(Plan, item.plan_id)
            if not plan or not plan.active:
                continue
            invoice = invoice_for(db, h, plan, item.interval, "renewal-" + item.ends_at.isoformat())
            if not db.scalar(select(Audit).where(Audit.action == "subscription.renewal.notice", Audit.resource_id == invoice.id)):
                db.add(Audit(action="subscription.renewal.notice", resource_id=invoice.id))
                db.add(Notification(user_id=h.owner_id, message="فاتورة تجديد اشتراك جاهزة للمراجعة، دون خصم تلقائي"))
    for order in db.scalars(
        select(Order).where(Order.status.in_(["pending_payment", "pending_acceptance"]), Order.payment_expires_at < now()).with_for_update()
    ):
        changed = db.execute(
            update(Order)
            .where(Order.id == order.id, Order.status.in_(["pending_payment", "pending_acceptance"]))
            .values(status="cancelled", payment_status="expired")
        )
        if changed.rowcount:
            restore_stock(db, order)
            notify(db, order, "انتهت مهلة الطلب وأعيد المخزون")
    db.execute(
        update(Order)
        .where(Order.status == "ready", Order.delivery_method == "paid", Order.driver_id.is_(None), Order.offer_expires_at < now())
        .values(offer_expires_at=now() + timedelta(minutes=15))
    )
    # Offers keep renewing, so alert once when the requested time passes without a driver.
    alerted = select(Audit.resource_id).where(Audit.action == "delivery.no_driver.alert")
    for order in db.scalars(
        select(Order).where(
            Order.status == "ready",
            Order.delivery_method == "paid",
            Order.driver_id.is_(None),
            Order.scheduled_at < now(),
            Order.id.not_in(alerted),
        )
    ):
        db.add(Audit(action="delivery.no_driver.alert", resource_id=order.id))
        notify(db, order, "لم يقبل أي سائق التوصيل حتى موعده؛ الإدارة تتابع الطلب")
        alert = "طلب توصيل بلا سائق تجاوز موعده: " + order.id[:8] + " — راجعه من «تعثر التوصيل»"
        for admin_id in db.scalars(select(User.id).where(User.role == "admin", User.active.is_(True))):
            db.add(Notification(user_id=admin_id, message=alert))
    from sqlalchemy import delete

    db.execute(delete(Session).where(Session.expires_at < now()))
    # Locations are kept only while useful for an ongoing shift or delivery.
    db.execute(delete(DriverPosition).where(DriverPosition.updated_at < now() - timedelta(hours=2)))
    global _swept_at
    if time.monotonic() - _swept_at >= SWEEP_SECONDS:
        _swept_at = time.monotonic()
        compliance_sweep(db)
        db.commit()
        tap_sweep(db)
    db.execute(update(EmailMessage).where(EmailMessage.expires_at < now()).values(body="[انتهت صلاحية الرسالة]"))
    db.commit()


def tap_sweep(db, batch=20):
    """Re-reads Tap charges whose redirect and webhook never arrived, so captured money is always applied or flagged."""
    from fastapi import HTTPException
    from .models_ext import TapCharge
    from .payments import apply_tap_charge
    from .providers import TapPaymentProvider

    if settings.payment_provider != "tap" or not settings.tap_secret_key:
        return
    rows = list(
        db.scalars(
            select(TapCharge)
            .where(
                TapCharge.status == "initiated",
                TapCharge.created_at < now() - timedelta(minutes=10),
                TapCharge.created_at > now() - timedelta(days=3),
            )
            .order_by(TapCharge.updated_at)
            .limit(batch)
        )
    )
    provider = TapPaymentProvider()
    for row in rows:
        charge_id = row.id
        try:
            _, _, outcome = apply_tap_charge(db, provider.get_charge(charge_id))
            if outcome == "pending":
                pending = db.get(TapCharge, charge_id)
                if pending:
                    pending.updated_at = now()
                    db.commit()
        except HTTPException:
            db.rollback()
            log.warning("Tap sweep could not check %s", charge_id)


def process_outbox(db):
    pending = list(
        db.scalars(
            select(Outbox)
            .where(
                Outbox.sent_at.is_(None),
                Outbox.dead_letter.is_(False),
                Outbox.next_attempt_at <= now(),
                or_(Outbox.claimed_until.is_(None), Outbox.claimed_until < now()),
            )
            .order_by(Outbox.next_attempt_at)
            .limit(20)
        )
    )
    for job in pending:
        token = secrets.token_hex(16)
        claimed = db.execute(
            update(Outbox)
            .where(
                Outbox.id == job.id,
                Outbox.sent_at.is_(None),
                Outbox.dead_letter.is_(False),
                or_(Outbox.claimed_until.is_(None), Outbox.claimed_until < now()),
            )
            .values(claimed_until=now() + timedelta(minutes=2), lease_token=token)
        )
        db.commit()
        if not claimed.rowcount:
            continue
        try:
            if job.kind == "telegram":
                if not settings.telegram_bot_token:
                    raise ValueError("telegram_not_configured")
                with httpx.Client(timeout=15, follow_redirects=False) as client:
                    response = client.post("https://api.telegram.org/bot" + settings.telegram_bot_token + "/sendMessage", json=job.payload)
                    response.raise_for_status()
                    if not response.json().get("ok"):
                        raise ValueError("telegram_rejected")
            elif job.kind == "email":
                from .mail import send

                message = db.get(EmailMessage, job.payload["message_id"])
                if not message or message.expires_at < now():
                    raise ValueError("email_expired")
                send(message)
                message.sent_at = now()
                if settings.app_env == "production":
                    message.body = "[تم الإرسال]"
            else:
                raise ValueError("unknown_job")
            db.execute(
                update(Outbox)
                .where(Outbox.id == job.id, Outbox.lease_token == token)
                .values(sent_at=now(), claimed_until=None, lease_token=None, last_error="")
            )
        except Exception as error:
            attempt = job.attempts + 1
            db.execute(
                update(Outbox)
                .where(Outbox.id == job.id, Outbox.lease_token == token)
                .values(
                    attempts=attempt,
                    next_attempt_at=now() + timedelta(seconds=min(3600, 2 ** min(attempt, 11))),
                    claimed_until=None,
                    lease_token=None,
                    dead_letter=attempt >= 8,
                    last_error=type(error).__name__,
                )
            )
            log.warning("Outbox retry job=%s attempt=%s error_type=%s", job.id, attempt, type(error).__name__)
            if attempt == 8:
                for admin_id in db.scalars(select(User.id).where(User.role == "admin", User.active.is_(True))):
                    db.add(Notification(user_id=admin_id, message="رسالة متعثرة تحتاج مراجعة الإدارة: " + job.id))
        db.commit()
