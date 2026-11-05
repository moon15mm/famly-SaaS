import hashlib
import hmac
import json
from datetime import timedelta
from fastapi.testclient import TestClient
from sqlalchemy import select
from app.main import app
from app.config import settings
from app.models import Product, Order, PaymentEvent, Ledger, Notification, Session, now
from app.security import digest


def test_registration_login_and_logout(setup):
    with TestClient(app, headers={"Origin": settings.public_origin}) as client:
        data = {"name": "عميل جديد", "email": "new@example.test", "password": "a-long-unique-test-password"}
        r = client.post("/api/auth/register", json=data)
        assert r.status_code == 201
        assert "HttpOnly" in r.headers["set-cookie"]
        assert client.get("/api/auth/me").json()["role"] == "customer"
        assert client.post("/api/auth/logout").status_code == 200
        assert client.get("/api/auth/me").status_code == 401
        assert client.post("/api/auth/login", json={"email": data["email"], "password": "wrong"}).status_code == 401
        assert client.post("/api/auth/login", json={"email": data["email"], "password": data["password"]}).status_code == 200


def test_cannot_register_admin(setup):
    client = TestClient(app)
    assert (
        client.post(
            "/api/auth/register", json={"name": "Admin", "email": "bad@example.test", "password": "long-password-test", "role": "admin"}
        ).status_code
        == 422
    )


def test_seller_product_isolation(setup):
    _, c = setup
    data = {
        "name": "اسم معدل",
        "description": "وصف",
        "price": 1000,
        "stock": 3,
        "category_id": "food",
        "images": ["/media/sample.webp"],
        "status": "published",
    }
    assert c["seller2"].put("/api/seller/products/product0", json=data).status_code == 404
    assert c["seller2"].delete("/api/seller/products/product0").status_code == 404
    assert c["seller"].put("/api/seller/products/product0", json=data).status_code == 200
    assert c["customer"].get("/api/seller/products").status_code == 403
    assert c["seller"].get("/api/admin/audit").status_code == 403


def test_upload_reencodes_and_rejects_invalid(setup, image_bytes):
    _, c = setup
    good = c["seller"].post("/api/seller/media", files={"file": ("../../evil.png", image_bytes, "image/png")})
    assert good.status_code == 201
    assert good.json()["url"].endswith(".webp") and ".." not in good.json()["url"]
    assert c["seller"].post("/api/seller/media", files={"file": ("bad.jpg", b"<script>alert(1)</script>", "image/jpeg")}).status_code == 422
    assert c["seller"].post("/api/seller/media", files={"file": ("big.png", b"x" * (5 * 1024 * 1024 + 1), "image/png")}).status_code == 413
    assert c["customer"].post("/api/seller/media", files={"file": ("x.png", image_bytes, "image/png")}).status_code == 403


def test_server_price_stock_and_idempotency(setup, checkout_data):
    factory, c = setup
    checkout_data["total"] = 1
    r = c["customer"].post("/api/orders", json=checkout_data)
    assert r.status_code == 201
    order = r.json()
    assert order["total"] == 17150
    again = c["customer"].post("/api/orders", json=checkout_data)
    assert again.json()["id"] == order["id"]
    with factory() as db:
        assert db.get(Product, "product0").stock == 3
        assert len(list(db.scalars(select(Order)))) == 1
    checkout_data["items"][0]["quantity"] = 1
    assert c["customer"].post("/api/orders", json=checkout_data).status_code == 409


def test_mixed_seller_and_excess_stock_rejected(setup, checkout_data):
    _, c = setup
    checkout_data["items"].append({"product_id": "product1", "quantity": 1})
    assert c["customer"].post("/api/orders", json=checkout_data).status_code == 409
    checkout_data["items"] = [{"product_id": "product0", "quantity": 6}]
    assert c["customer"].post("/api/orders", json=checkout_data).status_code == 409


def test_stock_reservation_rolls_back_all_items(setup, checkout_data):
    factory, c = setup
    checkout_data["items"].append({"product_id": "missing", "quantity": 1})
    assert c["customer"].post("/api/orders", json=checkout_data).status_code == 409
    with factory() as db:
        assert db.get(Product, "product0").stock == 5
        assert not db.scalar(select(Order))


def test_schedule_and_address_validation(setup, checkout_data):
    _, c = setup
    checkout_data["scheduled_at"] = (now() - timedelta(days=1)).isoformat() + "Z"
    assert c["customer"].post("/api/orders", json=checkout_data).status_code == 422
    checkout_data["scheduled_at"] = (now() + timedelta(days=2)).replace(hour=12).isoformat() + "Z"
    checkout_data["delivery_method"] = "paid"
    assert c["customer"].post("/api/orders", json=checkout_data).status_code == 422


def paid_order(c, data):
    order = c["customer"].post("/api/orders", json=data).json()
    assert c["seller"].post("/api/orders/" + order["id"] + "/transition?state=pending_payment").status_code == 200
    assert c["customer"].post("/api/payments/test/" + order["id"]).status_code == 200
    return order["id"]


def test_payment_duplicate_and_order_isolation(setup, checkout_data):
    factory, c = setup
    oid = paid_order(c, checkout_data)
    assert c["customer"].post("/api/payments/test/" + oid).json()["duplicate"] is True
    assert c["seller2"].get("/api/orders/" + oid).status_code == 404
    assert c["seller2"].post("/api/orders/" + oid + "/transition?state=confirmed").status_code == 404
    assert c["seller"].post("/api/orders/" + oid + "/transition?state=delivered").status_code == 409
    with factory() as db:
        assert len(list(db.scalars(select(PaymentEvent)))) == 1
        assert len(list(db.scalars(select(Ledger)))) == 3


def test_full_pickup_flow_and_review(setup, checkout_data):
    _, c = setup
    oid = paid_order(c, checkout_data)
    assert c["customer"].post("/api/orders/" + oid + "/review", json={"rating": 5, "comment": "جميل"}).status_code == 409
    for state in ["confirmed", "preparing", "ready", "completed"]:
        assert c["seller"].post("/api/orders/" + oid + "/transition?state=" + state).status_code == 200
    assert c["customer"].post("/api/orders/" + oid + "/review", json={"rating": 5, "comment": "جميل جدًا"}).status_code == 201
    assert c["customer"].post("/api/orders/" + oid + "/review", json={"rating": 5, "comment": "جميل جدًا"}).status_code == 409


def test_failed_payment_restores_stock_once(setup, checkout_data):
    factory, c = setup
    oid = c["customer"].post("/api/orders", json=checkout_data).json()["id"]
    assert c["seller"].post("/api/orders/" + oid + "/transition?state=pending_payment").status_code == 200
    assert c["customer"].post("/api/payments/test/" + oid + "?outcome=failed").status_code == 200
    assert c["customer"].post("/api/payments/test/" + oid + "?outcome=failed").json()["duplicate"] is True
    assert c["customer"].post("/api/payments/test/" + oid).status_code == 409
    with factory() as db:
        assert db.get(Product, "product0").stock == 5


def test_cancellation_refund_cap_and_replay(setup, checkout_data):
    factory, c = setup
    oid = paid_order(c, checkout_data)
    assert c["customer"].post("/api/orders/" + oid + "/transition?state=cancelled").status_code == 200
    assert c["customer"].post("/api/orders/" + oid + "/transition?state=cancelled").status_code == 409
    assert c["admin"].post("/api/payments/refund/" + oid + "?amount=10000&event_id=refund-event-1").status_code == 200
    assert c["admin"].post("/api/payments/refund/" + oid + "?amount=10000&event_id=refund-event-1").json()["duplicate"] is True
    assert c["admin"].post("/api/payments/refund/" + oid + "?amount=8000&event_id=refund-event-2").status_code == 422
    assert c["admin"].post("/api/payments/refund/" + oid + "?amount=7150&event_id=refund-event-3").status_code == 200
    with factory() as db:
        assert db.get(Order, oid).payment_status == "refunded"
        assert db.get(Product, "product0").stock == 5


def test_webhook_signature_and_amount(setup, checkout_data):
    _, c = setup
    order = c["customer"].post("/api/orders", json=checkout_data).json()
    assert c["seller"].post("/api/orders/" + order["id"] + "/transition?state=pending_payment").status_code == 200
    data = {"event_id": "external-event-1", "order_id": order["id"], "amount": 1, "outcome": "paid", "currency": "SAR"}
    body = json.dumps(data).encode()
    assert c["customer"].post("/api/payments/webhook/test", content=body, headers={"x-signature": "wrong"}).status_code == 401
    signature = hmac.new(settings.payment_webhook_secret.encode(), body, hashlib.sha256).hexdigest()
    assert c["customer"].post("/api/payments/webhook/test", content=body, headers={"x-signature": signature}).status_code == 422
    data["amount"] = order["total"]
    body = json.dumps(data).encode()
    signature = hmac.new(settings.payment_webhook_secret.encode(), body, hashlib.sha256).hexdigest()
    assert c["customer"].post("/api/payments/webhook/test", content=body, headers={"x-signature": signature}).status_code == 200


def test_driver_claim_and_delivery_proof(setup, checkout_data):
    factory, c = setup
    checkout_data.update(delivery_method="paid", address="عنوان توصيل تجريبي بالرياض")
    oid = paid_order(c, checkout_data)
    for state in ["confirmed", "preparing", "ready"]:
        assert c["seller"].post("/api/orders/" + oid + "/transition?state=" + state).status_code == 200
    offer = c["driver"].get("/api/driver/offers").json()[0]
    assert "address" not in offer
    assert c["driver"].get("/api/driver/trips/" + oid).status_code == 404
    assert c["driver"].post("/api/driver/offers/" + oid + "/accept").status_code == 200
    assert c["driver2"].post("/api/driver/offers/" + oid + "/accept").status_code == 409
    assert c["driver2"].get("/api/driver/trips/" + oid).status_code == 404
    assert c["driver"].post("/api/driver/trips/" + oid + "/transition?state=picked_up").status_code == 422
    with factory() as db:
        pickup_message = db.scalar(
            select(Notification).where(Notification.user_id == "seller", Notification.message.like("%رمز إثبات الاستلام%"))
        ).message
        pickup_code = pickup_message.rsplit(": ", 1)[1]
    assert c["driver"].post("/api/driver/trips/" + oid + "/transition?state=picked_up&code=" + pickup_code).status_code == 200
    assert c["driver"].post("/api/driver/trips/" + oid + "/transition?state=in_transit").status_code == 200
    assert c["driver"].post("/api/driver/trips/" + oid + "/transition?state=delivered&code=000000").status_code == 422
    with factory() as db:
        message = db.scalar(
            select(Notification).where(Notification.user_id == "customer", Notification.message.like("%رمز إثبات%"))
        ).message
        code = message.rsplit(": ", 1)[1]
    assert c["driver"].post("/api/driver/trips/" + oid + "/transition?state=delivered&code=" + code).status_code == 200


def test_csrf_and_expired_session(setup):
    factory, c = setup
    assert c["customer"].post("/api/auth/logout", headers={"Origin": "https://attacker.test"}).status_code == 403
    with factory() as db:
        db.get(Session, digest("customer-token")).expires_at = now() - timedelta(seconds=1)
        db.commit()
    assert c["customer"].get("/api/auth/me").status_code == 401


def test_login_rate_limit(setup):
    with TestClient(app) as client:
        codes = [client.post("/api/auth/login", json={"email": "wrong@example.test", "password": "wrong"}).status_code for _ in range(11)]
    assert codes[-1] == 429 and codes[0] == 401


def test_production_test_payment_disabled(setup, checkout_data, monkeypatch):
    _, c = setup
    monkeypatch.setattr(settings, "app_env", "production")
    assert c["customer"].post("/api/orders", json=checkout_data).status_code == 503


def test_favorites_and_support(setup, checkout_data):
    _, c = setup
    assert c["customer"].post("/api/favorites/product0").json()["saved"]
    assert len(c["customer"].get("/api/favorites").json()) == 1
    assert not c["customer"].post("/api/favorites/product0").json()["saved"]
    oid = paid_order(c, checkout_data)
    assert c["customer"].post("/api/support", json={"order_id": oid, "message": "أحتاج مساعدة بهذا الطلب التجريبي"}).status_code == 201
    assert c["seller2"].post("/api/support", json={"order_id": oid, "message": "أحتاج مساعدة بهذا الطلب التجريبي"}).status_code == 404


def test_telegram_unauthenticated_and_explicit_fields(setup):
    _, c = setup
    assert c["customer"].post("/api/telegram/link").status_code == 403
    assert c["seller"].post("/api/telegram/link").json()["expires_in"] == 1800
    assert c["seller"].post("/api/telegram/webhook", json={"update_id": 1}).status_code == 503
    from app.telegram import ExplicitTextProvider

    result = ExplicitTextProvider().suggest("كيكة، السعر ٨٥، الكمية ٥، التجهيز ٢٤ ساعة", "/media/sample.webp")
    assert result["price"] == 8500 and result["stock"] == 5
    assert "ingredients" not in result
