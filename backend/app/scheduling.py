from datetime import timedelta, timezone
from zoneinfo import ZoneInfo
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from .db import get_db
from .models import Household, Product, now
from .models_ext import ScheduleSlot

router = APIRouter(tags=["scheduling"])
SAUDI = ZoneInfo("Asia/Riyadh")


def reserve(db, h, scheduled):
    bucket = scheduled.replace(minute=0, second=0, microsecond=0)
    slot = db.scalar(select(ScheduleSlot).where(ScheduleSlot.household_id == h.id, ScheduleSlot.starts_at == bucket))
    if not slot:
        try:
            with db.begin_nested():
                slot = ScheduleSlot(household_id=h.id, starts_at=bucket, reserved=0)
                db.add(slot)
                db.flush()
        except IntegrityError:
            slot = db.scalar(select(ScheduleSlot).where(ScheduleSlot.household_id == h.id, ScheduleSlot.starts_at == bucket))
    changed = db.execute(
        update(ScheduleSlot)
        .where(ScheduleSlot.id == slot.id, ScheduleSlot.reserved < h.slot_capacity)
        .values(reserved=ScheduleSlot.reserved + 1)
    )
    if changed.rowcount != 1:
        raise HTTPException(409, "اكتملت سعة هذا الموعد؛ اختر موعدًا آخر")
    return slot.id


def release(db, order):
    if order.slot_id:
        db.execute(
            update(ScheduleSlot)
            .where(ScheduleSlot.id == order.slot_id, ScheduleSlot.reserved > 0)
            .values(reserved=ScheduleSlot.reserved - 1)
        )


@router.get("/households/{household_id}/slots")
def slots(household_id: str, product_id: str = "", days: int = Query(7, ge=1, le=30), db=Depends(get_db)):
    h = db.get(Household, household_id)
    if not h or not h.verified or h.on_vacation:
        raise HTTPException(404, "الأسرة غير متاحة")
    product = db.get(Product, product_id) if product_id else None
    if product_id and (not product or product.household_id != h.id or product.status != "published"):
        raise HTTPException(404, "المنتج غير متاح")
    earliest = now() + timedelta(hours=product.prep_hours if product else 0)
    first = now().replace(tzinfo=timezone.utc).astimezone(SAUDI).replace(minute=0, second=0, microsecond=0)
    occupied = {
        s.starts_at: s.reserved
        for s in db.scalars(
            select(ScheduleSlot).where(ScheduleSlot.household_id == h.id, ScheduleSlot.starts_at >= now() - timedelta(hours=1))
        )
    }
    result = []
    for offset in range(days * 24):
        local = first + timedelta(hours=offset)
        utc = local.astimezone(timezone.utc).replace(tzinfo=None)
        if h.opening_hour <= local.hour < h.closing_hour and utc >= earliest:
            remaining = max(0, h.slot_capacity - occupied.get(utc, 0))
            result.append({"scheduled_at": local.isoformat(), "remaining": remaining, "available": remaining > 0})
    return result
