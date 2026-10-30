import io
import os
import re
import shutil
from uuid import uuid4
from datetime import timedelta
import pytest
from PIL import Image
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker
from app.main import app
from app.db import Base, get_db
from app.config import settings
from app.models import User, Household, Product, Category, Session, Media, now
from app.security import hasher, digest, attempts


ROLES = ["customer", "seller", "seller2", "driver", "driver2", "admin"]


def seed_database(factory):
    password = "test-only-long-password"
    hash_value = hasher.hash(password)
    with factory() as db:
        db.add(Category(id="food", name="طعام"))
        db.add(Category(id="other", name="أخرى"))
        users = {}
        for role in ["customer", "seller", "seller2", "driver", "driver2", "admin"]:
            u = User(
                id=role,
                email=role + "@example.test",
                name=role,
                password_hash=hash_value,
                role="seller" if role.startswith("seller") else "driver" if role.startswith("driver") else role,
                driver_verified=role.startswith("driver"),
                available=True,
            )
            db.add(u)
            users[role] = u
        db.flush()
        for role in ["seller", "seller2"]:
            db.add(
                Household(
                    id=role,
                    owner_id=role,
                    name=role,
                    pickup_address="عنوان استلام تجريبي",
                    verified=True,
                    free_delivery=True,
                    opening_hour=0,
                    closing_hour=23,
                )
            )
        db.flush()
        db.add(Media(url="/media/sample.webp", owner_id="seller", public=True))
        for index, owner in enumerate(["seller", "seller2"]):
            db.add(
                Product(
                    id="product" + str(index),
                    household_id=owner,
                    category_id="food",
                    name="منتج اختبار",
                    description="وصف",
                    price=8500,
                    stock=5,
                    prep_hours=0,
                    images=["/media/sample.webp"],
                    status="published",
                )
            )
        for role in users:
            db.add(Session(token_hash=digest(role + "-token"), user_id=role, expires_at=now() + timedelta(days=1)))
        db.commit()


@pytest.fixture(scope="session")
def sqlite_template(tmp_path_factory):
    if os.environ.get("TEST_DATABASE_URL"):
        return None
    path = tmp_path_factory.mktemp("schema-template") / "base.db"
    template_engine = create_engine("sqlite:///" + str(path))
    Base.metadata.create_all(template_engine)
    seed_database(sessionmaker(bind=template_engine, expire_on_commit=False))
    with template_engine.connect() as connection:
        assert not connection.exec_driver_sql("PRAGMA foreign_key_check").fetchall()
    template_engine.dispose()
    return path


@pytest.fixture
def setup(tmp_path, monkeypatch, sqlite_template):
    monkeypatch.setattr(settings, "app_env", "test")
    monkeypatch.setattr(settings, "payment_provider", "test")
    monkeypatch.setattr(settings, "payment_webhook_secret", "test-signature-secret-with-at-least-32-characters")
    monkeypatch.setattr(settings, "media_dir", str(tmp_path / "media"))
    monkeypatch.setattr(settings, "private_dir", str(tmp_path / "private"))
    monkeypatch.setattr(settings, "mail_transport", "local")
    (tmp_path / "media").mkdir()
    image = Image.new("RGB", (30, 30), "white")
    image.save(tmp_path / "media" / "sample.webp", "WEBP")
    pg_url = os.environ.get("TEST_DATABASE_URL")
    admin_engine = None
    schema = None
    if pg_url:
        parsed = make_url(pg_url)
        if parsed.host not in {"127.0.0.1", "localhost", "::1"} or not parsed.database.startswith("min_buyutna_test_"):
            raise RuntimeError("Refusing to modify a database outside the isolated local test namespace")
        schema = "t_" + uuid4().hex
        admin_engine = create_engine(pg_url, isolation_level="AUTOCOMMIT")
        with admin_engine.connect() as connection:
            connection.exec_driver_sql('CREATE SCHEMA "' + schema + '"')
        engine = create_engine(pg_url, connect_args={"options": "-csearch_path=" + schema})
        Base.metadata.create_all(engine)
        seed_database(sessionmaker(bind=engine, expire_on_commit=False))
    else:
        shutil.copy2(sqlite_template, tmp_path / "test.db")
        engine = create_engine("sqlite:///" + str(tmp_path / "test.db"), connect_args={"check_same_thread": False, "timeout": 20})

        @event.listens_for(engine, "connect")
        def foreign_keys(connection, _):
            connection.execute("PRAGMA foreign_keys=ON")

    factory = sessionmaker(bind=engine, expire_on_commit=False)

    def override():
        with factory() as db:
            try:
                yield db
            except Exception:
                db.rollback()
                raise

    app.dependency_overrides[get_db] = override
    attempts.clear()
    clients = {}
    for role in ROLES:
        client = TestClient(app, headers={"Origin": settings.public_origin})
        client.cookies.set("session", role + "-token")
        clients[role] = client
    yield factory, clients
    for client in clients.values():
        client.close()
    app.dependency_overrides.clear()
    engine.dispose()
    if admin_engine and schema and re.fullmatch(r"t_[a-f0-9]{32}", schema):
        with admin_engine.connect() as connection:
            connection.exec_driver_sql('DROP SCHEMA "' + schema + '" CASCADE')
        admin_engine.dispose()


@pytest.fixture
def checkout_data():
    future = (now() + timedelta(days=2)).replace(hour=12, minute=0, second=0, microsecond=0).isoformat() + "Z"
    return {
        "items": [{"product_id": "product0", "quantity": 2}],
        "delivery_method": "pickup",
        "scheduled_at": future,
        "idempotency_key": "unique-checkout-key-123",
    }


@pytest.fixture
def image_bytes():
    stream = io.BytesIO()
    Image.new("RGB", (100, 80), "red").save(stream, "PNG")
    return stream.getvalue()
