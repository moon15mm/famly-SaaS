import httpx
from typing import Protocol, Optional
from fastapi import HTTPException
from .config import settings


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
    BASE_URL = "https://api.tap.company/v2"

    def _headers(self):
        if not settings.tap_secret_key:
            raise HTTPException(503, "لم يتم ضبط مفتاح Tap السري")
        return {
            "Authorization": f"Bearer {settings.tap_secret_key}",
            "Content-Type": "application/json",
            "accept": "application/json",
        }

    def create_order_charge(self, order, customer_user=None) -> dict:
        amount_sar = round(order.total / 100.0, 2)
        c_name = (customer_user.name if customer_user and customer_user.name else "عميل من بيوتنا").strip()
        c_email = (customer_user.email if customer_user and customer_user.email else "customer@min-buyutna.com").strip()
        raw_phone = (customer_user.phone if customer_user and customer_user.phone else "500000000").strip()
        clean_phone = raw_phone.lstrip("0") if len(raw_phone) == 10 and raw_phone.startswith("0") else raw_phone
        if not clean_phone:
            clean_phone = "500000000"

        payload = {
            "amount": amount_sar,
            "currency": "SAR",
            "customer_initiated": True,
            "threeDSecure": True,
            "save_card": False,
            "description": f"طلب من بيوتنا #{order.id[:8]}",
            "statement_descriptor": "MIN BUYUTNA",
            "metadata": {
                "order_id": order.id,
                "customer_id": order.customer_id,
            },
            "reference": {
                "transaction": order.id,
                "order": order.id,
            },
            "customer": {
                "first_name": c_name or "عميل",
                "email": c_email,
                "phone": {
                    "country_code": "966",
                    "number": clean_phone,
                },
            },
            "source": {
                "id": "src_all"
            },
            "redirect": {
                "url": f"{settings.public_origin}/api/payments/tap/redirect?order_id={order.id}"
            },
            "post": {
                "url": f"{settings.public_origin}/api/payments/webhook/tap"
            },
        }

        try:
            with httpx.Client(timeout=15.0) as client:
                resp = client.post(f"{self.BASE_URL}/charges/", json=payload, headers=self._headers())
                if resp.status_code not in (200, 201):
                    raise HTTPException(502, f"خطأ في الاتصال ببوابة Tap: {resp.text}")
                data = resp.json()
                checkout_url = data.get("transaction", {}).get("url")
                if not checkout_url:
                    raise HTTPException(502, "لم يتم استلام رابط الدفع من Tap")
                return {
                    "provider": "tap",
                    "charge_id": data.get("id"),
                    "checkout_url": checkout_url,
                }
        except httpx.RequestError as exc:
            raise HTTPException(502, f"تعذر الوصول لبوابة الدفع Tap: {exc}") from None

    def create_invoice_charge(self, invoice, household_user=None) -> dict:
        amount_sar = round(invoice.amount / 100.0, 2)
        h_name = (household_user.name if household_user and household_user.name else "أسرة منتجة").strip()
        h_email = (household_user.email if household_user and household_user.email else "seller@min-buyutna.com").strip()
        raw_phone = (household_user.phone if household_user and household_user.phone else "500000000").strip()
        clean_phone = raw_phone.lstrip("0") if len(raw_phone) == 10 and raw_phone.startswith("0") else raw_phone
        if not clean_phone:
            clean_phone = "500000000"

        payload = {
            "amount": amount_sar,
            "currency": "SAR",
            "customer_initiated": True,
            "threeDSecure": True,
            "save_card": False,
            "description": f"اشتراك باقة {invoice.plan_name} #{invoice.id[:8]}",
            "statement_descriptor": "MIN BUYUTNA",
            "metadata": {
                "invoice_id": invoice.id,
                "household_id": invoice.household_id,
            },
            "reference": {
                "transaction": invoice.id,
                "order": invoice.id,
            },
            "customer": {
                "first_name": h_name or "أسرة",
                "email": h_email,
                "phone": {
                    "country_code": "966",
                    "number": clean_phone,
                },
            },
            "source": {
                "id": "src_all"
            },
            "redirect": {
                "url": f"{settings.public_origin}/api/payments/tap/redirect?invoice_id={invoice.id}"
            },
            "post": {
                "url": f"{settings.public_origin}/api/payments/webhook/tap"
            },
        }

        try:
            with httpx.Client(timeout=15.0) as client:
                resp = client.post(f"{self.BASE_URL}/charges/", json=payload, headers=self._headers())
                if resp.status_code not in (200, 201):
                    raise HTTPException(502, f"خطأ في الاتصال ببوابة Tap: {resp.text}")
                data = resp.json()
                checkout_url = data.get("transaction", {}).get("url")
                if not checkout_url:
                    raise HTTPException(502, "لم يتم استلام رابط الدفع من Tap")
                return {
                    "provider": "tap",
                    "charge_id": data.get("id"),
                    "checkout_url": checkout_url,
                }
        except httpx.RequestError as exc:
            raise HTTPException(502, f"تعذر الوصول لبوابة الدفع Tap: {exc}") from None

    def get_charge(self, charge_id: str) -> dict:
        try:
            with httpx.Client(timeout=15.0) as client:
                resp = client.get(f"{self.BASE_URL}/charges/{charge_id}", headers=self._headers())
                if resp.status_code != 200:
                    raise HTTPException(502, "تعذر التحقق من حالة المعاملة في Tap")
                return resp.json()
        except httpx.RequestError as exc:
            raise HTTPException(502, f"تعذر الوصول لبوابة Tap: {exc}") from None


def require_test_payment():
    if settings.app_env == "production" or settings.payment_provider != "test":
        raise HTTPException(503, "الدفع التجريبي غير متاح في هذا الوضع")


def require_payment_enabled():
    if settings.payment_provider not in ("test", "tap"):
        raise HTTPException(503, "الدفع غير مفعّل؛ يلزم تفعيل مزود الدفع")
