from datetime import datetime, timezone
from uuid import uuid4
from sqlalchemy import Column, String, Integer, Boolean, DateTime, ForeignKey, JSON, UniqueConstraint, CheckConstraint, Text, Float, false
from .db import Base


def uid():
    return uuid4().hex


def now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


class User(Base):
    __tablename__ = "users"
    id = Column(String(32), primary_key=True, default=uid)
    email = Column(String(254), unique=True, nullable=False)
    name = Column(String(100), nullable=False)
    password_hash = Column(String(255), nullable=False)
    role = Column(String(16), nullable=False, default="customer")
    active = Column(Boolean, nullable=False, default=True)
    driver_verified = Column(Boolean, nullable=False, default=False)
    available = Column(Boolean, nullable=False, default=False)
    mfa_last_counter = Column(Integer, nullable=False, default=-1)
    active_trip_id = Column(String(32))
    email_verified = Column(Boolean, nullable=False, default=False, server_default=false())
    address = Column(Text, default="")
    created_at = Column(DateTime, default=now, nullable=False)


class Session(Base):
    __tablename__ = "sessions"
    token_hash = Column(String(64), primary_key=True)
    user_id = Column(ForeignKey("users.id"), index=True, nullable=False)
    expires_at = Column(DateTime, nullable=False)


class Household(Base):
    __tablename__ = "households"
    id = Column(String(32), primary_key=True, default=uid)
    owner_id = Column(ForeignKey("users.id"), unique=True, nullable=False)
    name = Column(String(100), nullable=False)
    description = Column(Text, default="")
    city = Column(String(80), default="الرياض")
    pickup_address = Column(Text, default="")
    verified = Column(Boolean, nullable=False, default=False)
    free_delivery = Column(Boolean, nullable=False, default=False)
    delivery_enabled = Column(Boolean, nullable=False, default=True)
    opening_hour = Column(Integer, nullable=False, default=9)
    closing_hour = Column(Integer, nullable=False, default=21)
    on_vacation = Column(Boolean, nullable=False, default=False)
    telegram_user_id = Column(String(32), unique=True)
    plan_id = Column(ForeignKey("plans.id"), nullable=True)
    trial_ends_at = Column(DateTime)
    subscription_status = Column(String(24), default="trial")
    slot_capacity = Column(Integer, nullable=False, default=10, server_default="10")


class Category(Base):
    __tablename__ = "categories"
    id = Column(String(50), primary_key=True)
    name = Column(String(80), nullable=False)
    icon = Column(String(30), default="gift")


class Product(Base):
    __tablename__ = "products"
    __table_args__ = (CheckConstraint("price >= 100 AND stock >= 0 AND prep_hours >= 0"),)
    id = Column(String(32), primary_key=True, default=uid)
    household_id = Column(ForeignKey("households.id"), nullable=False, index=True)
    category_id = Column(ForeignKey("categories.id"), nullable=False, index=True)
    name = Column(String(150), nullable=False)
    description = Column(Text, default="")
    price = Column(Integer, nullable=False)
    stock = Column(Integer, nullable=False, default=0)
    prep_hours = Column(Integer, nullable=False, default=24)
    images = Column(JSON, nullable=False, default=list)
    status = Column(String(16), nullable=False, default="draft", index=True)
    featured = Column(Boolean, nullable=False, default=False)
    options = Column(JSON, nullable=False, default=list, server_default="[]")
    created_at = Column(DateTime, nullable=False, default=now)


class Order(Base):
    __tablename__ = "orders"
    __table_args__ = (UniqueConstraint("customer_id", "idempotency_key"),)
    id = Column(String(32), primary_key=True, default=uid)
    customer_id = Column(ForeignKey("users.id"), nullable=False, index=True)
    household_id = Column(ForeignKey("households.id"), nullable=False, index=True)
    idempotency_key = Column(String(80), nullable=False)
    request_hash = Column(String(64), nullable=False)
    status = Column(String(30), nullable=False, default="pending_payment", index=True)
    payment_status = Column(String(24), nullable=False, default="unpaid")
    delivery_method = Column(String(16), nullable=False)
    address = Column(Text, nullable=False, default="")
    scheduled_at = Column(DateTime, nullable=False)
    subtotal = Column(Integer, nullable=False)
    delivery_fee = Column(Integer, nullable=False, default=0)
    total = Column(Integer, nullable=False)
    refunded = Column(Integer, nullable=False, default=0)
    driver_id = Column(ForeignKey("users.id"), index=True)
    slot_id = Column(ForeignKey("schedule_slots.id", name="fk_orders_slot_id_schedule_slots"))
    latitude = Column(Float)
    longitude = Column(Float)
    delivery_code_hash = Column(String(64))
    pickup_code_hash = Column(String(64))
    offer_expires_at = Column(DateTime)
    payment_expires_at = Column(DateTime, nullable=False)
    created_at = Column(DateTime, nullable=False, default=now)


class OrderItem(Base):
    __tablename__ = "order_items"
    id = Column(String(32), primary_key=True, default=uid)
    order_id = Column(ForeignKey("orders.id"), nullable=False, index=True)
    product_id = Column(ForeignKey("products.id"), nullable=False)
    name = Column(String(150), nullable=False)
    unit_price = Column(Integer, nullable=False)
    quantity = Column(Integer, nullable=False)
    option_id = Column(String(40), nullable=False, default="", server_default="")
    option_label = Column(String(100), nullable=False, default="", server_default="")


class PaymentEvent(Base):
    __tablename__ = "payment_events"
    id = Column(String(100), primary_key=True)
    order_id = Column(ForeignKey("orders.id"), nullable=False)
    kind = Column(String(24), nullable=False)
    amount = Column(Integer, nullable=False)
    created_at = Column(DateTime, default=now)


class Ledger(Base):
    __tablename__ = "ledger"
    id = Column(String(32), primary_key=True, default=uid)
    order_id = Column(ForeignKey("orders.id"), nullable=False, index=True)
    kind = Column(String(32), nullable=False)
    amount = Column(Integer, nullable=False)
    note = Column(Text, default="")
    created_at = Column(DateTime, default=now)


class Plan(Base):
    __tablename__ = "plans"
    id = Column(String(32), primary_key=True, default=uid)
    name = Column(String(100), nullable=False)
    monthly_price = Column(Integer, nullable=False)
    annual_price = Column(Integer)
    trial_days = Column(Integer, nullable=False, default=14, server_default="14")
    product_limit = Column(Integer, nullable=False, default=50)
    active = Column(Boolean, nullable=False, default=True)


class Audit(Base):
    __tablename__ = "audit"
    id = Column(String(32), primary_key=True, default=uid)
    actor_id = Column(ForeignKey("users.id"))
    action = Column(String(100), nullable=False)
    resource_id = Column(String(100), nullable=False)
    created_at = Column(DateTime, default=now, nullable=False)


class Notification(Base):
    __tablename__ = "notifications"
    id = Column(String(32), primary_key=True, default=uid)
    user_id = Column(ForeignKey("users.id"), nullable=False, index=True)
    message = Column(Text, nullable=False)
    read = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, default=now)


class Favorite(Base):
    __tablename__ = "favorites"
    user_id = Column(ForeignKey("users.id"), primary_key=True)
    product_id = Column(ForeignKey("products.id"), primary_key=True)


class Review(Base):
    __tablename__ = "reviews"
    id = Column(String(32), primary_key=True, default=uid)
    order_id = Column(ForeignKey("orders.id"), nullable=False, unique=True)
    customer_id = Column(ForeignKey("users.id"), nullable=False)
    household_id = Column(ForeignKey("households.id"), nullable=False, index=True)
    rating = Column(Integer, nullable=False)
    comment = Column(String(1000), nullable=False)


class SupportTicket(Base):
    __tablename__ = "support_tickets"
    id = Column(String(32), primary_key=True, default=uid)
    user_id = Column(ForeignKey("users.id"), nullable=False)
    order_id = Column(ForeignKey("orders.id"), nullable=False)
    message = Column(Text, nullable=False)
    status = Column(String(20), default="open")


class TelegramLink(Base):
    __tablename__ = "telegram_links"
    token_hash = Column(String(64), primary_key=True)
    household_id = Column(ForeignKey("households.id"), nullable=False)
    expires_at = Column(DateTime, nullable=False)


class TelegramUpdate(Base):
    __tablename__ = "telegram_updates"
    id = Column(String(50), primary_key=True)
    created_at = Column(DateTime, default=now)


class Outbox(Base):
    __tablename__ = "outbox"
    id = Column(String(32), primary_key=True, default=uid)
    kind = Column(String(30), nullable=False)
    payload = Column(JSON, nullable=False)
    attempts = Column(Integer, default=0, nullable=False)
    sent_at = Column(DateTime)
    next_attempt_at = Column(DateTime, default=now, nullable=False)
    claimed_until = Column(DateTime)
    lease_token = Column(String(32))
    dead_letter = Column(Boolean, nullable=False, default=False, server_default=false())
    last_error = Column(String(100), nullable=False, default="", server_default="")


class DeliveryRule(Base):
    __tablename__ = "delivery_rules"
    id = Column(Integer, primary_key=True, default=1)
    base_fee = Column(Integer, nullable=False, default=1500)
    per_km = Column(Integer, nullable=False, default=200)
    max_km = Column(Integer, nullable=False, default=30)


class Media(Base):
    __tablename__ = "media"
    url = Column(String(128), primary_key=True)
    owner_id = Column(ForeignKey("users.id"), nullable=False, index=True)
    public = Column(Boolean, nullable=False, default=False)
