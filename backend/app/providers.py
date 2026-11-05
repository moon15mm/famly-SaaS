import logging
import re
import httpx
from typing import Protocol, Optional
from fastapi import HTTPException
from .config import settings

log = logging.getLogger("payments")


class DeliveryProvider(Protocol):
    def quote(self, method: str) -> dict: ...


class TestDeliveryProvider:
    def quote(self, method: str) -> dict:
        if settings.app_env == "production":
            raise HTTPException(503, "يلزم ربط مزود توصيل فعلي")
        return {
            "fee": 2500,
            "distance_km": 5,
            "source": "test",
            "breakdown": "تقدير تجريبي: 15 ريالًا أساس + 5 كم افتراضية × ريالين. ليس مسار طرق فعليًا.",
        }


class PaymentProvider(Protocol):
    def create_checkout(self, order, user=None) -> dict: ...


class TestPaymentProvider:
    def create_checkout(self, order, user=None) -> dict:
        require_test_payment()
        return {
            "provider": "test",
            "order_id": order.id,
            "amount": order.total,
            "notice": "محاكاة داخلية فقط؛ لا تُدخل بيانات بطاقة ولا يتم تحصيل أموال",
        }


class TapPaymentProvider:
    """Thin client for Tap's v2 API. Every state change is confirmed by fetching the charge from Tap itself."""

    BASE_URL = "https://api.tap.company/v2"
    CHARGE_ID = re.compile(r"chg_[A-Za-z0-9_]{6,72}")
    # Tap reports these when the money was not taken; the customer may simply try again.
    FAILED = {"FAILED", "DECLINED", "CANCELLED", "ABANDONED", "VOID", "TIMEDOUT", "RESTRICTED", "REVERSED"}
    REFUND_ACCEPTED = {"REFUNDED", "PENDING", "IN_PROGRESS", "INITIATED"}

    def _headers(self):
        if not settings.tap_secret_key:
            raise HTTPException(503, "لم يتم ضبط مفتاح Tap السري")
        return {
            "Authorization": f"Bearer {settings.tap_secret_key}",
            "Content-Type": "application/json",
            "accept": "application/json",
        }

    @staticmethod
    def _customer(user, fallback_name: str, fallback_email: str) -> dict:
        name = (getattr(user, "name", None) or fallback_name).strip()
        email = (getattr(user, "email", None) or fallback_email).strip()
        phone = str(getattr(user, "phone", None) or "500000000").strip()
        if len(phone) == 10 and phone.startswith("0"):
            phone = phone[1:]
        return {
            "first_name": name or fallback_name,
            "email": email,
            "phone": {"country_code": "966", "number": phone or "500000000"},
        }

    def _post(self, path: str, payload: dict) -> dict:
        try:
            with httpx.Client(timeout=20.0) as client:
                resp = client.post(f"{self.BASE_URL}{path}", json=payload, headers=self._headers())
        except httpx.RequestError as exc:
            log.warning("Tap %s unreachable: %s", path, type(exc).__name__)
            raise HTTPException(502, "تعذر الوصول لبوابة الدفع Tap؛ حاول بعد قليل") from None
        if resp.status_code not in (200, 201):
            log.warning("Tap %s rejected: status=%s body=%s", path, resp.status_code, resp.text[:500])
            raise HTTPException(502, "رفضت بوابة الدفع Tap الطلب؛ حاول بعد قليل أو تواصل مع الدعم")
        return resp.json()

    def _charge(self, payload: dict) -> dict:
        data = self._post("/charges/", payload)
        checkout_url = (data.get("transaction") or {}).get("url")
        charge_id = data.get("id") or ""
        if not checkout_url or not self.CHARGE_ID.fullmatch(charge_id):
            log.warning("Tap charge response without id or checkout url")
            raise HTTPException(502, "لم يتم استلام رابط الدفع من Tap")
        return {"provider": "tap", "charge_id": charge_id, "checkout_url": checkout_url}

    def _payload(self, kind: str, target_id: str, amount: int, description: str, customer: dict, metadata: dict) -> dict:
        return {
            "amount": round(amount / 100.0, 2),
            "currency": "SAR",
            "customer_initiated": True,
            "threeDSecure": True,
            "save_card": False,
            "description": description,
            "statement_descriptor": "MIN BUYUTNA",
            # Only metadata identifies what a charge pays for; Tap echoes it back untouched.
            "metadata": {"kind": kind, **metadata},
            "reference": {"transaction": target_id, "order": target_id},
            "customer": customer,
            "source": {"id": "src_all"},
            "redirect": {"url": f"{settings.public_origin}/api/payments/tap/redirect"},
            "post": {"url": f"{settings.public_origin}/api/payments/webhook/tap"},
        }

    def create_order_charge(self, order, customer_user=None) -> dict:
        customer = self._customer(customer_user, "عميل من بيوتنا", "customer@min-buyutna.com")
        payload = self._payload(
            "order",
            order.id,
            order.total,
            f"طلب من بيوتنا #{order.id[:8]}",
            customer,
            {"order_id": order.id, "customer_id": order.customer_id},
        )
        return self._charge(payload)

    def create_invoice_charge(self, invoice, household_user=None) -> dict:
        customer = self._customer(household_user, "أسرة منتجة", "seller@min-buyutna.com")
        payload = self._payload(
            "invoice",
            invoice.id,
            invoice.amount,
            f"اشتراك باقة {invoice.plan_name} #{invoice.id[:8]}",
            customer,
            {"invoice_id": invoice.id, "household_id": invoice.household_id},
        )
        return self._charge(payload)

    def get_charge(self, charge_id: str) -> dict:
        if not isinstance(charge_id, str) or not self.CHARGE_ID.fullmatch(charge_id):
            raise HTTPException(422, "معرّف معاملة Tap غير صالح")
        try:
            with httpx.Client(timeout=15.0) as client:
                resp = client.get(f"{self.BASE_URL}/charges/{charge_id}", headers=self._headers())
        except httpx.RequestError as exc:
            log.warning("Tap charge lookup unreachable: %s", type(exc).__name__)
            raise HTTPException(502, "تعذر الوصول لبوابة Tap") from None
        if resp.status_code != 200:
            log.warning("Tap charge lookup failed: status=%s", resp.status_code)
            raise HTTPException(502, "تعذر التحقق من حالة المعاملة في Tap")
        data = resp.json()
        if data.get("id") != charge_id:
            raise HTTPException(502, "ردّت Tap بمعاملة مختلفة")
        return data

    def create_refund(self, charge_id: str, amount: int, idempotent: str, reason: str = "requested_by_customer") -> dict:
        """Refunds `amount` halalas of a captured charge. Tap returns the first result again for a repeated key."""
        if not self.CHARGE_ID.fullmatch(charge_id or ""):
            raise HTTPException(422, "لا توجد معاملة Tap صالحة لهذا الاسترداد")
        if reason not in {"duplicate", "fraudulent", "requested_by_customer"}:
            reason = "requested_by_customer"
        data = self._post(
            "/refunds/",
            {
                "charge_id": charge_id,
                "amount": round(amount / 100.0, 2),
                "currency": "SAR",
                "reason": reason,
                "reference": {"merchant": idempotent[:50], "idempotent": idempotent[:100]},
                "metadata": {"charge_id": charge_id},
            },
        )
        status = str(data.get("status") or "").upper()
        if status not in self.REFUND_ACCEPTED or not data.get("id"):
            log.warning("Tap refund not accepted: status=%s", status)
            raise HTTPException(502, "لم تقبل Tap الاسترداد؛ راجع لوحة Tap أو حاول لاحقًا")
        return {"id": str(data["id"]), "status": status}


def require_test_payment():
    if settings.app_env == "production" or settings.payment_provider != "test":
        raise HTTPException(503, "الدفع التجريبي غير متاح في هذا الوضع")


def require_payment_enabled():
    if settings.payment_provider not in ("test", "tap"):
        raise HTTPException(503, "الدفع غير مفعّل؛ يلزم تفعيل مزود الدفع")
    if settings.app_env == "production" and settings.payment_provider == "test":
        raise HTTPException(503, "الدفع التجريبي غير متاح في هذا الوضع")
