from datetime import timedelta
from app.models import Household, Order, OrderItem, now
from app.models_ext import DriverPosition

SPOT = {"latitude": 24.7136, "longitude": 46.6753, "accuracy": 12}


def ready_order(factory, key, household="seller", **extra):
    with factory() as db:
        order = Order(
            customer_id="customer",
            household_id=household,
            status="ready",
            payment_status="paid",
            delivery_method="paid",
            address="حي الاختبار، شارع التجربة 12",
            scheduled_at=now() + timedelta(days=1),
            subtotal=8500,
            delivery_fee=2000,
            total=10500,
            idempotency_key=key,
            request_hash="test",
            offer_expires_at=now() + timedelta(minutes=15),
            payment_expires_at=now() + timedelta(minutes=20),
            **extra,
        )
        db.add(order)
        db.flush()
        product = "product0" if household == "seller" else "product1"
        db.add(OrderItem(order_id=order.id, product_id=product, name="منتج اختبار", unit_price=8500, quantity=1))
        db.commit()
        return order.id


def set_pickup(factory, household, latitude, longitude):
    with factory() as db:
        h = db.get(Household, household)
        h.pickup_latitude, h.pickup_longitude = latitude, longitude
        db.commit()


def test_location_needs_shift_or_trip_and_is_removed_after_shift(setup):
    factory, c = setup
    assert c["customer"].post("/api/driver/location", json=SPOT).status_code == 403
    assert c["driver"].post("/api/driver/location", json={**SPOT, "latitude": 91}).status_code == 422
    assert c["driver"].post("/api/driver/location", json=SPOT).status_code == 200
    with factory() as db:
        assert db.get(DriverPosition, "driver").latitude == SPOT["latitude"]
    assert c["driver"].post("/api/driver/availability?available=false").status_code == 200
    with factory() as db:
        assert db.get(DriverPosition, "driver") is None
    assert c["driver"].post("/api/driver/location", json=SPOT).status_code == 409


def test_offers_are_sorted_by_distance_to_pickup(setup):
    factory, c = setup
    set_pickup(factory, "seller", 21.5433, 39.1728)
    set_pickup(factory, "seller2", 24.72, 46.68)
    far = ready_order(factory, "far-offer-key-0000001", "seller")
    near = ready_order(factory, "near-offer-key-000001", "seller2")
    assert all(o["distance_km"] is None for o in c["driver"].get("/api/driver/offers").json())
    assert c["driver"].post("/api/driver/location", json=SPOT).status_code == 200
    offers = c["driver"].get("/api/driver/offers").json()
    assert [o["id"] for o in offers] == [near, far]
    assert offers[0]["distance_km"] < 2 < 800 < offers[1]["distance_km"]


def test_tracking_is_limited_to_order_parties_during_delivery(setup):
    factory, c = setup
    set_pickup(factory, "seller", 24.75, 46.70)
    oid = ready_order(factory, "tracked-order-key-0001", latitude=24.70, longitude=46.66)
    assert c["customer"].get(f"/api/orders/{oid}/driver-location").status_code == 404
    assert c["driver"].post(f"/api/driver/offers/{oid}/accept").status_code == 200
    assert c["driver"].post("/api/driver/location", json=SPOT).status_code == 200
    seen = c["customer"].get(f"/api/orders/{oid}/driver-location").json()
    assert (seen["driver"]["latitude"], seen["driver"]["stale"]) == (SPOT["latitude"], False)
    assert seen["dropoff"] == {"latitude": 24.70, "longitude": 46.66} and seen["pickup"] is None
    assert c["seller"].get(f"/api/orders/{oid}/driver-location").json()["pickup"] == {"latitude": 24.75, "longitude": 46.70}
    assert c["admin"].get(f"/api/orders/{oid}/driver-location").status_code == 200
    assert c["seller2"].get(f"/api/orders/{oid}/driver-location").status_code == 404
    active = c["admin"].get("/api/admin/deliveries/active").json()
    assert [(a["order_id"], a["stale"]) for a in active] == [(oid, False)]
    assert c["driver"].get("/api/admin/deliveries/active").status_code == 403
    trip = c["driver"].get(f"/api/driver/trips/{oid}").json()
    assert (trip["pickup_latitude"], trip["latitude"], trip["household_name"]) == (24.75, 24.70, "seller")
    assert trip["items"] == [{"name": "منتج اختبار", "quantity": 1, "option_label": ""}]
    with factory() as db:
        db.get(Order, oid).status = "delivered"
        db.commit()
    assert c["customer"].get(f"/api/orders/{oid}/driver-location").status_code == 404


def test_driver_summary_counts_delivered_trips(setup):
    factory, c = setup
    oid = ready_order(factory, "summary-order-key-0001")
    assert c["driver"].post(f"/api/driver/offers/{oid}/accept").status_code == 200
    summary = c["driver"].get("/api/driver/summary").json()
    assert summary["active_trip"] == {"id": oid, "status": "assigned"} and summary["delivered_trips"] == 0
    with factory() as db:
        db.get(Order, oid).status = "delivered"
        db.commit()
    summary = c["driver"].get("/api/driver/summary").json()
    assert (summary["active_trip"], summary["delivered_trips"], summary["declared_fees"]) == (None, 1, 2000)
    assert c["customer"].get("/api/driver/summary").status_code == 403


def test_household_pickup_point_is_paired_and_private(setup):
    _, c = setup
    store = {"name": "متجر الاختبار", "city": "الرياض", "pickup_address": "حي الاختبار، شارع التجربة 12", "pickup_latitude": 24.75}
    assert c["seller"].put("/api/seller/household", json=store).status_code == 422
    assert c["seller"].put("/api/seller/household", json={**store, "pickup_longitude": 46.70}).status_code == 200
    mine = c["seller"].get("/api/seller/household").json()
    assert (mine["pickup_latitude"], mine["pickup_longitude"]) == (24.75, 46.70)
    public = c["customer"].get("/api/households/seller").json()
    assert "pickup_latitude" not in public and "pickup_address" not in public


def test_worker_purges_stale_positions(setup, monkeypatch):
    from app import worker

    factory, c = setup
    assert c["driver"].post("/api/driver/location", json=SPOT).status_code == 200
    assert c["driver2"].post("/api/driver/location", json=SPOT).status_code == 200
    with factory() as db:
        db.get(DriverPosition, "driver").updated_at = now() - timedelta(hours=3)
        db.commit()
    monkeypatch.setattr(worker, "SessionLocal", factory)
    worker.tick()
    with factory() as db:
        assert db.get(DriverPosition, "driver") is None and db.get(DriverPosition, "driver2") is not None
