import base64
import hashlib
import hmac
import json
import struct
import time
from fastapi import HTTPException
from sqlalchemy import update
from .config import settings
from .models import User


def totp(secret, counter):
    key = base64.b32decode(secret.upper() + "=" * ((8 - len(secret) % 8) % 8))
    value = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()  # RFC 6238 specifies HMAC-SHA1.
    offset = value[-1] & 15
    number = struct.unpack(">I", value[offset : offset + 4])[0] & 0x7FFFFFFF
    return f"{number % 1000000:06d}"


def verify_admin_mfa(db, user, code):
    try:
        secret = json.loads(settings.admin_totp_secrets).get(user.email, "")
    except (ValueError, AttributeError):
        raise HTTPException(503, "إعداد المصادقة الإضافية غير صالح") from None
    if not secret:
        if settings.app_env == "production":
            raise HTTPException(503, "يلزم إعداد المصادقة الإضافية لهذا المدير قبل الدخول")
        return
    counter = int(time.time() // 30)
    matched = None
    try:
        for candidate in [counter - 1, counter, counter + 1]:
            if hmac.compare_digest(totp(secret, candidate), code):
                matched = candidate
    except (ValueError, TypeError):
        raise HTTPException(503, "إعداد المصادقة الإضافية غير صالح") from None
    if matched is None or matched <= user.mfa_last_counter:
        raise HTTPException(401, "رمز التحقق غير صالح أو سبق استخدامه")
    changed = db.execute(update(User).where(User.id == user.id, User.mfa_last_counter < matched).values(mfa_last_counter=matched))
    if changed.rowcount != 1:
        raise HTTPException(401, "سبق استخدام رمز التحقق")
