"""Order chat: customer, family, assigned driver and administration around one order,
with automatic status messages, photos, a reply assistant and the post-delivery review."""

import re
from datetime import timezone
from typing import Optional
from pathlib import Path
from zoneinfo import ZoneInfo
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from .db import get_db
from .models import Order, User, Household, Review, OrderItem, Media, Notification, SupportTicket, uid, now
from .models_ext import OrderChatMessage
from .auth import current_user
from .catalog import save_image
from .config import settings
from .security import limit, audit
import httpx

router = APIRouter(tags=["order_chat"])
SAUDI = ZoneInfo("Asia/Riyadh")
ASSISTANT = "مساعد بيوتنا الذكي 🤖"
OWN_UPLOAD = re.compile(r"/media/([a-f0-9]{32}\.webp)")
MODEL_NAME = re.compile(r"[a-zA-Z0-9._-]{1,100}")
COMPLAINT_WORDS = ["مشكلة", "إلغاء", "الغاء", "تالف", "ناقص", "غلط", "شكوى", "خربان", "متأخر جدا", "سيء", "سيئ"]
# Asking for the administration (the chat's quick "مساعدة الإدارة" button) always reaches it.
ADMIN_HELP_WORDS = ["الإدارة", "الادارة", "مشرف"]

STATUS_AR = {
    "pending_payment": "بانتظار الدفع",
    "pending_acceptance": "بانتظار موافقة الأسرة",
    "confirmed": "تم تأكيد الطلب",
    "preparing": "قيد التجهيز والطهي",
    "ready": "جاهز للاستلام والتوصيل",
    "assigned": "تم إسناد الكابتن",
    "picked_up": "استلم الكابتن الطلب",
    "in_transit": "في الطريق للتسليم",
    "delivered": "تم التسليم بنجاح",
    "completed": "مكتمل",
    "cancelled": "ملغي",
}


def _verify_order_participant(db, order_id: str, user: User) -> tuple[Order, Household, str, str]:
    """Verify user is customer, household owner, assigned driver, or admin. Returns (order, household, role, display_name)."""
    order = db.get(Order, order_id)
    if not order:
        raise HTTPException(404, "الطلب غير موجود")
    household = db.get(Household, order.household_id)

    if user.role == "admin":
        return order, household, "admin", f"إدارة العمليات ({user.name})"
    if order.customer_id == user.id:
        return order, household, "customer", f"العميل ({user.name})"
    if household and household.owner_id == user.id:
        return order, household, "seller", f"مطبخ {household.name}"
    if order.driver_id and order.driver_id == user.id:
        return order, household, "driver", f"الكابتن ({user.name})"

    raise HTTPException(403, "غير مصرح لك بالوصول لمحادثة هذا الطلب")


def trigger_order_chat_status_event(db, order: Order, new_status: str, extra: Optional[str] = None):
    """Post an automated status message whenever the order moves to a new stage."""
    household = db.get(Household, order.household_id)
    h_name = household.name if household else "الأسرة المنتجة"
    driver_name = "الكابتن"
    if order.driver_id:
        driver = db.get(User, order.driver_id)
        if driver:
            driver_name = f"الكابتن {driver.name}"

    messages_map = {
        "pending_acceptance": f"⏳ تم إرسال الطلب إلى مطبخ ({h_name}) وبانتظار المراجعة والاعتماد.",
        "pending_payment": f"✅ وافقت الأسرة المنتجة ({h_name}) على طلبكم! بانتظار إتمام الدفع لبدء التحضير 💳.",
        "confirmed": f"✨ تم سداد قيمة الطلب بنجاح! بدأ مطبخ ({h_name}) الآن في تجهيز وتحضير الوجبة الطازجة 🍳.",
        "preparing": "🍳 بدأت الأسرة الآن في طهي وتحضير الوجبة.",
        "ready": (
            "📦 الطلب جاهز للاستلام من موقع الأسرة 🏠."
            if order.delivery_method == "pickup"
            else "📦 الطلب جاهز ومغلّف، وبانتظار استلام الكابتن 🛵."
        ),
        "assigned": f"🚗 تم إسناد التوصيل إلى ({driver_name})، وهو في طريقه لاستلام الطلب من الأسرة.",
        "picked_up": f"🛵 استلم ({driver_name}) الطلب من الأسرة وهو في الطريق إليكم.",
        "in_transit": "📍 الكابتن في الطريق إليكم الآن. الرجاء الاستعداد للاستلام.",
        "delivered": "🎉 تم تسليم الطلب بنجاح! بالهناء والشفاء ❤️. يسعدنا تقييمكم للوجبة وللكابتن عبر بطاقة التقييم أدناه.",
        "completed": "🎉 تم إكمال واستلام الطلب بنجاح! سعداء بخدمتكم ❤️.",
        "cancelled": "⚠️ تم إلغاء هذا الطلب. إن كان مدفوعًا فستُعيد الإدارة المبلغ عبر بوابة الدفع، وتصلكم رسالة عند تنفيذ الاسترداد.",
    }

    text = messages_map.get(new_status)
    if not text:
        text = f"تم تحديث حالة الطلب إلى: {STATUS_AR.get(new_status, new_status)}"
    if extra and not extra.startswith("تحديث حالة الطلب"):
        text += f" • {extra}"

    # Avoid duplicate consecutive status updates
    last_msg = db.scalar(
        select(OrderChatMessage)
        .where(OrderChatMessage.order_id == order.id)
        .order_by(OrderChatMessage.created_at.desc())
        .limit(1)
    )
    if last_msg and last_msg.content == text:
        return

    db.add(
        OrderChatMessage(
            id=uid(),
            order_id=order.id,
            sender_id=None,
            sender_role="ai",
            sender_name=ASSISTANT,
            message_type="review_prompt" if new_status in ("delivered", "completed") else "status_update",
            content=text,
            image_url=None,
            created_at=now(),
        )
    )


def _within(key: str, maximum: int, window: int) -> bool:
    """Non-raising form of the rate limiter for optional work (assistant replies, notifications)."""
    try:
        limit(key, maximum, window)
        return True
    except HTTPException:
        return False


def _call_gemini_chat(prompt: str, context: dict) -> Optional[str]:
    """Gemini reply when the assistant is enabled; addresses and contact details are never sent."""
    if settings.ai_provider != "gemini" or not settings.ai_api_key or not MODEL_NAME.fullmatch(settings.ai_model or ""):
        return None
    try:
        sys_instruction = (
            "أنت 'مساعد بيوتنا الذكي' في محادثة طلب على منصة 'من بيوتنا' للأسر المنتجة في محافظة الدرب. "
            "أجب باختصار ولطف على استفسارات العميل والأسرة والكابتن. "
            f"بيانات الطلب: رقم {context['order_id'][:8]}، الحالة: {context['status_ar']}، "
            f"الأسرة: {context['household_name']}، الكابتن: {context['driver_name']}، الموعد: {context['scheduled']}، المنتجات: {context['items']}. "
            "لا تخترع معلومات غير موجودة. لا تَعِد بأي إجراء مثل الاسترداد أو التعويض أو الإلغاء أو تغيير العنوان أو إبلاغ الإدارة؛ "
            "هذه قرارات تتخذها الإدارة، وقل إن المشارك يستطيع طلبها هنا وسيُرد عليه."
        )
        body = {
            "systemInstruction": {"parts": [{"text": sys_instruction}]},
            "contents": [{"role": "user", "parts": [{"text": prompt[:1500]}]}],
            "generationConfig": {"temperature": 0.3, "maxOutputTokens": 300},
        }
        with httpx.Client(timeout=10, follow_redirects=False) as client:
            resp = client.post(
                "https://generativelanguage.googleapis.com/v1beta/models/" + settings.ai_model + ":generateContent",
                headers={"x-goog-api-key": settings.ai_api_key},
                json=body,
            )
            if resp.status_code == 200:
                payload = resp.json()
                text = payload["candidates"][0]["content"]["parts"][0]["text"].strip()
                if text:
                    return text[:1500]
    except Exception:
        pass
    return None


def _escalate(db, order: Order, user: User, text: str) -> None:
    """A complaint becomes an open support ticket and an administration alert, once per order and person."""
    existing = db.scalar(
        select(SupportTicket).where(SupportTicket.order_id == order.id, SupportTicket.user_id == user.id, SupportTicket.status == "open")
    )
    if existing:
        return
    db.add(SupportTicket(user_id=user.id, order_id=order.id, message=("بلاغ من محادثة الطلب: " + text)[:1000], status="open"))
    alert = f"بلاغ جديد من محادثة الطلب {order.id[:8]} — راجعه من الدعم"
    for admin_id in db.scalars(select(User.id).where(User.role == "admin", User.active.is_(True))):
        db.add(Notification(user_id=admin_id, message=alert))
    audit(db, user, "order.chat.escalate", order.id)


def _scheduled_text(order: Order) -> str:
    if not order.scheduled_at:
        return "غير محدد"
    return order.scheduled_at.replace(tzinfo=timezone.utc).astimezone(SAUDI).strftime("%Y-%m-%d %H:%M")


def generate_ai_chat_response(db, order: Order, household: Household, user: User, user_role: str, user_text: str) -> Optional[str]:
    """Assistant reply for a text message; complaints are escalated for real before anything is promised."""
    t = user_text.lower().strip()
    h_name = household.name if household else "الأسرة المنتجة"
    wants_admin = user_role != "admin" and any(w in t for w in ADMIN_HELP_WORDS)
    if wants_admin or (user_role in {"customer", "driver"} and any(w in t for w in COMPLAINT_WORDS)):
        _escalate(db, order, user, user_text)
        return "نأسف لذلك. سُجّلت رسالتك بلاغًا لدى فريق الإدارة، وسيتابعه مشرف العمليات معك هنا."

    # A small per-order budget keeps the assistant from answering (and costing) on every message.
    if not _within("chat-ai:" + order.id, 12, 3600):
        return None

    driver_name = "الكابتن"
    if order.driver_id:
        driver = db.get(User, order.driver_id)
        if driver:
            driver_name = f"الكابتن {driver.name}"
    items_list = db.scalars(select(OrderItem.name).where(OrderItem.order_id == order.id)).all()
    status_ar = STATUS_AR.get(order.status, order.status)
    context = {
        "order_id": order.id,
        "status_ar": status_ar,
        "household_name": h_name,
        "driver_name": driver_name,
        "scheduled": _scheduled_text(order),
        "items": "، ".join(items_list) if items_list else "الوجبة",
    }
    ai_answer = _call_gemini_chat(user_text, context)
    if ai_answer:
        return ai_answer

    if any(w in t for w in ["سلام", "مرحبا", "أهلا", "مساء", "صباح"]):
        return f"أهلاً بك! أنا مساعد بيوتنا الذكي 🤖، أتابع معكم الطلب #{order.id[:8]}. كيف أقدر أساعدك؟"

    if any(w in t for w in ["متى", "كم باقي", "تأخر", "وين وصل", "الوقت"]):
        if order.status in ("assigned", "picked_up", "in_transit"):
            return f"{driver_name} يتولى التوصيل الآن 🚗. يمكنكم تتبع موقعه على الخريطة في صفحة الطلب."
        if order.status in ("delivered", "completed"):
            return "الطلب مسجل كمسلّم بنجاح. نتمنى لكم وجبة هنيئة ويسعدنا تقييمكم أدناه ⭐."
        return f"طلبكم حاليًا في مرحلة ({status_ar})، وموعد التسليم المحدد: {_scheduled_text(order)}."

    if any(w in t for w in ["شطة", "ملعقة", "ملاعق", "صوص", "بدون", "حار", "بارد", "تغليف", "زيادة"]):
        return f"وصلت ملاحظتك إلى مطبخ {h_name} عبر هذه المحادثة، وسيُرد عليك هنا 👩‍🍳."

    if any(w in t for w in ["عنوان", "لوكيشن", "موقع", "بيت", "شارع", "تغيير"]):
        if order.delivery_method == "pickup":
            return "هذا الطلب استلام من الأسرة؛ يظهر موقع الاستلام في صفحة الطلب بعد الدفع. لأي تفاصيل اكتب هنا وسترد الأسرة."
        return f"العنوان المسجل للطلب: ({order.address}). إن احتاج تعديلًا فاكتب التفاصيل هنا وسترد الأسرة أو الإدارة."

    if any(w in t for w in ["شكرا", "يسلمو", "يعطيكم العافيه", "تسلم"]):
        return "العفو! في خدمتكم دائمًا ❤️."

    if user_role == "customer":
        return f"وصلت رسالتك إلى مطبخ {h_name}" + (" والكابتن" if order.driver_id else "") + "، وسيُرد عليك هنا 🌹."

    return None


def _notify_participants(db, order: Order, household: Optional[Household], sender: User, role: str) -> None:
    """Tell the other side a message arrived; at most one notice per person and order every ten minutes."""
    recipients = set()
    if role != "customer":
        recipients.add(order.customer_id)
    if role != "seller" and household:
        recipients.add(household.owner_id)
    if role != "driver" and order.driver_id and order.status in {"assigned", "picked_up", "in_transit"}:
        recipients.add(order.driver_id)
    recipients.discard(sender.id)
    for recipient in recipients:
        if _within(f"chat-notify:{order.id}:{recipient}", 1, 600):
            db.add(Notification(user_id=recipient, message="رسالة جديدة في محادثة الطلب • " + order.id[:8]))


def _chat_media_url(order_id: str, url: Optional[str]) -> Optional[str]:
    """Chat photos are private; participants load them through the order, never as public media."""
    match = OWN_UPLOAD.fullmatch(url or "")
    return f"/api/orders/{order_id}/chat/media/{match.group(1)}" if match else None


def _own_upload(db, url: Optional[str], user: User) -> Optional[str]:
    if not url:
        return None
    url = url.strip()
    item = db.get(Media, url) if OWN_UPLOAD.fullmatch(url) else None
    if not item or item.owner_id != user.id or item.public:
        raise HTTPException(422, "أرفق صورة رفعتها من هذه المحادثة")
    return url


@router.get("/orders/{order_id}/chat")
def get_order_chat(order_id: str, user=Depends(current_user), db=Depends(get_db)):
    """Fetch all messages for the order chat. Automatically inits welcome message if new."""
    order, household, role, display_name = _verify_order_participant(db, order_id, user)

    existing_count = db.scalar(select(OrderChatMessage.id).where(OrderChatMessage.order_id == order.id).limit(1))
    if not existing_count:
        db.add(
            OrderChatMessage(
                id=uid(),
                order_id=order.id,
                sender_id=None,
                sender_role="ai",
                sender_name=ASSISTANT,
                message_type="status_update",
                content=(
                    f"مرحباً بكم في غرفة متابعة الطلب #{order.id[:8]}! 🤖 "
                    f"هنا يتواصل العميل ومطبخ ({household.name}) وكابتن التوصيل وفريق الإدارة حول هذا الطلب. "
                    f"يسعدنا استقبال استفساراتكم وملاحظاتكم وصور التجهيز هنا مباشرة."
                ),
                image_url=None,
                created_at=now(),
            )
        )
        trigger_order_chat_status_event(db, order, order.status)
        db.commit()

    messages = db.scalars(
        select(OrderChatMessage).where(OrderChatMessage.order_id == order.id).order_by(OrderChatMessage.created_at.asc())
    ).all()

    review = db.scalar(select(Review).where(Review.order_id == order.id))
    customer = db.get(User, order.customer_id)
    driver = db.get(User, order.driver_id) if order.driver_id else None

    return {
        "order_id": order.id,
        "order_status": order.status,
        "order_status_ar": STATUS_AR.get(order.status, order.status),
        "scheduled_at": order.scheduled_at.isoformat() if order.scheduled_at else None,
        "household_name": household.name if household else "الأسرة المنتجة",
        "customer_name": customer.name if customer else "العميل",
        "driver_name": driver.name if driver else None,
        "current_user_role": role,
        "current_user_name": display_name,
        "delivery_method": order.delivery_method,
        "address": order.address,
        "has_review": review is not None,
        "review": {
            "rating": review.rating,
            "comment": review.comment,
            "driver_rating": review.driver_rating,
            "driver_comment": review.driver_comment,
            "photo_url": _chat_media_url(order.id, review.photo_url),
        }
        if review
        else None,
        "messages": [
            {
                "id": m.id,
                "sender_id": m.sender_id,
                "sender_role": m.sender_role,
                "sender_name": m.sender_name,
                "message_type": m.message_type,
                "content": m.content,
                "image_url": _chat_media_url(order.id, m.image_url),
                "created_at": m.created_at.isoformat(),
            }
            for m in messages
        ],
    }


class SendChatMessageInput(BaseModel):
    content: Optional[str] = Field(default="", max_length=1500)
    image_url: Optional[str] = Field(default=None, max_length=128)


@router.post("/orders/{order_id}/chat/messages")
def send_order_chat_message(order_id: str, data: SendChatMessageInput, user=Depends(current_user), db=Depends(get_db)):
    """Send a message to the order chat and get an assistant reply when useful."""
    order, household, role, display_name = _verify_order_participant(db, order_id, user)
    limit("chat:" + user.id, 30, 300)

    content = (data.content or "").strip()
    image_url = _own_upload(db, data.image_url, user)

    if not content and not image_url:
        raise HTTPException(422, "يجب إدخال نص أو إرفاق صورة")

    db.add(
        OrderChatMessage(
            id=uid(),
            order_id=order.id,
            sender_id=user.id,
            sender_role=role,
            sender_name=display_name,
            message_type="image" if image_url and not content else "text",
            content=content or "صورة مرفقة",
            image_url=image_url,
            created_at=now(),
        )
    )
    _notify_participants(db, order, household, user, role)

    ai_text = None
    if content:
        ai_text = generate_ai_chat_response(db, order, household, user, role, content)
    elif image_url and role == "seller":
        ai_text = "📸 شكراً لمطبخ الأسرة على مشاركة صورة التجهيز! تظهر الصورة للعميل والكابتن الآن."
    elif image_url and role == "driver":
        ai_text = "📸 شكراً للكابتن على مشاركة صورة إثبات الاستلام/التسليم."

    if ai_text:
        db.add(
            OrderChatMessage(
                id=uid(),
                order_id=order.id,
                sender_id=None,
                sender_role="ai",
                sender_name=ASSISTANT,
                message_type="text",
                content=ai_text,
                image_url=None,
                created_at=now(),
            )
        )

    db.commit()
    return {"ok": True}


@router.post("/orders/{order_id}/chat/upload")
async def upload_chat_image(order_id: str, file: UploadFile = File(...), user=Depends(current_user), db=Depends(get_db)):
    """Upload a photo for the order chat (preparation, packaging, delivery proof); private to the order."""
    _verify_order_participant(db, order_id, user)
    limit("chat-upload:" + user.id, 10, 600)
    raw = await file.read(6 * 1024 * 1024)
    if len(raw) < 100:
        raise HTTPException(422, "الملف غير صالح")
    url = save_image(raw)
    db.add(Media(url=url, owner_id=user.id, public=False))
    db.commit()
    return {"url": url}


@router.get("/orders/{order_id}/chat/media/{filename}")
def chat_media(order_id: str, filename: str, user=Depends(current_user), db=Depends(get_db)):
    """Serves a chat or review photo only to the order's participants."""
    order, *_ = _verify_order_participant(db, order_id, user)
    url = "/media/" + filename
    if not OWN_UPLOAD.fullmatch(url):
        raise HTTPException(404, "الصورة غير موجودة")
    in_chat = db.scalar(select(OrderChatMessage.id).where(OrderChatMessage.order_id == order.id, OrderChatMessage.image_url == url))
    in_review = db.scalar(select(Review.id).where(Review.order_id == order.id, Review.photo_url == url))
    path = Path(settings.media_dir) / filename
    if not (in_chat or in_review) or not path.is_file():
        raise HTTPException(404, "الصورة غير موجودة")
    return FileResponse(path, media_type="image/webp", headers={"Cache-Control": "private, no-store"})


class ChatReviewInput(BaseModel):
    rating: int = Field(ge=1, le=5)
    comment: str = Field(min_length=2, max_length=1000)
    driver_rating: Optional[int] = Field(default=None, ge=1, le=5)
    driver_comment: Optional[str] = Field(default=None, max_length=1000)
    photo_url: Optional[str] = Field(default=None, max_length=128)


@router.post("/orders/{order_id}/chat/review", status_code=201)
def submit_chat_review(order_id: str, data: ChatReviewInput, user=Depends(current_user), db=Depends(get_db)):
    """Submit the rating of the family and, for delivered orders, of the driver from the chat room."""
    order, household, role, display_name = _verify_order_participant(db, order_id, user)

    if order.customer_id != user.id:
        raise HTTPException(403, "تقييم الطلب متاح للعميل صاحب الطلب فقط")
    if order.status not in ("delivered", "completed"):
        raise HTTPException(409, "يمكن التقييم بعد استلام الطلب فقط")
    if db.scalar(select(Review.id).where(Review.order_id == order.id)):
        raise HTTPException(409, "تم تقييم هذا الطلب")
    photo_url = _own_upload(db, data.photo_url, user)
    has_driver = bool(order.driver_id)

    db.add(
        Review(
            order_id=order.id,
            customer_id=user.id,
            household_id=order.household_id,
            rating=data.rating,
            comment=data.comment.strip(),
            driver_id=order.driver_id if has_driver else None,
            driver_rating=data.driver_rating if has_driver else None,
            driver_comment=(data.driver_comment or "").strip() if has_driver else "",
            photo_url=photo_url,
        )
    )

    star_str = "⭐" * data.rating
    driver_star_str = f" • تقييم الكابتن: {'⭐' * data.driver_rating}" if has_driver and data.driver_rating else ""
    db.add(
        OrderChatMessage(
            id=uid(),
            order_id=order.id,
            sender_id=None,
            sender_role="ai",
            sender_name=ASSISTANT,
            message_type="review_submitted",
            content=f"🌟 شكرًا لك على التقييم! تقييم الأسرة: {star_str}{driver_star_str}. رأيك يساعد الأسر والكباتن على تحسين الخدمة ❤️.",
            image_url=photo_url,
            created_at=now(),
        )
    )
    db.commit()
    return {"ok": True}
