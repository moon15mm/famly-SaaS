from typing import Protocol
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
    def create_checkout(self, order) -> dict: ...


class TestPaymentProvider:
    def create_checkout(self, order) -> dict:
        require_test_payment()
        return {
            "provider": "test",
            "order_id": order.id,
            "amount": order.total,
            "notice": "محاكاة داخلية فقط؛ لا تُدخل بيانات بطاقة ولا يتم تحصيل أموال",
        }


def require_test_payment():
    if settings.app_env == "production" or settings.payment_provider != "test":
        raise HTTPException(503, "الدفع غير مفعّل؛ يلزم اعتماد وربط مزود دفع للسوق متعدد البائعين")
