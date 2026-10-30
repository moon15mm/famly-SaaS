import hashlib
import secrets
import threading
import time
from collections import defaultdict, deque
from datetime import timedelta
from argon2 import PasswordHasher
from argon2.exceptions import VerificationError, InvalidHashError
from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session as DBSession
from .db import get_db
from .models import User, Session, Household, Audit, now

hasher = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=2)
dummy_hash = hasher.hash(secrets.token_urlsafe(32))
attempts = defaultdict(deque)
limiter_lock = threading.Lock()


def digest(value: str):
    return hashlib.sha256(value.encode()).hexdigest()


def limit(key: str, maximum=10, window=60):
    with limiter_lock:
        stamp = time.monotonic()
        if len(attempts) > 10000:
            stale = [k for k, v in attempts.items() if not v or v[-1] < stamp - 3600]
            for item in stale:
                attempts.pop(item, None)
        bucket = attempts[key]
        while bucket and bucket[0] < stamp - window:
            bucket.popleft()
        if len(bucket) >= maximum:
            raise HTTPException(429, "طلبات كثيرة؛ حاول بعد قليل")
        bucket.append(stamp)


def current_user(request: Request, db: DBSession = Depends(get_db)):
    token = request.cookies.get("session", "")
    session = db.get(Session, digest(token)) if token else None
    if not session or session.expires_at < now():
        raise HTTPException(401, "يرجى تسجيل الدخول")
    user = db.get(User, session.user_id)
    if not user or not user.active:
        raise HTTPException(401, "الحساب غير متاح")
    return user


def roles(*allowed):
    def dependency(user=Depends(current_user)):
        if user.role not in allowed:
            raise HTTPException(403, "لا تملك صلاحية هذا الإجراء")
        return user

    return dependency


def household(db, user):
    result = db.scalar(select(Household).where(Household.owner_id == user.id))
    if not result:
        raise HTTPException(404, "لم يتم إنشاء المتجر")
    return result


def audit(db, user, action, resource):
    db.add(Audit(actor_id=user.id if user else None, action=action, resource_id=str(resource)))


def create_session(db, user, response, secure):
    token = secrets.token_urlsafe(48)
    db.add(Session(token_hash=digest(token), user_id=user.id, expires_at=now() + timedelta(days=7)))
    response.set_cookie("session", token, max_age=604800, httponly=True, secure=secure, samesite="lax", path="/")


def verify_password(encoded, password):
    try:
        return hasher.verify(encoded or dummy_hash, password)
    except (VerificationError, InvalidHashError):
        return False
