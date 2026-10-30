import secrets
from datetime import timedelta
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import select, update, delete
from .config import settings
from .db import get_db
from .models import User, Session, Outbox, now
from .models_ext import ActionToken, EmailMessage, DataRequest
from .security import current_user, digest, limit, hasher, verify_password, create_session, audit

router = APIRouter(tags=["account lifecycle"])


class EmailInput(BaseModel):
    email: str = Field(max_length=254, pattern=r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


class TokenInput(BaseModel):
    token: str = Field(min_length=20, max_length=200)


class ResetInput(TokenInput):
    password: str = Field(min_length=12, max_length=128)


class PasswordInput(BaseModel):
    current_password: str = Field(max_length=128)
    password: str = Field(min_length=12, max_length=128)


def issue_token(db, user, purpose):
    db.execute(
        update(ActionToken)
        .where(ActionToken.user_id == user.id, ActionToken.purpose == purpose, ActionToken.used_at.is_(None))
        .values(used_at=now())
    )
    token = secrets.token_urlsafe(40)
    expiry = now() + timedelta(minutes=30)
    db.add(ActionToken(token_hash=digest(token), user_id=user.id, purpose=purpose, expires_at=expiry))
    route = "reset-password" if purpose == "reset" else "verify-email"
    message = EmailMessage(
        recipient=user.email,
        subject="استعادة حسابك" if purpose == "reset" else "تأكيد بريدك الإلكتروني",
        body=f"{settings.public_origin}/{route}?token={token}\nالرابط صالح لمدة 30 دقيقة ويستخدم مرة واحدة.",
        expires_at=expiry,
    )
    db.add(message)
    db.flush()
    if settings.mail_transport == "smtp":
        db.add(Outbox(kind="email", payload={"message_id": message.id}))
    return message


def consume(db, token, purpose):
    item = db.scalar(select(ActionToken).where(ActionToken.token_hash == digest(token), ActionToken.purpose == purpose).with_for_update())
    if not item or item.used_at or item.expires_at < now():
        raise HTTPException(422, "الرابط غير صالح أو منتهي أو سبق استخدامه")
    changed = db.execute(
        update(ActionToken)
        .where(ActionToken.token_hash == item.token_hash, ActionToken.used_at.is_(None), ActionToken.expires_at > now())
        .values(used_at=now())
    )
    if changed.rowcount != 1:
        raise HTTPException(409, "سبق استخدام الرابط")
    user = db.get(User, item.user_id)
    if not user or not user.active:
        raise HTTPException(422, "الرابط غير صالح")
    return user


@router.post("/auth/forgot-password")
def forgot(data: EmailInput, request: Request, db=Depends(get_db)):
    limit("reset-ip:" + request.client.host, 5, 300)
    limit("reset-email:" + digest(data.email.lower()), 3, 300)
    user = db.scalar(select(User).where(User.email == data.email.strip().lower(), User.active.is_(True)))
    if user and settings.mail_transport in {"local", "smtp"}:
        issue_token(db, user, "reset")
        db.commit()
    return {
        "message": "إذا كان البريد مسجلًا ومهيأً للإرسال فستصلك تعليمات الاستعادة",
        "local_mailbox": settings.app_env != "production" and settings.mail_transport == "local",
    }


@router.post("/auth/reset-password")
def reset(data: ResetInput, request: Request, db=Depends(get_db)):
    limit("reset-use:" + request.client.host, 10, 300)
    user = consume(db, data.token, "reset")
    user.password_hash = hasher.hash(data.password)
    db.execute(delete(Session).where(Session.user_id == user.id))
    audit(db, user, "account.password.reset", user.id)
    db.commit()
    return {"ok": True}


@router.post("/auth/verification")
def verification(user=Depends(current_user), db=Depends(get_db)):
    limit("verify:" + user.id, 3, 300)
    if not user.email_verified:
        if settings.mail_transport not in {"local", "smtp"}:
            raise HTTPException(503, "إرسال البريد غير مهيأ")
        issue_token(db, user, "verify")
        db.commit()
    return {"ok": True, "local_mailbox": settings.app_env != "production" and settings.mail_transport == "local"}


@router.post("/auth/verify-email")
def verify(data: TokenInput, db=Depends(get_db)):
    user = consume(db, data.token, "verify")
    user.email_verified = True
    audit(db, user, "account.email.verified", user.id)
    db.commit()
    return {"ok": True}


@router.post("/auth/change-password")
def change(data: PasswordInput, response: Response, user=Depends(current_user), db=Depends(get_db)):
    limit("password:" + user.id, 5, 300)
    if not verify_password(user.password_hash, data.current_password):
        raise HTTPException(401, "كلمة المرور الحالية غير صحيحة")
    user.password_hash = hasher.hash(data.password)
    db.execute(
        update(ActionToken)
        .where(ActionToken.user_id == user.id, ActionToken.purpose == "reset", ActionToken.used_at.is_(None))
        .values(used_at=now())
    )
    db.execute(delete(Session).where(Session.user_id == user.id))
    create_session(db, user, response, settings.cookie_secure)
    audit(db, user, "account.password.changed", user.id)
    db.commit()
    return {"ok": True}


@router.get("/dev/mailbox")
def mailbox(request: Request, email: str = "", db=Depends(get_db)):
    if (
        settings.app_env == "production"
        or settings.mail_transport != "local"
        or request.client.host not in {"127.0.0.1", "::1", "testclient"}
    ):
        raise HTTPException(404, "الصفحة غير موجودة")
    return [
        {"id": m.id, "subject": m.subject, "body": m.body, "created_at": m.created_at}
        for m in db.scalars(
            select(EmailMessage)
            .where(EmailMessage.recipient == email.lower().strip(), EmailMessage.expires_at > now())
            .order_by(EmailMessage.created_at.desc())
            .limit(10)
        )
    ]


@router.get("/account/export")
def export(user=Depends(current_user), db=Depends(get_db)):
    from .models_ext import Address
    from .models import Order
    from .orders import order_json

    return {
        "account": {"id": user.id, "name": user.name, "email": user.email, "role": user.role, "email_verified": user.email_verified},
        "addresses": [
            {k: getattr(a, k) for k in ["label", "city", "details", "phone", "latitude", "longitude"]}
            for a in db.scalars(select(Address).where(Address.user_id == user.id))
        ],
        "orders": [order_json(db, o, user) for o in db.scalars(select(Order).where(Order.customer_id == user.id))],
    }


@router.post("/account/deletion-request", status_code=201)
def deletion(user=Depends(current_user), db=Depends(get_db)):
    existing = db.scalar(
        select(DataRequest).where(DataRequest.user_id == user.id, DataRequest.kind == "delete", DataRequest.status == "pending")
    )
    if not existing:
        existing = DataRequest(user_id=user.id, kind="delete")
        db.add(existing)
        audit(db, user, "privacy.delete.request", user.id)
        db.commit()
    return {
        "id": existing.id,
        "status": existing.status,
        "message": "تم تسجيل الطلب للمراجعة مع مراعاة الالتزامات النظامية والطلبات القائمة",
    }
