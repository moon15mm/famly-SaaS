"""Real-money Tap flows, stored fee split, pickup privacy, order chat and the schema migration."""

import os
import subprocess
import sys
from datetime import timedelta
from pathlib import Path

import pytest
from sqlalchemy import select

from app import jobs
from app.config import settings
from app.models import DeliveryRule, Household, Ledger, Notification, Order, Review, SupportTicket, now
from app.models_ext import Invoice, TapCharge
from app.providers import TapPaymentProvider

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture
def tap(setup, monkeypatch):
    """Tap mode with the gateway replaced: tests register the charges Tap would return."""
    monkeypatch.setattr(settings, "payment_provider", "tap")
    monkeypatch.setattr(settings, "tap_secret_key", "sk_test_placeholder")
    charges, refunds, opened = {}, [], []

    def get_charge(self, charge_id):
        if not TapPaymentProvider.CHARGE_ID.fullmatch(charge_id or ""):
            raise AssertionError("an invalid id must never reach Tap")
        return dict(charges[charge_id])

    def create_order_charge(self, order, customer_user=None):
        charge_id = f"chg_order{len(opened):04d}"
        opened.append(charge_id)
        charges[charge_id] = {
            "id": charge_id,
            "status": "INITIATED",
            "amount": order.total / 100,
            "currency": "SAR",
            "metadata": {"kind": "order", "order_id": order.id, "customer_id": order.customer_id},
            "reference": {"order": order.id},
        }
        return {"provider": "tap", "charge_id": charge_id, "checkout_url": "https://tap.test/pay/" + charge_id}

    def create_invoice_charge(self, invoice, household_user=None):
        charge_id = f"chg_invoice{len(opened):04d}"
        opened.append(charge_id)
        charges[charge_id] = invoice_charge(charge_id, invoice.id, invoice.amount, invoice.household_id)
        return {"provider": "tap", "charge_id": charge_id, "checkout_url": "https://tap.test/pay/" + charge_id}

    def create_refund(self, charge_id, amount, idempotent, reason="requested_by_customer"):
        refunds.append((charge_id, amount, idempotent))
        return {"id": f"re_test{len(refunds)}", "status": "REFUNDED"}

    monkeypatch.setattr(TapPaymentProvider, "get_charge", get_charge)
    monkeypatch.setattr(TapPaymentProvider, "create_order_charge", create_order_charge)
    monkeypatch.setattr(TapPaymentProvider, "create_invoice_charge", create_invoice_charge)
    monkeypatch.setattr(TapPaymentProvider, "create_refund", create_refund)
    return setup, charges, refunds


def invoice_charge(charge_id, invoice_id, amount, household_id, status="CAPTURED"):
    # Same shape create_invoice_charge sends; Tap echoes metadata and reference (reference.order = invoice id).
    return {
        "id": charge_id,
        "status": status,
        "amount": amount / 100,
        "currency": "SAR",
        "metadata": {"invoice_id": invoice_id, "household_id": household_id},
        "reference": {"transaction": invoice_id, "order": invoice_id},
    }


def capture(charges, charge_id):
    charges[charge_id]["status"] = "CAPTURED"


def redirect(client, charge_id):
    response = client.get("/api/payments/tap/redirect?tap_id=" + charge_id, follow_redirects=False)
    assert response.status_code == 307
    return response.headers["location"]


def new_invoice(c, key):
    plan = c["admin"].post("/api/admin/plans", json={"name": "باقة " + key, "monthly_price": 4900, "product_limit": 30}).json()
    return c["seller"].post("/api/seller/subscription/invoices", json={"plan_id": plan["id"], "idempotency_key": key * 4}).json()


def accepted_order(c, data, key="tap-flow-key-0001"):
    order = c["customer"].post("/api/orders", json={**data, "idempotency_key": key}).json()
    assert c["seller"].post("/api/orders/" + order["id"] + "/transition?state=pending_payment").status_code == 200
    return order


def test_tap_subscription_payment_activates_invoice(tap):
    (factory, c), charges, _ = tap
    invoice = new_invoice(c, "sub1")
    opened = c["seller"].post("/api/payments/tap/subscription/" + invoice["id"]).json()
    location = redirect(c["seller"], opened["charge_id"])
    assert location.endswith("/seller?tab=reports&payment=paid")
    with factory() as db:
        stored = db.get(Invoice, invoice["id"])
        assert (stored.status, stored.provider) == ("paid", "tap")
        assert db.get(Household, "seller").subscription_status == "active"
        assert db.get(TapCharge, opened["charge_id"]).status == "applied"
    # The webhook for the same charge is a no-op, not a second activation.
    assert c["customer"].post("/api/payments/webhook/tap", json={"id": opened["charge_id"]}).json() == {"status": "paid"}
    with factory() as db:
        assert db.get(Invoice, invoice["id"]).period_end == stored.period_end


def test_legacy_invoice_charge_ignores_forged_parameters(tap):
    (factory, c), charges, _ = tap
    paid_for, other = new_invoice(c, "leg1"), new_invoice(c, "leg2")
    # A charge opened before this fix: no local record, invoice identified by metadata only.
    charges["chg_legacy0001"] = invoice_charge("chg_legacy0001", paid_for["id"], paid_for["amount"], "seller")
    response = c["seller"].get(
        "/api/payments/tap/redirect?tap_id=chg_legacy0001&invoice_id=" + other["id"] + "&order_id=x", follow_redirects=False
    )
    assert response.headers["location"].endswith("payment=paid")
    with factory() as db:
        assert db.get(Invoice, paid_for["id"]).status == "paid"
        assert db.get(Invoice, other["id"]).status == "unpaid"
    # Reusing the same captured charge for another invoice is impossible: it is bound by metadata.
    result = c["admin"].post("/api/payments/admin/tap-charges/check", json={"charge_id": "chg_legacy0001"}).json()
    assert result["outcome"] == "paid" and result["target_id"] == paid_for["id"]


def test_duplicate_invoice_payment_is_flagged_for_refund(tap):
    (factory, c), charges, refunds = tap
    invoice = new_invoice(c, "dup1")
    first = c["seller"].post("/api/payments/tap/subscription/" + invoice["id"]).json()
    redirect(c["seller"], first["charge_id"])
    charges["chg_second0001"] = invoice_charge("chg_second0001", invoice["id"], invoice["amount"], "seller")
    assert redirect(c["seller"], "chg_second0001").endswith("payment=review")
    with factory() as db:
        assert db.get(TapCharge, "chg_second0001").status == "needs_refund"
        assert db.scalar(select(Notification).where(Notification.user_id == "admin", Notification.message.contains("لم تُطبّق")))
    refunded = c["admin"].post("/api/payments/admin/tap-charges/chg_second0001/refund").json()
    assert refunded["status"] == "refunded" and refunds == [("chg_second0001", invoice["amount"], "unapplied-chg_second0001")]
    assert c["admin"].post("/api/payments/admin/tap-charges/chg_second0001/refund").status_code == 409


def test_capture_after_cancellation_is_kept_for_refund_not_hidden(tap, checkout_data):
    (factory, c), charges, refunds = tap
    order = accepted_order(c, checkout_data)
    opened = c["customer"].post("/api/payments/tap/create/" + order["id"]).json()
    assert c["customer"].post("/api/orders/" + order["id"] + "/transition?state=cancelled").status_code == 200
    capture(charges, opened["charge_id"])
    assert redirect(c["customer"], opened["charge_id"]).endswith(f"/orders/{order['id']}?payment=review")
    with factory() as db:
        row = db.get(TapCharge, opened["charge_id"])
        assert row.status == "needs_refund" and row.amount == order["total"]
        assert db.get(Order, order["id"]).payment_status == "unpaid"
        assert db.scalar(select(Notification).where(Notification.user_id == "customer", Notification.message.contains("تعذر ربطها")))
    listed = c["admin"].get("/api/payments/admin/tap-charges?status=needs_refund").json()
    assert [r["id"] for r in listed] == [opened["charge_id"]]
    assert c["customer"].get("/api/payments/admin/tap-charges").status_code == 403
    resolved = c["admin"].post("/api/payments/admin/tap-charges/" + opened["charge_id"] + "/resolve", json={"note": "استُرد من لوحة Tap"})
    assert resolved.json()["status"] == "resolved" and refunds == []


def test_late_capture_on_open_order_is_applied_with_real_ledger(tap, checkout_data):
    (factory, c), charges, _ = tap
    order = accepted_order(c, checkout_data)
    opened = c["customer"].post("/api/payments/tap/create/" + order["id"]).json()
    with factory() as db:
        stored = db.get(Order, order["id"])
        assert stored.payment_expires_at > now() + timedelta(minutes=19)
        stored.payment_expires_at = now() - timedelta(minutes=3)
        db.commit()
    capture(charges, opened["charge_id"])
    assert redirect(c["customer"], opened["charge_id"]).endswith("payment=paid")
    with factory() as db:
        stored = db.get(Order, order["id"])
        assert (stored.status, stored.payment_status) == ("confirmed", "paid")
        entries = {e.kind: (e.amount, e.note) for e in db.scalars(select(Ledger).where(Ledger.order_id == order["id"]))}
    assert entries["product_sales"] == (17000, "دفع Tap " + opened["charge_id"])
    assert entries["merchant_commission"][0] == -340 and entries["service_fee"][0] == 150
    assert "delivery_charge" not in entries


def test_tap_refund_of_paid_order_goes_through_tap(tap, checkout_data):
    (factory, c), charges, refunds = tap
    order = accepted_order(c, checkout_data)
    opened = c["customer"].post("/api/payments/tap/create/" + order["id"]).json()
    capture(charges, opened["charge_id"])
    assert c["customer"].post("/api/payments/webhook/tap", json={"id": opened["charge_id"]}).json() == {"status": "paid"}
    response = c["admin"].post("/api/payments/refund/" + order["id"] + "?amount=5000&event_id=refund-tap-0001")
    assert response.json() == {"ok": True, "refunded": 5000}
    assert refunds == [(opened["charge_id"], 5000, "refund-tap-0001")]
    with factory() as db:
        assert db.get(Order, order["id"]).payment_status == "partial_refund"
        note = db.scalar(select(Ledger.note).where(Ledger.order_id == order["id"], Ledger.kind == "refund"))
    assert note.startswith("استرداد Tap re_test1")


def test_racing_redirect_and_webhook_never_flag_an_applied_payment(tap, checkout_data):
    from app.payments import flag_charge

    (factory, c), charges, _ = tap
    order = accepted_order(c, checkout_data)
    opened = c["customer"].post("/api/payments/tap/create/" + order["id"]).json()
    capture(charges, opened["charge_id"])
    assert redirect(c["customer"], opened["charge_id"]).endswith("payment=paid")
    # The slower of two simultaneous callbacks sees the order already paid and would flag it.
    with factory() as db:
        result = flag_charge(db, opened["charge_id"], "order", order["id"], order["total"], "تمت معالجة الطلب بالفعل")
        assert result[2] == "paid"
        assert db.get(TapCharge, opened["charge_id"]).status == "applied"
        assert not db.scalar(select(Notification).where(Notification.user_id == "admin", Notification.message.contains("لم تُطبّق")))


def test_invalid_charge_ids_never_reach_tap(tap):
    (_, c), _, _ = tap
    assert redirect(c["customer"], "../customers").endswith("/account?payment=error")
    assert c["customer"].post("/api/payments/webhook/tap", json={"id": "chg_../x"}).json() == {"status": "ignored"}
    assert c["admin"].post("/api/payments/admin/tap-charges/check", json={"charge_id": "re_1234567890"}).status_code == 422


def test_sweep_applies_charges_whose_redirect_never_came(tap, checkout_data):
    (factory, c), charges, _ = tap
    order = accepted_order(c, checkout_data)
    opened = c["customer"].post("/api/payments/tap/create/" + order["id"]).json()
    capture(charges, opened["charge_id"])
    with factory() as db:
        db.get(TapCharge, opened["charge_id"]).created_at = now() - timedelta(minutes=15)
        db.commit()
        jobs.tap_sweep(db)
    with factory() as db:
        assert db.get(Order, order["id"]).status == "confirmed"
        assert db.get(TapCharge, opened["charge_id"]).status == "applied"


def test_family_cannot_confirm_without_payment(setup, checkout_data):
    _, c = setup
    oid = c["customer"].post("/api/orders", json=checkout_data).json()["id"]
    assert c["seller"].post("/api/orders/" + oid + "/transition?state=confirmed").status_code == 409
    assert c["customer"].post("/api/payments/test/" + oid).status_code == 409
    assert c["seller"].post("/api/orders/" + oid + "/transition?state=pending_payment").status_code == 200
    assert c["seller"].post("/api/orders/" + oid + "/transition?state=confirmed").status_code == 409
    assert c["customer"].post("/api/payments/test/" + oid).status_code == 200


def test_pickup_location_only_after_payment(setup, checkout_data):
    factory, c = setup
    oid = c["customer"].post("/api/orders", json=checkout_data).json()["id"]
    assert "pickup_address" not in c["customer"].get("/api/orders/" + oid).json()
    assert c["seller"].get("/api/orders/" + oid).json()["pickup_address"] == "عنوان استلام تجريبي"
    c["seller"].post("/api/orders/" + oid + "/transition?state=pending_payment")
    assert "pickup_address" not in c["customer"].get("/api/orders/" + oid).json()
    c["customer"].post("/api/payments/test/" + oid)
    seen = c["customer"].get("/api/orders/" + oid).json()
    # No invented coordinates when the family never set a location.
    assert seen["pickup_address"] == "عنوان استلام تجريبي" and seen["pickup_latitude"] is None


def test_fee_split_is_stored_and_shown_to_the_right_people(setup, checkout_data):
    factory, c = setup
    with factory() as db:
        db.add(DeliveryRule(id=1, base_fee=1500, per_km=200, max_km=30))
        db.commit()
    data = {**checkout_data, "delivery_method": "paid", "address": "حي الاختبار، شارع التجربة 12"}
    quote = c["customer"].post("/api/checkout/quote", json=data).json()
    assert (quote["delivery_fee"], quote["service_fee"], quote["total"]) == (2750, 150, 19900)
    assert "merchant_fee" not in quote
    order = c["customer"].post("/api/orders", json={**data, "quoted_total": quote["total"]}).json()
    assert order["total"] == 19900 and "merchant_fee" not in order and "driver_fee" not in order
    seller_view = c["seller"].get("/api/orders/" + order["id"]).json()
    assert (seller_view["merchant_fee"], seller_view["merchant_payout"]) == (340, 16660)
    assert c["admin"].get("/api/orders/" + order["id"]).json()["driver_fee"] == 2500
    c["seller"].post("/api/orders/" + order["id"] + "/transition?state=pending_payment")
    c["customer"].post("/api/payments/test/" + order["id"])
    for state in ["preparing", "ready"]:
        assert c["seller"].post("/api/orders/" + order["id"] + "/transition?state=" + state).status_code == 200
    offer = next(o for o in c["driver"].get("/api/driver/offers").json() if o["id"] == order["id"])
    assert offer["fee"] == 2500
    kinds = {row["kind"] for row in c["seller"].get("/api/seller/ledger").json()}
    assert kinds == {"product_sales", "merchant_commission"}
    report = c["admin"].get("/api/admin/reports").json()
    assert (report["service_fees"], report["delivery_margins"], report["merchant_commissions"]) == (150, 250, 340)
    # The admin dashboard shows the platform's real income, not an assumed percentage.
    assert c["admin"].get("/api/admin/overview").json()["net_commission"] == 150 + 250 + 340


def completed_pickup(c, data, key):
    order = c["customer"].post("/api/orders", json={**data, "idempotency_key": key}).json()
    c["seller"].post("/api/orders/" + order["id"] + "/transition?state=pending_payment")
    c["customer"].post("/api/payments/test/" + order["id"])
    for state in ["preparing", "ready", "completed"]:
        assert c["seller"].post("/api/orders/" + order["id"] + "/transition?state=" + state).status_code == 200
    return order["id"]


def upload(client, oid, image_bytes):
    response = client.post("/api/orders/" + oid + "/chat/upload", files={"file": ("photo.png", image_bytes, "image/png")})
    assert response.status_code == 200
    return response.json()["url"]


def test_chat_photos_are_private_to_the_order(setup, checkout_data, image_bytes):
    _, c = setup
    oid = completed_pickup(c, checkout_data, "chat-photo-key-0001")
    url = upload(c["seller"], oid, image_bytes)
    assert c["seller"].post("/api/orders/" + oid + "/chat/messages", json={"image_url": url}).status_code == 200
    shown = [m["image_url"] for m in c["customer"].get("/api/orders/" + oid + "/chat").json()["messages"] if m["image_url"]]
    assert shown == ["/api/orders/" + oid + "/chat/media/" + url.removeprefix("/media/")]
    assert c["customer"].get(shown[0]).status_code == 200
    assert c["seller2"].get(shown[0]).status_code == 403
    assert c["customer"].get(url).status_code == 404
    # Someone else's file or public product media cannot be attached.
    assert c["customer"].post("/api/orders/" + oid + "/chat/messages", json={"image_url": url}).status_code == 422
    assert c["customer"].post("/api/orders/" + oid + "/chat/messages", json={"image_url": "/media/sample.webp"}).status_code == 422


def test_chat_review_saves_driver_rating_and_own_photo(setup, checkout_data, image_bytes):
    factory, c = setup
    oid = completed_pickup(c, checkout_data, "chat-review-key-0001")
    with factory() as db:
        db.get(Order, oid).driver_id = "driver"
        db.commit()
    seller_photo = upload(c["seller"], oid, image_bytes)
    body = {"rating": 5, "comment": "ممتاز", "driver_rating": 4, "driver_comment": "سريع"}
    assert c["customer"].post("/api/orders/" + oid + "/chat/review", json={**body, "photo_url": seller_photo}).status_code == 422
    photo = upload(c["customer"], oid, image_bytes)
    assert c["customer"].post("/api/orders/" + oid + "/chat/review", json={**body, "photo_url": photo}).status_code == 201
    assert c["customer"].post("/api/orders/" + oid + "/chat/review", json=body).status_code == 409
    with factory() as db:
        review = db.scalar(select(Review).where(Review.order_id == oid))
        assert (review.driver_id, review.driver_rating, review.photo_url) == ("driver", 4, photo)
    chat = c["seller"].get("/api/orders/" + oid + "/chat").json()
    assert chat["review"]["photo_url"].startswith("/api/orders/" + oid + "/chat/media/")
    assert c["seller"].get(chat["review"]["photo_url"]).status_code == 200


def test_chat_complaint_opens_a_real_ticket(setup, checkout_data):
    factory, c = setup
    oid = c["customer"].post("/api/orders", json=checkout_data).json()["id"]
    for _ in range(2):
        assert c["customer"].post("/api/orders/" + oid + "/chat/messages", json={"content": "عندي مشكلة في الطلب"}).status_code == 200
    messages = c["customer"].get("/api/orders/" + oid + "/chat").json()["messages"]
    assert any("بلاغ" in m["content"] for m in messages if m["sender_role"] == "ai")
    with factory() as db:
        assert len(db.scalars(select(SupportTicket).where(SupportTicket.order_id == oid, SupportTicket.status == "open")).all()) == 1
        assert db.scalar(select(Notification).where(Notification.user_id == "admin", Notification.message.contains(oid[:8])))
        # The family hears about the customer's message.
        assert db.scalar(select(Notification).where(Notification.user_id == "seller", Notification.message.contains("رسالة جديدة")))


def test_asking_for_the_administration_from_chat_reaches_it(setup, checkout_data):
    factory, c = setup
    oid = c["customer"].post("/api/orders", json=checkout_data).json()["id"]
    assert c["seller"].post("/api/orders/" + oid + "/chat/messages", json={"content": "أحتاج مساعدة الإدارة بخصوص الطلب"}).status_code == 200
    with factory() as db:
        ticket = db.scalar(select(SupportTicket).where(SupportTicket.order_id == oid, SupportTicket.user_id == "seller"))
        assert ticket and ticket.status == "open"


def test_chat_is_rate_limited_and_assistant_respects_switch(setup, checkout_data, monkeypatch):
    from app import order_chat

    _, c = setup
    oid = c["customer"].post("/api/orders", json=checkout_data).json()["id"]
    codes = [c["customer"].post("/api/orders/" + oid + "/chat/messages", json={"content": "سؤال"}).status_code for _ in range(31)]
    assert codes[:30] == [200] * 30 and codes[30] == 429
    called = []
    monkeypatch.setattr(order_chat.httpx, "Client", lambda *a, **k: called.append(1))
    monkeypatch.setattr(settings, "ai_provider", "disabled")
    monkeypatch.setattr(settings, "ai_api_key", "configured-but-disabled")
    monkeypatch.setattr(settings, "ai_model", "gemini-test")
    context = {"order_id": oid, "status_ar": "", "household_name": "", "driver_name": "", "scheduled": "", "items": ""}
    assert order_chat._call_gemini_chat("مرحبا", context) is None and called == []


def test_telegram_link_requires_bot_confirmation(setup):
    _, c = setup
    assert c["seller"].post("/api/telegram/manual-link", json={"telegram_id": "123456789"}).status_code == 404
    assert c["seller"].post("/api/telegram/link").json()["expires_in"] == 1800


def test_linked_family_gets_telegram_alerts_for_new_and_paid_orders(setup, checkout_data, monkeypatch):
    from app.models import Outbox

    factory, c = setup
    monkeypatch.setattr(settings, "telegram_bot_token", "bot-token-for-tests")
    with factory() as db:
        db.get(Household, "seller").telegram_user_id = "777000"
        db.commit()
    oid = c["customer"].post("/api/orders", json=checkout_data).json()["id"]
    c["seller"].post("/api/orders/" + oid + "/transition?state=pending_payment")
    c["customer"].post("/api/payments/test/" + oid)
    with factory() as db:
        texts = [job.payload["text"] for job in db.scalars(select(Outbox).where(Outbox.kind == "telegram"))]
    assert [t.split(" • ")[0] for t in texts] == ["🛎️ طلب جديد بانتظار موافقتك", "✅ دفع العميل قيمة الطلب؛ ابدأ التجهيز"]
    assert all(oid[:8] in t for t in texts)


def test_migrations_match_models(tmp_path):
    env = {**os.environ, "DATABASE_URL": "sqlite:///" + (tmp_path / "migrated.db").as_posix()}
    command = [sys.executable, "-m", "alembic", "-c", "backend/alembic.ini"]
    upgrade = subprocess.run(command + ["upgrade", "head"], cwd=ROOT, env=env, capture_output=True, text=True, timeout=300)
    assert upgrade.returncode == 0, upgrade.stderr[-2000:]
    check = subprocess.run(command + ["check"], cwd=ROOT, env=env, capture_output=True, text=True, timeout=300)
    assert check.returncode == 0, (check.stdout + check.stderr)[-2000:]
