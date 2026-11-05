import json
import re
from datetime import timedelta
import httpx
from fastapi.testclient import TestClient
from sqlalchemy import select
from app.main import app
from app.config import settings
from app.models import Household, Product, Plan, Outbox, now
from app.models_ext import EmailMessage, ActionToken, Invoice, Subscription, ScheduleSlot, TelegramPendingPhoto
from app.security import digest


def test_disabled_seller_cannot_receive_new_orders(setup, checkout_data):
    _, c = setup
    assert c["admin"].post("/api/admin/users/seller/status?active=false").status_code == 200
    assert c["seller"].get("/api/auth/me").status_code == 401
    assert c["customer"].post("/api/checkout/quote", json=checkout_data).status_code == 409
    assert c["customer"].post("/api/orders", json=checkout_data).status_code == 409


def test_driver_issue_reoffer_and_disable_requires_reassignment(setup, checkout_data):
    from app.models import Order, User

    factory, c = setup
    with factory() as db:
        order = Order(
            customer_id="customer",
            household_id="seller",
            status="ready",
            payment_status="paid",
            delivery_method="paid",
            address="عنوان اختبار فقط",
            scheduled_at=now() + timedelta(days=2),
            subtotal=8500,
            delivery_fee=2000,
            total=10500,
            idempotency_key="issue-test-order-key",
            request_hash="test",
            offer_expires_at=now() + timedelta(minutes=15),
            payment_expires_at=now() + timedelta(minutes=20),
        )
        db.add(order)
        db.commit()
        oid = order.id
    assert c["driver"].post("/api/driver/offers/" + oid + "/accept").status_code == 200
    assert c["admin"].post("/api/admin/users/driver/status?active=false").status_code == 409
    assert c["driver"].post("/api/driver/trips/" + oid + "/issue", json={"reason": "تعذر الحضور قبل استلام الطلب"}).status_code == 201
    assert not any(o["id"] == oid for o in c["driver"].get("/api/driver/offers").json())
    assert c["driver2"].post("/api/driver/offers/" + oid + "/accept").status_code == 200
    with factory() as db:
        db.get(Order, oid).status = "picked_up"
        db.commit()
    assert (
        c["admin"].post("/api/admin/delivery/" + oid + "/reassign", json={"note": "مراجعة عودة الطلب بعد تعثر الرحلة"}).status_code == 409
    )
    assert (
        c["admin"]
        .post("/api/admin/delivery/" + oid + "/reassign", json={"returned_to_seller": True, "note": "تحققت الإدارة من عودة الطلب للأسرة"})
        .status_code
        == 200
    )
    with factory() as db:
        assert db.get(User, "driver2").active_trip_id is None
        assert db.get(Order, oid).status == "ready"


def test_smtp_connector_requires_tls_and_sends_account_message(setup, monkeypatch):
    import ssl
    import smtplib
    from app.mail import send

    calls = []

    class FakeSMTP:
        def __init__(self, host, port, timeout):
            assert host == "smtp.example.test" and port == 587 and timeout == 20

        def starttls(self, context):
            assert context.check_hostname and context.verify_mode == ssl.CERT_REQUIRED
            calls.append("tls")

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def login(self, user, password):
            calls.append("authenticated")

        def send_message(self, message):
            assert message["To"] == "customer@example.test"
            assert "one-time-link" in message.get_content()
            calls.append("sent")

    monkeypatch.setattr(smtplib, "SMTP", FakeSMTP)
    for key, value in {
        "mail_transport": "smtp",
        "smtp_host": "smtp.example.test",
        "smtp_port": 587,
        "smtp_from": "accounts@example.test",
        "smtp_user": "test-user",
        "smtp_password": "test-only",
    }.items():
        monkeypatch.setattr(settings, key, value)
    send(EmailMessage(recipient="customer@example.test", subject="استعادة الحساب", body="one-time-link"))
    assert calls == ["tls", "authenticated", "sent"]


def email_token(factory, recipient):
    with factory() as db:
        message = db.scalar(select(EmailMessage).where(EmailMessage.recipient == recipient).order_by(EmailMessage.created_at.desc()))
        return re.search(r"token=([^\s]+)", message.body)[1]


def test_password_reset_is_private_single_use_and_revokes_sessions(setup):
    factory, c = setup
    with TestClient(app) as anonymous:
        known = anonymous.post("/api/auth/forgot-password", json={"email": "customer@example.test"})
        unknown = anonymous.post("/api/auth/forgot-password", json={"email": "nobody@example.test"})
        assert known.json() == unknown.json()
        token = email_token(factory, "customer@example.test")
        new = "a-different-long-password"
        assert anonymous.post("/api/auth/reset-password", json={"token": token, "password": new}).status_code == 200
        assert c["customer"].get("/api/auth/me").status_code == 401
        assert anonymous.post("/api/auth/reset-password", json={"token": token, "password": new}).status_code == 422
        assert anonymous.post("/api/auth/login", json={"email": "customer@example.test", "password": new}).status_code == 200


def test_email_verification_expiration_and_no_public_production_mailbox(setup, monkeypatch):
    factory, c = setup
    assert c["customer"].post("/api/auth/verification").status_code == 200
    token = email_token(factory, "customer@example.test")
    assert c["customer"].post("/api/auth/verify-email", json={"token": token}).status_code == 200
    assert c["customer"].get("/api/auth/me").json()["email_verified"] is True
    assert c["customer"].post("/api/auth/verify-email", json={"token": token}).status_code == 422
    c["seller"].post("/api/auth/verification")
    other = email_token(factory, "seller@example.test")
    with factory() as db:
        db.get(ActionToken, digest(other)).expires_at = now() - timedelta(seconds=1)
        db.commit()
    assert c["seller"].post("/api/auth/verify-email", json={"token": other}).status_code == 422
    monkeypatch.setattr(settings, "app_env", "production")
    assert c["customer"].get("/api/dev/mailbox?email=customer@example.test").status_code == 404


def test_authenticated_password_change_requires_old_password(setup):
    factory, c = setup
    assert (
        c["customer"].post("/api/auth/change-password", json={"current_password": "wrong", "password": "a-long-new-password"}).status_code
        == 401
    )
    assert c["customer"].post("/api/auth/forgot-password", json={"email": "customer@example.test"}).status_code == 200
    old_token = email_token(factory, "customer@example.test")
    assert (
        c["customer"]
        .post("/api/auth/change-password", json={"current_password": "test-only-long-password", "password": "a-long-new-password"})
        .status_code
        == 200
    )
    assert c["customer"].get("/api/auth/me").status_code == 200
    assert c["customer"].post("/api/auth/reset-password", json={"token": old_token, "password": "a-newer-long-password"}).status_code == 422


def test_addresses_ownership_coordinates_and_defaults(setup):
    _, c = setup
    data = {
        "label": "المنزل",
        "city": "الرياض",
        "details": "حي تجريبي شارع الاختبار",
        "latitude": 24.7,
        "longitude": 46.6,
        "is_default": True,
    }
    first = c["customer"].post("/api/addresses", json=data)
    assert first.status_code == 201
    second = c["customer"].post("/api/addresses", json={**data, "label": "العمل"}).json()
    assert sum(a["is_default"] for a in c["customer"].get("/api/addresses").json()) == 1
    assert c["seller"].put("/api/addresses/" + second["id"], json=data).status_code == 404
    assert c["seller"].delete("/api/addresses/" + second["id"]).status_code == 404
    assert c["customer"].post("/api/addresses", json={**data, "longitude": None}).status_code == 422
    assert c["customer"].delete("/api/addresses/" + second["id"]).status_code == 200


def test_capacity_is_reserved_and_released_with_cancellation(setup, checkout_data):
    factory, c = setup
    with factory() as db:
        db.get(Household, "seller").slot_capacity = 1
        db.commit()
    first = c["customer"].post("/api/orders", json=checkout_data)
    assert first.status_code == 201
    second = {**checkout_data, "idempotency_key": "second-capacity-order-key", "items": [{"product_id": "product0", "quantity": 1}]}
    assert c["customer"].post("/api/orders", json=second).status_code == 409
    assert c["customer"].post("/api/orders/" + first.json()["id"] + "/transition?state=cancelled").status_code == 200
    assert c["customer"].post("/api/orders", json=second).status_code == 201
    with factory() as db:
        assert db.scalar(select(ScheduleSlot)).reserved == 1
        assert db.get(Product, "product0").stock == 4


def test_options_are_server_priced_and_share_stock(setup, checkout_data):
    factory, c = setup
    with factory() as db:
        db.get(Product, "product0").options = [
            {"id": "large", "name": "كبير", "price_delta": 2000},
            {"id": "small", "name": "صغير", "price_delta": -1000},
        ]
        db.commit()
    assert c["customer"].post("/api/orders", json=checkout_data).status_code == 422
    checkout_data["items"] = [
        {"product_id": "product0", "quantity": 2, "option_id": "large", "unit_price": 1},
        {"product_id": "product0", "quantity": 1, "option_id": "small"},
    ]
    r = c["customer"].post("/api/orders", json=checkout_data)
    assert r.status_code == 201
    assert r.json()["total"] == 28650
    assert {i["option_label"] for i in r.json()["items"]} == {"كبير", "صغير"}
    with factory() as db:
        assert db.get(Product, "product0").stock == 2


def test_subscription_annual_invoice_pay_replay_and_tenant_isolation(setup):
    factory, c = setup
    created = (
        c["admin"]
        .post("/api/admin/plans", json={"name": "باقة سنوية", "monthly_price": 4900, "annual_price": 49000, "product_limit": 60})
        .json()
    )
    body = {"plan_id": created["id"], "interval": "annual", "idempotency_key": "subscription-key-12345", "amount": 1}
    invoice = c["seller"].post("/api/seller/subscription/invoices", json=body)
    assert invoice.status_code == 201 and invoice.json()["amount"] == 49000
    iid = invoice.json()["id"]
    assert c["seller"].post("/api/seller/subscription/invoices", json=body).json()["id"] == iid
    assert c["seller2"].post("/api/seller/subscription/invoices/" + iid + "/test-pay").status_code == 404
    assert c["seller2"].get("/api/subscription/invoices/" + iid).status_code == 404
    assert c["seller"].post("/api/seller/subscription/invoices/" + iid + "/test-pay?outcome=failed").json()["status"] == "failed"
    paid = c["seller"].post("/api/seller/subscription/invoices/" + iid + "/test-pay").json()
    assert paid["status"] == "paid"
    again = c["seller"].post("/api/seller/subscription/invoices/" + iid + "/test-pay").json()
    assert again["duplicate"] is True and again["period_end"] == paid["period_end"]
    with factory() as db:
        assert db.get(Household, "seller").subscription_status == "active"
        assert db.get(Subscription, "seller").status == "active"


def test_subscription_renewal_notice_and_expiration(setup, monkeypatch):
    from app import worker

    factory, c = setup
    with factory() as db:
        plan = Plan(id="plan", name="شهرية", monthly_price=4900, product_limit=30)
        db.add(plan)
        db.flush()
        db.add(
            Subscription(
                household_id="seller",
                plan_id="plan",
                interval="monthly",
                status="active",
                ends_at=now() + timedelta(days=3),
                auto_renew=True,
            )
        )
        db.get(Household, "seller").subscription_status = "active"
        db.commit()
    monkeypatch.setattr(worker, "SessionLocal", factory)
    worker.tick()
    worker.tick()
    with factory() as db:
        assert len(list(db.scalars(select(Invoice)))) == 1
        db.get(Subscription, "seller").ends_at = now() - timedelta(seconds=1)
        db.commit()
    worker.tick()
    with factory() as db:
        assert db.get(Subscription, "seller").status == "expired"
        assert db.get(Household, "seller").subscription_status == "expired"


def test_private_documents_signed_links_bound_to_identity(setup, image_bytes):
    _, c = setup
    uploaded = c["seller"].post("/api/verification/documents?kind=وثيقة نشاط", files={"file": ("scan.png", image_bytes, "image/png")})
    assert uploaded.status_code == 201
    did = uploaded.json()["id"]
    link = c["seller"].post("/api/verification/documents/" + did + "/link").json()["url"]
    assert c["seller"].get(link).status_code == 200
    assert c["seller2"].get(link).status_code == 404
    assert c["seller"].get(link.replace("signature=", "signature=broken")).status_code == 403
    assert c["seller2"].post("/api/verification/documents/" + did + "/link").status_code == 404
    assert c["customer"].post("/api/admin/verification/" + did + "/review", json={"status": "accepted", "note": "ok"}).status_code == 403
    assert (
        c["admin"].post("/api/admin/verification/" + did + "/review", json={"status": "accepted", "note": "تمت المراجعة"}).json()["status"]
        == "accepted"
    )
    assert (
        c["seller"].post("/api/verification/documents", files={"file": ("bad.pdf", b"%PDF<script>", "application/pdf")}).status_code == 422
    )


def test_export_and_privacy_requests_do_not_expose_authentication(setup):
    _, c = setup
    response = c["customer"].get("/api/account/export")
    assert response.status_code == 200 and "password_hash" not in response.text and "token_hash" not in response.text
    first = c["customer"].post("/api/account/deletion-request").json()
    assert c["customer"].post("/api/account/deletion-request").json()["id"] == first["id"]
    assert c["seller"].get("/api/admin/privacy-requests").status_code == 403
    assert len(c["admin"].get("/api/admin/privacy-requests").json()) == 1


def test_outbox_claims_retry_and_dead_letter(setup):
    from app.jobs import process_outbox

    factory, c = setup
    with factory() as db:
        job = Outbox(kind="not-a-provider", payload={})
        db.add(job)
        db.commit()
        jid = job.id
        for _ in range(8):
            db.get(Outbox, jid).next_attempt_at = now() - timedelta(seconds=1)
            db.commit()
            process_outbox(db)
        assert db.get(Outbox, jid).dead_letter is True
        assert db.get(Outbox, jid).attempts == 8
    assert c["seller"].get("/api/admin/outbox").status_code == 403
    assert c["admin"].post("/api/admin/outbox/" + jid + "/retry").status_code == 200


def test_telegram_separate_image_message_and_explicit_approval(setup, image_bytes, monkeypatch):
    from app import telegram
    from app.catalog import save_image

    factory, c = setup
    monkeypatch.setattr(settings, "telegram_bot_token", "test-token")
    monkeypatch.setattr(settings, "telegram_webhook_secret", "test-secret-long-enough-for-telegram-webhook")

    async def photo(_):
        return save_image(image_bytes)

    monkeypatch.setattr(telegram, "telegram_photo", photo)
    command = c["seller"].post("/api/telegram/link").json()["command"]

    def send(update_id, message):
        return c["customer"].post(
            "/api/telegram/webhook",
            json={"update_id": update_id, "message": {"from": {"id": 12345}, "chat": {"id": 12345, "type": "private"}, **message}},
            headers={"x-telegram-bot-api-secret-token": settings.telegram_webhook_secret},
        )

    assert send(100, {"text": command}).status_code == 200
    assert send(101, {"photo": [{"file_id": "test_photo_id"}]}).status_code == 200
    with factory() as db:
        assert db.get(TelegramPendingPhoto, "seller") is not None
    assert send(102, {"text": "كيكة، السعر 85، الكمية 5، التجهيز 24 ساعة"}).status_code == 200
    with factory() as db:
        draft = db.scalar(select(Product).where(Product.household_id == "seller", Product.status == "draft"))
        assert draft and draft.price == 8500
        pid = draft.id
    assert send(102, {"text": "ignored"}).json()["duplicate"] is True
    assert send(103, {"text": "/publish " + pid}).status_code == 200
    with factory() as db:
        assert db.get(Product, pid).status == "draft"
    assert send(104, {"text": "/publish " + pid + " تأكيد"}).status_code == 200
    with factory() as db:
        assert db.get(Product, pid).status == "published"


def test_ai_connector_preserves_commercial_fields_and_rejects_extra_claims(setup, image_bytes, monkeypatch):
    from app.ai import GeminiDraftProvider
    from app.catalog import save_image

    url = save_image(image_bytes)
    monkeypatch.setattr(settings, "ai_api_key", "unit-test-not-a-live-key")
    monkeypatch.setattr(settings, "ai_model", "configured-test-model")
    real_client = httpx.Client

    def handler(request):
        assert request.url.host == "generativelanguage.googleapis.com"
        body = json.loads(request.content)
        assert body["contents"][0]["parts"][1]["inlineData"]["mimeType"] == "image/webp"
        result = {"name": "اسم مقترح", "description": "منتج منزلي للتجربة", "category_id": "sweets"}
        return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": json.dumps(result)}]}}]})

    monkeypatch.setattr(httpx, "Client", lambda **kwargs: real_client(transport=httpx.MockTransport(handler)))
    result = GeminiDraftProvider().suggest("كيكة، السعر 85، الكمية 5، التجهيز 24 ساعة", url)
    assert result["price"] == 8500 and result["stock"] == 5 and result["prep_hours"] == 24
    assert result["name"] == "اسم مقترح"
