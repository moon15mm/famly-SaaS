from datetime import timedelta
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from .db import get_db
from .models import User, Session, Household, Plan, now
from .schemas import Register, Login
from .security import current_user, create_session, digest, hasher, verify_password, limit, audit
from .config import settings
from .mfa import verify_admin_mfa

router = APIRouter(prefix="/auth", tags=["identity"])


def public_user(user):
    return {k: getattr(user, k) for k in ["id", "name", "email", "role", "address", "driver_verified", "available", "email_verified"]}


@router.post("/register", status_code=201)
def register(data: Register, request: Request, response: Response, db=Depends(get_db)):
    limit("register:" + request.client.host, 5, 300)
    user = User(name=data.name, email=data.email.lower().strip(), password_hash=hasher.hash(data.password), role=data.role)
    db.add(user)
    try:
        db.flush()
        if user.role == "seller":
            plan = db.scalar(select(Plan).where(Plan.active.is_(True)).order_by(Plan.monthly_price, Plan.id).limit(1))
            db.add(
                Household(
                    owner_id=user.id,
                    name="متجر " + user.name,
                    plan_id=plan.id if plan else None,
                    trial_ends_at=now() + timedelta(days=plan.trial_days if plan else 14),
                )
            )
        create_session(db, user, response, settings.cookie_secure)
        audit(db, user, "account.register", user.id)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "تعذر إنشاء الحساب بهذا البريد") from None
    return public_user(user)


@router.post("/login")
def login(data: Login, request: Request, response: Response, db=Depends(get_db)):
    limit("login-ip:" + request.client.host, 20, 300)
    limit("login-email:" + digest(data.email.lower()), 10, 300)
    user = db.scalar(select(User).where(User.email == data.email.lower().strip()))
    valid = verify_password(user.password_hash if user else None, data.password)
    if not valid or not user or not user.active:
        raise HTTPException(401, "البريد أو كلمة المرور غير صحيحة")
    if user.role == "admin":
        verify_admin_mfa(db, user, data.otp)
    if hasher.check_needs_rehash(user.password_hash):
        user.password_hash = hasher.hash(data.password)
    old_token = request.cookies.get("session")
    if old_token:
        old = db.get(Session, digest(old_token))
        if old:
            db.delete(old)
    create_session(db, user, response, settings.cookie_secure)
    audit(db, user, "account.login", user.id)
    db.commit()
    return public_user(user)


@router.get("/me")
def me(user=Depends(current_user)):
    return public_user(user)


@router.post("/logout")
def logout(request: Request, response: Response, db=Depends(get_db)):
    item = db.get(Session, digest(request.cookies.get("session", "")))
    if item:
        db.delete(item)
        db.commit()
    response.delete_cookie("session", path="/")
    return {"ok": True}
