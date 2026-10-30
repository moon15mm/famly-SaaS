"""Account lifecycle, addresses, scheduling, subscriptions and private verification."""

from sqlalchemy import Column, String, Integer, Boolean, DateTime, ForeignKey, Text, Float, UniqueConstraint
from .db import Base
from .models import uid, now


class ActionToken(Base):
    __tablename__ = "action_tokens"
    token_hash = Column(String(64), primary_key=True)
    user_id = Column(ForeignKey("users.id"), nullable=False, index=True)
    purpose = Column(String(24), nullable=False)
    expires_at = Column(DateTime, nullable=False)
    used_at = Column(DateTime)


class EmailMessage(Base):
    __tablename__ = "email_messages"
    id = Column(String(32), primary_key=True, default=uid)
    recipient = Column(String(254), nullable=False, index=True)
    subject = Column(String(200), nullable=False)
    body = Column(Text, nullable=False)
    created_at = Column(DateTime, nullable=False, default=now)
    expires_at = Column(DateTime, nullable=False)
    sent_at = Column(DateTime)


class Address(Base):
    __tablename__ = "addresses"
    id = Column(String(32), primary_key=True, default=uid)
    user_id = Column(ForeignKey("users.id"), nullable=False, index=True)
    label = Column(String(80), nullable=False)
    city = Column(String(80), nullable=False)
    details = Column(String(1000), nullable=False)
    phone = Column(String(20), nullable=False, default="")
    latitude = Column(Float)
    longitude = Column(Float)
    is_default = Column(Boolean, nullable=False, default=False)


class ScheduleSlot(Base):
    __tablename__ = "schedule_slots"
    __table_args__ = (UniqueConstraint("household_id", "starts_at"),)
    id = Column(String(32), primary_key=True, default=uid)
    household_id = Column(ForeignKey("households.id"), nullable=False, index=True)
    starts_at = Column(DateTime, nullable=False)
    reserved = Column(Integer, nullable=False, default=0)


class Subscription(Base):
    __tablename__ = "subscriptions"
    household_id = Column(ForeignKey("households.id"), primary_key=True)
    plan_id = Column(ForeignKey("plans.id"), nullable=False)
    interval = Column(String(12), nullable=False)
    status = Column(String(24), nullable=False, default="pending")
    ends_at = Column(DateTime)
    auto_renew = Column(Boolean, nullable=False, default=False)


class Invoice(Base):
    __tablename__ = "invoices"
    __table_args__ = (UniqueConstraint("household_id", "idempotency_key"),)
    id = Column(String(32), primary_key=True, default=uid)
    household_id = Column(ForeignKey("households.id"), nullable=False, index=True)
    plan_id = Column(ForeignKey("plans.id"), nullable=False)
    idempotency_key = Column(String(100), nullable=False)
    interval = Column(String(12), nullable=False)
    plan_name = Column(String(100), nullable=False)
    amount = Column(Integer, nullable=False)
    status = Column(String(24), nullable=False, default="unpaid")
    provider = Column(String(30), nullable=False, default="test")
    created_at = Column(DateTime, nullable=False, default=now)
    paid_at = Column(DateTime)
    period_start = Column(DateTime)
    period_end = Column(DateTime)


class VerificationDocument(Base):
    __tablename__ = "verification_documents"
    id = Column(String(32), primary_key=True, default=uid)
    owner_id = Column(ForeignKey("users.id"), nullable=False, index=True)
    household_id = Column(ForeignKey("households.id"), index=True)
    kind = Column(String(80), nullable=False)
    filename = Column(String(100), nullable=False)
    mime_type = Column(String(40), nullable=False)
    status = Column(String(20), nullable=False, default="pending")
    reviewer_note = Column(String(1000), nullable=False, default="")
    created_at = Column(DateTime, nullable=False, default=now)


class TelegramPendingPhoto(Base):
    __tablename__ = "telegram_pending_photos"
    household_id = Column(ForeignKey("households.id"), primary_key=True)
    image_url = Column(String(128), nullable=False)
    expires_at = Column(DateTime, nullable=False)


class DeliveryIssue(Base):
    __tablename__ = "delivery_issues"
    id = Column(String(32), primary_key=True, default=uid)
    order_id = Column(ForeignKey("orders.id"), nullable=False, index=True)
    driver_id = Column(ForeignKey("users.id"), nullable=False)
    reason = Column(String(1000), nullable=False)
    resolved = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, nullable=False, default=now)


class DataRequest(Base):
    __tablename__ = "data_requests"
    id = Column(String(32), primary_key=True, default=uid)
    user_id = Column(ForeignKey("users.id"), nullable=False, index=True)
    kind = Column(String(24), nullable=False)
    status = Column(String(24), nullable=False, default="pending")
    note = Column(String(1000), nullable=False, default="")
    created_at = Column(DateTime, nullable=False, default=now)


class DeliveryRejection(Base):
    __tablename__ = "delivery_rejections"
    order_id = Column(ForeignKey("orders.id"), primary_key=True)
    driver_id = Column(ForeignKey("users.id"), primary_key=True)


class DriverPosition(Base):
    """Only the latest point per driver; removed when the shift ends or the point goes stale."""

    __tablename__ = "driver_positions"
    driver_id = Column(ForeignKey("users.id"), primary_key=True)
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    accuracy = Column(Float)
    updated_at = Column(DateTime, nullable=False, default=now)
