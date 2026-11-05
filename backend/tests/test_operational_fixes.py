from datetime import timedelta
from sqlalchemy import select
from app.models import Audit, Household, Notification, Order, Plan, Product, now
from app.models_ext import ScheduleSlot

NOTE = {"note": "لم يتوفر سائق حتى موعد التسليم"}


def waiting_order(factory, key, scheduled_at):
    with factory() as db:
        order = Order(
            customer_id="customer",
            household_id="seller",
            status="ready",
            payment_status="paid",
            delivery_method="paid",
            address="عنوان اختبار فقط",
            scheduled_at=scheduled_at,
            subtotal=8500,
            delivery_fee=2000,
            total=10500,
            idempotency_key=key,
            request_hash="test",
            offer_expires_at=now() + timedelta(minutes=15),
            payment_expires_at=now() + timedelta(minutes=20),
        )
        db.add(order)
        db.commit()
        return order.id


def test_admin_cancels_paid_delivery_stuck_without_driver(setup, checkout_data):
    factory, c = setup
    paid = {
        **checkout_data,
        "delivery_method": "paid",
        "address": "حي الاختبار، شارع التجربة 12",
        "idempotency_key": "stuck-delivery-key-0001",
    }
    order = c["customer"].post("/api/orders", json=paid).json()
    oid = order["id"]
    assert c["seller"].post("/api/orders/" + oid + "/transition?state=pending_payment").status_code == 200
    assert c["customer"].post("/api/payments/test/" + oid).status_code == 200
    for state in ["confirmed", "preparing", "ready"]:
        assert c["seller"].post("/api/orders/" + oid + "/transition?state=" + state).status_code == 200
    assert any(o["id"] == oid for o in c["driver"].get("/api/driver/offers").json())
    # Customers and families cannot end a ready order; only the administration can.
    assert c["customer"].post("/api/orders/" + oid + "/transition?state=cancelled").status_code == 409
    assert c["seller"].post("/api/orders/" + oid + "/transition?state=cancelled").status_code == 409
    assert c["seller"].post("/api/admin/orders/" + oid + "/cancel", json=NOTE).status_code == 403
    assert c["admin"].post("/api/admin/orders/" + oid + "/cancel", json={"note": "قصير"}).status_code == 422
    cancelled = c["admin"].post("/api/admin/orders/" + oid + "/cancel", json=NOTE)
    assert cancelled.status_code == 200
    assert (cancelled.json()["status"], cancelled.json()["payment_status"]) == ("cancelled", "refund_pending")
    assert c["admin"].post("/api/admin/orders/" + oid + "/cancel", json=NOTE).status_code == 409
    assert not any(o["id"] == oid for o in c["driver"].get("/api/driver/offers").json())
    with factory() as db:
        assert db.get(Product, "product0").stock == 5
        assert db.scalar(select(ScheduleSlot.reserved).where(ScheduleSlot.household_id == "seller")) == 0
    refund = c["admin"].post("/api/payments/refund/" + oid + "?amount=" + str(order["total"]) + "&event_id=refund-after-admin-cancel")
    assert refund.status_code == 200
    assert c["customer"].get("/api/orders/" + oid).json()["payment_status"] == "refunded"
    picked = waiting_order(factory, "picked-delivery-key-01", now() + timedelta(days=1))
    with factory() as db:
        trip = db.get(Order, picked)
        trip.status, trip.driver_id = "picked_up", "driver2"
        db.commit()
    assert c["admin"].post("/api/admin/orders/" + picked + "/cancel", json=NOTE).status_code == 409


def test_worker_alerts_once_when_no_driver_by_requested_time(setup, monkeypatch):
    from app import worker

    factory, c = setup
    late = waiting_order(factory, "late-delivery-key-0001", now() - timedelta(minutes=5))
    early = waiting_order(factory, "early-delivery-key-001", now() + timedelta(days=1))
    monkeypatch.setattr(worker, "SessionLocal", factory)
    worker.tick()
    worker.tick()
    with factory() as db:
        alerts = list(db.scalars(select(Audit).where(Audit.action == "delivery.no_driver.alert")))
        assert [a.resource_id for a in alerts] == [late]
        messages = list(db.scalars(select(Notification)))
        for owner in ["customer", "seller"]:
            assert sum("لم يقبل أي سائق" in n.message for n in messages if n.user_id == owner) == 1
        assert sum(late[:8] in n.message for n in messages if n.user_id == "admin") == 1
        assert not any(early[:8] in n.message for n in messages)
        assert db.get(Order, late).status == "ready"
    waiting = c["admin"].get("/api/admin/delivery/waiting").json()
    assert {w["order_id"]: w["overdue"] for w in waiting} == {late: True, early: False}
    assert c["seller"].get("/api/admin/delivery/waiting").status_code == 403


def test_deleting_product_frees_plan_slot_but_keeps_order_history(setup, checkout_data):
    factory, c = setup
    with factory() as db:
        db.add(Plan(id="small", name="باقة صغيرة", monthly_price=4900, product_limit=2))
        db.get(Household, "seller").plan_id = "small"
        db.commit()
    order = c["customer"].post("/api/orders", json=checkout_data).json()
    draft = {"name": "مسودة اختبار", "description": "وصف", "price": 1500, "stock": 3, "category_id": "food", "status": "draft"}
    assert c["seller"].post("/api/seller/products", json=draft).status_code == 201
    assert c["seller"].post("/api/seller/products", json=draft).status_code == 409
    assert c["seller"].delete("/api/seller/products/product0").status_code == 200
    assert c["seller"].post("/api/seller/products", json=draft).status_code == 201
    assert "product0" not in {p["id"] for p in c["seller"].get("/api/seller/products").json()}
    assert c["customer"].get("/api/products/product0").status_code == 404
    assert c["seller"].put("/api/seller/products/product0", json={**draft, "status": "paused"}).status_code == 404
    assert c["seller"].delete("/api/seller/products/product0").status_code == 404
    assert c["admin"].post("/api/admin/products/product0/status", json={"status": "published"}).status_code == 409
    assert c["admin"].post("/api/admin/products/product0/pause").status_code == 409
    assert c["customer"].get("/api/orders/" + order["id"]).json()["items"][0]["name"] == "منتج اختبار"
    with factory() as db:
        assert db.get(Product, "product0").status == "archived"


def test_lapsed_subscription_hides_storefront_until_renewal(setup, checkout_data):
    factory, c = setup
    existing = c["customer"].post("/api/orders", json=checkout_data).json()
    assert c["customer"].post("/api/favorites/product0").json() == {"saved": True}
    with factory() as db:
        db.get(Household, "seller").trial_ends_at = now() - timedelta(minutes=1)
        db.commit()

    def assert_hidden():
        listed = {p["id"] for p in c["customer"].get("/api/products").json()["items"]}
        assert "product0" not in listed and "product1" in listed
        assert c["customer"].get("/api/products/product0").status_code == 404
        assert "seller" not in {h["id"] for h in c["customer"].get("/api/households").json()}
        assert c["customer"].get("/api/households/seller").status_code == 404
        assert c["customer"].get("/api/households/seller/slots").status_code == 404
        assert c["customer"].get("/api/favorites").json() == []
        fresh = {**checkout_data, "idempotency_key": "after-lapse-checkout-key"}
        assert c["customer"].post("/api/checkout/quote", json=fresh).status_code == 409
        assert c["customer"].post("/api/orders", json=fresh).status_code == 409
        assert c["seller"].get("/api/seller/household").json()["storefront_visible"] is False

    assert_hidden()
    with factory() as db:
        h = db.get(Household, "seller")
        h.subscription_status, h.trial_ends_at = "expired", None
        db.commit()
    assert_hidden()
    # Orders placed before the lapse stay serviceable.
    assert c["seller"].post("/api/orders/" + existing["id"] + "/transition?state=pending_payment").status_code == 200
    assert c["customer"].post("/api/payments/test/" + existing["id"]).status_code == 200
    assert c["seller"].post("/api/orders/" + existing["id"] + "/transition?state=confirmed").status_code == 200
    plan = c["admin"].post("/api/admin/plans", json={"name": "باقة التجديد", "monthly_price": 4900, "product_limit": 30}).json()
    body = {"plan_id": plan["id"], "idempotency_key": "renewal-after-lapse-key"}
    invoice = c["seller"].post("/api/seller/subscription/invoices", json=body).json()
    assert c["seller"].post("/api/seller/subscription/invoices/" + invoice["id"] + "/test-pay").json()["status"] == "paid"
    assert "product0" in {p["id"] for p in c["customer"].get("/api/products").json()["items"]}
    assert c["customer"].get("/api/products/product0").status_code == 200
    assert c["seller"].get("/api/seller/household").json()["storefront_visible"] is True
