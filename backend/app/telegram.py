import re
import secrets
from datetime import timedelta
from typing import Protocol
import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from .config import settings
from .db import get_db
from .models import TelegramLink, TelegramUpdate, Household, Product, Category, Outbox, Media, User, now
from .models_ext import TelegramPendingPhoto
from .security import roles, household, digest, limit
from .catalog import save_image, sync_media

router = APIRouter(prefix="/telegram", tags=["telegram"])


class DraftProvider(Protocol):
    def suggest(self, text: str, image_url: str) -> dict: ...


class ExplicitTextProvider:
    """Deterministic extraction, never invents commercial or safety information."""

    def suggest(self, text, image_url):
        normalized = text.translate(str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789"))
        price = re.search(r"السعر\s*[:：]?\s*(\d+(?:[.٫]\d{1,2})?)", normalized)
        stock = re.search(r"الكمية\s*[:：]?\s*(\d+)", normalized)
        hours = re.search(r"(?:التجهيز|خلال)\s*(?:خلال\s*)?(\d+)\s*ساعة", normalized)
        if not price or not stock or not hours:
            raise ValueError("أرسل: اسم المنتج، السعر 85، الكمية 5، التجهيز 24 ساعة")
        from decimal import Decimal

        return {
            "name": normalized.split("،")[0][:150],
            "description": normalized[:3000],
            "price": int(Decimal(price[1].replace("٫", ".")) * 100),
            "stock": int(stock[1]),
            "prep_hours": int(hours[1]),
            "images": [image_url],
            "category_id": "other",
        }


class TestAIProvider(ExplicitTextProvider):
    def suggest(self, text, image_url):
        if settings.app_env == "production":
            raise RuntimeError("Test AI unavailable in production")
        return super().suggest(text, image_url)


def draft_provider():
    if settings.ai_provider == "gemini":
        from .ai import GeminiDraftProvider

        return GeminiDraftProvider()
    if settings.ai_provider == "test":
        return TestAIProvider()
    return ExplicitTextProvider()


async def create_draft(db, h, text, image_url, sender):
    from starlette.concurrency import run_in_threadpool
    from .schemas import ProductInput
    from .catalog import validate_product, ensure_product_capacity

    limit("ai-draft:" + h.id, 10, 3600)
    fields = await run_in_threadpool(draft_provider().suggest, text, image_url)
    if not db.get(Category, fields["category_id"]):
        fields["category_id"] = "other"
    data = ProductInput(**fields, status="draft")
    validate_product(db, h, data)
    ensure_product_capacity(db, h)
    p = Product(household_id=h.id, **data.model_dump())
    db.add(p)
    db.flush()
    pending = db.get(TelegramPendingPhoto, h.id)
    if pending:
        db.delete(pending)
    queue(
        db,
        sender,
        f"مسودة غير منشورة: {p.name}\nالسعر {p.price / 100} ر.س — الكمية {p.stock} — التجهيز {p.prep_hours} ساعة.\nالمراجعة والتعديل: {settings.public_origin}/seller\nللنشر بعد المراجعة: /publish {p.id} تأكيد\nلا نستنتج المكونات أو الحساسية من الصور.",
    )
    return p


@router.post("/link")
def link(user=Depends(roles("seller")), db=Depends(get_db)):
    limit("telegram-link:" + user.id, 5, 300)
    h = household(db, user)
    token = secrets.token_urlsafe(24)
    db.add(TelegramLink(token_hash=digest(token), household_id=h.id, expires_at=now() + timedelta(minutes=10)))
    db.commit()
    return {"command": "/start " + token, "expires_in": 600, "configured": bool(settings.telegram_bot_token)}


def queue(db, chat_id, message):
    db.add(Outbox(kind="telegram", payload={"chat_id": str(chat_id), "text": message}))


async def telegram_photo(file_id):
    if not re.fullmatch(r"[\w-]{1,300}", file_id):
        raise ValueError("file id")
    async with httpx.AsyncClient(timeout=15, follow_redirects=False) as client:
        # Both destinations use a fixed HTTPS Telegram host; untrusted text cannot choose a URL.
        response = await client.get("https://api.telegram.org/bot" + settings.telegram_bot_token + "/getFile", params={"file_id": file_id})
        response.raise_for_status()
        result = response.json().get("result", {})
        path = result.get("file_path", "")
        if result.get("file_size", 0) > 5 * 1024 * 1024 or not re.fullmatch(r"photos/[\w.-]+", path):
            raise ValueError("photo path")
        chunks, length = [], 0
        async with client.stream("GET", "https://api.telegram.org/file/bot" + settings.telegram_bot_token + "/" + path) as stream:
            stream.raise_for_status()
            async for chunk in stream.aiter_bytes():
                length += len(chunk)
                if length > 5 * 1024 * 1024:
                    raise ValueError("photo too large")
                chunks.append(chunk)
        return save_image(b"".join(chunks))


@router.post("/webhook")
async def webhook(request: Request, db=Depends(get_db)):
    if not settings.telegram_bot_token or len(settings.telegram_webhook_secret) < 32:
        raise HTTPException(503, "Telegram غير مهيأ")
    if not secrets.compare_digest(request.headers.get("x-telegram-bot-api-secret-token", ""), settings.telegram_webhook_secret):
        raise HTTPException(401, "مصدر غير مصرح")
    raw = await request.body()
    if len(raw) > 65536:
        raise HTTPException(413, "تحديث كبير جدًا")
    import json

    try:
        update = json.loads(raw)
    except ValueError:
        raise HTTPException(422, "تحديث غير صالح") from None
    update_id = str(update.get("update_id", ""))
    if not update_id.isdigit() or len(update_id) > 30:
        raise HTTPException(422, "معرف تحديث غير صالح")
    if db.get(TelegramUpdate, update_id):
        return {"ok": True, "duplicate": True}
    message = update.get("message", {})
    sender = str(message.get("from", {}).get("id", ""))
    chat = message.get("chat", {})
    if chat.get("type") != "private" or str(chat.get("id")) != sender:
        return {"ok": True}
    limit("telegram:" + sender, 20, 300)
    text = (message.get("text") or message.get("caption") or "")[:4000]
    db.add(TelegramUpdate(id=update_id))
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        return {"ok": True, "duplicate": True}
    if text.startswith("/start "):
        token = db.scalar(select(TelegramLink).where(TelegramLink.token_hash == digest(text.split(" ", 1)[1])).with_for_update())
        if not token or token.expires_at < now():
            queue(db, sender, "رابط غير صالح أو منتهي. أنشئ رمزًا جديدًا من لوحة الأسرة.")
        else:
            h = db.get(Household, token.household_id)
            existing = db.scalar(select(Household).where(Household.telegram_user_id == sender))
            if existing and existing.id != h.id:
                queue(db, sender, "هذا الحساب مرتبط بأسرة أخرى.")
            else:
                h.telegram_user_id = sender
                db.delete(token)
                queue(db, sender, "تم ربط حسابك. أرسل صورة مع اسم المنتج، السعر، الكمية ومدة التجهيز بالساعات. كل منتج يُحفظ مسودة أولًا.")
    else:
        h = db.scalar(select(Household).where(Household.telegram_user_id == sender))
        if h and not db.get(User, h.owner_id).active:
            h = None
        if not h:
            queue(db, sender, "اربط حسابك أولًا من لوحة الأسرة. لن يتم حفظ منتجات غير مصرح بها.")
        elif text.startswith("/publish "):
            parts = text.split()
            p = db.get(Product, parts[1]) if len(parts) == 3 and parts[2] == "تأكيد" else None
            if not p or p.household_id != h.id or p.status != "draft" or not h.verified or not h.pickup_address or not p.images:
                queue(db, sender, "تعذر النشر؛ تحقق من المسودة واعتماد الأسرة وموقع الاستلام. اكتب /publish معرف_المنتج تأكيد")
            else:
                from .schemas import ProductInput
                from .catalog import validate_product

                fields = {k: getattr(p, k) for k in ProductInput.model_fields}
                fields["status"] = "published"
                try:
                    validate_product(db, h, ProductInput(**fields))
                except HTTPException:
                    queue(db, sender, "تعذر النشر؛ راجع الاشتراك والحقول وملكية الصور في لوحة الأسرة")
                    db.commit()
                    return {"ok": True}
                p.status = "published"
                sync_media(db, h)
                queue(db, sender, settings.public_origin + "/product/" + p.id)
        elif message.get("photo"):
            try:
                image_url = await telegram_photo(message["photo"][-1]["file_id"])
                db.add(Media(url=image_url, owner_id=h.owner_id, public=False))
                pending = db.get(TelegramPendingPhoto, h.id)
                if not pending:
                    pending = TelegramPendingPhoto(household_id=h.id, image_url=image_url, expires_at=now() + timedelta(minutes=30))
                    db.add(pending)
                else:
                    pending.image_url, pending.expires_at = image_url, now() + timedelta(minutes=30)
                db.flush()
                if text:
                    await create_draft(db, h, text, image_url, sender)
                else:
                    queue(db, sender, "وصلت الصورة. أرسل اسم المنتج، السعر 85، الكمية 5، التجهيز 24 ساعة خلال 30 دقيقة.")
            except (ValueError, HTTPException):
                queue(db, sender, "تعذر إعداد المسودة. أرسل صورة JPG أو PNG مع: اسم المنتج، السعر 85، الكمية 5، التجهيز 24 ساعة")
            except httpx.HTTPError:
                raise HTTPException(503, "تعذر تنزيل الصورة من Telegram؛ أعد المحاولة") from None
        else:
            pending = db.get(TelegramPendingPhoto, h.id)
            if pending and pending.expires_at > now() and text:
                try:
                    await create_draft(db, h, text, pending.image_url, sender)
                except (ValueError, HTTPException, httpx.HTTPError):
                    queue(db, sender, "لم تنشأ المسودة. تحقق من السعر والكمية ومدة التجهيز ثم أعد المحاولة أو استخدم لوحة الأسرة.")
            else:
                queue(db, sender, "أرسل صورة أولًا ثم البيانات في رسالة أو تعليق؛ الصور المؤقتة تنتهي خلال 30 دقيقة.")
    db.commit()
    return {"ok": True}
