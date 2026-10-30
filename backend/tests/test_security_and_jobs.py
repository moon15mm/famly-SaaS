import json
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from fastapi.testclient import TestClient
from sqlalchemy import select
from app.main import app
from app.config import settings
from app.models import Order, Product, Household, Notification, now
from app.mfa import totp


def test_private_draft_images_and_cross_tenant_reuse(setup, image_bytes):
    _, c = setup
    response = c["seller"].post("/api/seller/media", files={"file": ("image.png", image_bytes, "image/png")})
    url = response.json()["url"]
    assert c["seller"].get(url).status_code == 200
    assert c["seller2"].get(url).status_code == 404
    assert TestClient(app).get(url).status_code == 404
    data = {
        "name": "منتج خاص",
        "description": "وصف",
        "price": 1500,
        "stock": 4,
        "category_id": "food",
        "images": [url],
        "status": "published",
    }
    assert c["seller2"].post("/api/seller/products", json=data).status_code == 422
    created = c["seller"].post("/api/seller/products", json=data)
    assert created.status_code == 201
    assert TestClient(app).get(url).status_code == 200
    assert c["seller"].delete("/api/seller/products/" + created.json()["id"]).status_code == 200
    assert TestClient(app).get(url).status_code == 404


def test_admin_totp_and_replay(setup, monkeypatch):
    secret = "JBSWY3DPEHPK3PXP"
    monkeypatch.setattr(settings, "admin_totp_secrets", json.dumps({"admin@example.test": secret}))
    payload = {"email": "admin@example.test", "password": "test-only-long-password"}
    with TestClient(app, headers={"Origin": settings.public_origin}) as client:
        assert client.post("/api/auth/login", json=payload).status_code == 401
        payload["otp"] = totp(secret, int(time.time() // 30))
        assert client.post("/api/auth/login", json=payload).status_code == 200
        assert client.post("/api/auth/login", json=payload).status_code == 401


def test_expired_trial_rejects_publication(setup):
    factory, c = setup
    with factory() as db:
        db.get(Household, "seller").trial_ends_at = now() - timedelta(days=1)
        db.commit()
    data = {
        "name": "منتج جديد",
        "description": "وصف",
        "price": 1500,
        "stock": 4,
        "category_id": "food",
        "images": ["/media/sample.webp"],
        "status": "published",
    }
    assert c["seller"].post("/api/seller/products", json=data).status_code == 403
    data["status"] = "draft"
    assert c["seller"].post("/api/seller/products", json=data).status_code == 201


def test_worker_releases_expired_reservation_once(setup, checkout_data, monkeypatch):
    from app import worker

    factory, c = setup
    order = c["customer"].post("/api/orders", json=checkout_data).json()
    with factory() as db:
        db.get(Order, order["id"]).payment_expires_at = now() - timedelta(seconds=1)
        db.commit()
    monkeypatch.setattr(worker, "SessionLocal", factory)
    worker.tick()
    worker.tick()
    with factory() as db:
        assert db.get(Product, "product0").stock == 5
        assert db.get(Order, order["id"]).status == "cancelled"
        assert len(list(db.scalars(select(Notification).where(Notification.user_id == "customer")))) == 1


def test_concurrent_stock_reservation(setup, checkout_data):
    factory, c = setup
    checkout_data["items"][0]["quantity"] = 4

    def reserve(index):
        payload = {**checkout_data, "idempotency_key": "concurrent-checkout-key-" + str(index)}
        return c["customer"].post("/api/orders", json=payload).status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        codes = list(pool.map(reserve, [1, 2]))
    assert sorted(codes) == [201, 409]
    with factory() as db:
        assert db.get(Product, "product0").stock == 1


def test_plan_and_category_admin_permissions(setup):
    _, c = setup
    plan = {"name": "باقة اختبار", "monthly_price": 4900, "product_limit": 40}
    assert c["seller"].post("/api/admin/plans", json=plan).status_code == 403
    assert c["admin"].post("/api/admin/plans", json=plan).status_code == 201
    assert c["admin"].put("/api/admin/categories/custom", json={"name": "تصنيف جديد"}).status_code == 200
    assert any(x["id"] == "custom" for x in c["customer"].get("/api/categories").json())


def test_validation_does_not_echo_password(setup):
    secret = "short-sensitive-value"
    with TestClient(app) as client:
        response = client.post("/api/auth/register", json={"name": "A", "email": "invalid", "password": secret, "role": "admin"})
        assert response.status_code == 422
        assert secret not in response.text
        assert "input" not in response.json()
