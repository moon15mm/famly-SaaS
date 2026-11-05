from sqlalchemy import select, func
from app.models import Product, Order
from app.models_ext import ScheduleSlot


def test_checkout_requires_new_consent_when_price_changes(setup, checkout_data):
    factory, c = setup
    quote = c["customer"].post("/api/checkout/quote", json=checkout_data).json()
    with factory() as db:
        db.get(Product, "product0").price = 9000
        db.commit()
    data = {**checkout_data, "quoted_total": quote["total"]}
    assert c["customer"].post("/api/orders", json=data).status_code == 409
    with factory() as db:
        assert db.get(Product, "product0").stock == 5
        assert db.scalar(select(func.count()).select_from(Order)) == 0
        assert db.scalar(select(func.count()).select_from(ScheduleSlot)) == 0
    fresh = c["customer"].post("/api/checkout/quote", json=data).json()
    assert fresh["items"][0]["unit_price"] == 9000
    data["quoted_total"] = fresh["total"]
    created = c["customer"].post("/api/orders", json=data)
    assert created.status_code == 201 and created.json()["total"] == 18150
    assert c["customer"].post("/api/orders", json=data).json()["id"] == created.json()["id"]


def test_pickup_does_not_store_unneeded_customer_shipping_data(setup, checkout_data):
    _, c = setup
    data = {**checkout_data, "address": "عنوان عميل لا يلزم للاستلام الذاتي", "latitude": 24.7, "longitude": 46.6}
    response = c["customer"].post("/api/orders", json=data)
    assert response.status_code == 201
    order = response.json()
    assert order["address"] == "" and order["latitude"] is None and order["longitude"] is None


def test_quote_options_have_current_line_prices(setup, checkout_data):
    factory, c = setup
    with factory() as db:
        db.get(Product, "product0").options = [
            {"id": "small", "name": "صغير", "price_delta": 0},
            {"id": "large", "name": "كبير", "price_delta": 500},
        ]
        db.commit()
    data = {
        **checkout_data,
        "items": [
            {"product_id": "product0", "option_id": "small", "quantity": 1},
            {"product_id": "product0", "option_id": "large", "quantity": 1},
        ],
    }
    quote = c["customer"].post("/api/checkout/quote", json=data).json()
    assert [(i["option_id"], i["unit_price"]) for i in quote["items"]] == [("small", 8500), ("large", 9000)]
    assert quote["total"] == 17650


def test_extreme_cart_total_is_rejected_without_database_overflow(setup, checkout_data):
    factory, c = setup
    with factory() as db:
        first = db.get(Product, "product0")
        first.price, first.stock = 10000000, 500
        for key in ["expensive1", "expensive2"]:
            db.add(
                Product(
                    id=key,
                    household_id="seller",
                    category_id="food",
                    name="منتج حد أقصى",
                    price=10000000,
                    stock=500,
                    prep_hours=0,
                    images=["/media/sample.webp"],
                    status="published",
                )
            )
        db.commit()
    data = {**checkout_data, "items": [{"product_id": pid, "quantity": 100} for pid in ["product0", "expensive1", "expensive2"]]}
    assert c["customer"].post("/api/checkout/quote", json=data).status_code == 422
    assert c["customer"].post("/api/orders", json=data).status_code == 422
    with factory() as db:
        assert db.get(Product, "product0").stock == 500
        assert db.scalar(select(func.count()).select_from(Order)) == 0


def test_timezone_overflow_date_is_a_validation_error(setup, checkout_data):
    _, c = setup
    data = {**checkout_data, "scheduled_at": "9999-12-31T23:59:59-14:00"}
    assert c["customer"].post("/api/checkout/quote", json=data).status_code == 422
