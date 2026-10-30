from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select, func
from .db import get_db
from .models import User, Household, Product, Order, Audit, Plan, SupportTicket, DeliveryRule, Category
from .schemas import PlanInput
from .security import roles, audit

router = APIRouter(prefix="/admin", tags=["administration"], dependencies=[Depends(roles("admin"))])


@router.get("/plans")
def all_plans(db=Depends(get_db)):
    return [
        {k: getattr(p, k) for k in ["id", "name", "monthly_price", "annual_price", "product_limit", "trial_days", "active"]}
        for p in db.scalars(select(Plan))
    ]


@router.delete("/categories/{category_id}")
def delete_category(category_id: str, user=Depends(roles("admin")), db=Depends(get_db)):
    c = db.get(Category, category_id)
    if not c:
        raise HTTPException(404, "التصنيف غير موجود")
    if category_id == "other" or db.scalar(select(Product.id).where(Product.category_id == category_id).limit(1)):
        raise HTTPException(409, "لا يمكن حذف تصنيف مرتبط بمنتجات أو تصنيف الاستقبال الافتراضي")
    db.delete(c)
    audit(db, user, "category.delete", category_id)
    db.commit()
    return {"ok": True}


@router.get("/overview")
def overview(db=Depends(get_db)):
    def count(model):
        return db.scalar(select(func.count()).select_from(model))

    return {
        "users": count(User),
        "households": count(Household),
        "products": count(Product),
        "orders": count(Order),
        "gross_sales": db.scalar(
            select(func.coalesce(func.sum(Order.total), 0)).where(
                Order.payment_status.in_(["paid", "partial_refund", "refunded", "refund_pending"])
            )
        ),
    }


@router.get("/households")
def households(db=Depends(get_db)):
    return [
        {"id": h.id, "name": h.name, "city": h.city, "verified": h.verified, "subscription_status": h.subscription_status}
        for h in db.scalars(select(Household))
    ]


@router.post("/households/{household_id}/verify")
def verify_household(household_id: str, verified: bool, user=Depends(roles("admin")), db=Depends(get_db)):
    h = db.get(Household, household_id)
    if not h:
        raise HTTPException(404, "الأسرة غير موجودة")
    h.verified = verified
    audit(db, user, "household.verify." + str(verified), h.id)
    db.commit()
    return {"ok": True}


@router.get("/users")
def users(db=Depends(get_db)):
    return [
        {"id": u.id, "name": u.name, "role": u.role, "active": u.active, "driver_verified": u.driver_verified}
        for u in db.scalars(select(User))
    ]


@router.post("/users/{user_id}/status")
def user_status(user_id: str, active: bool, driver_verified: bool = False, user=Depends(roles("admin")), db=Depends(get_db)):
    target = db.scalar(select(User).where(User.id == user_id).with_for_update())
    if not target or target.role == "admin":
        raise HTTPException(422, "لا يمكن تعديل هذا الحساب من هنا")
    if target.role == "driver" and target.active_trip_id and (not active or not driver_verified):
        raise HTTPException(409, "راجع الرحلة النشطة وأعد إسنادها قبل تعطيل السائق أو سحب أهليته")
    target.active = active
    if target.role == "driver":
        target.driver_verified = driver_verified
    audit(db, user, "user.status", user_id)
    db.commit()
    return {"ok": True}


@router.post("/products/{product_id}/pause")
def pause(product_id: str, user=Depends(roles("admin")), db=Depends(get_db)):
    p = db.get(Product, product_id)
    if not p:
        raise HTTPException(404, "المنتج غير موجود")
    p.status = "paused"
    audit(db, user, "admin.product.pause", p.id)
    db.commit()
    return {"ok": True}


@router.post("/plans", status_code=201)
def create_plan(data: PlanInput, user=Depends(roles("admin")), db=Depends(get_db)):
    p = Plan(**data.model_dump())
    db.add(p)
    db.flush()
    audit(db, user, "plan.create", p.id)
    db.commit()
    return {"id": p.id}


@router.put("/plans/{plan_id}")
def update_plan(plan_id: str, data: PlanInput, user=Depends(roles("admin")), db=Depends(get_db)):
    p = db.get(Plan, plan_id)
    if not p:
        raise HTTPException(404, "الباقة غير موجودة")
    for k, v in data.model_dump().items():
        setattr(p, k, v)
    audit(db, user, "plan.update", p.id)
    db.commit()
    return {"ok": True}


@router.get("/audit")
def events(db=Depends(get_db)):
    return [
        {"action": e.action, "resource_id": e.resource_id, "created_at": e.created_at}
        for e in db.scalars(select(Audit).order_by(Audit.created_at.desc()).limit(200))
    ]


@router.get("/tickets")
def tickets(db=Depends(get_db)):
    return [
        {"id": t.id, "order_id": t.order_id, "message": t.message, "status": t.status} for t in db.scalars(select(SupportTicket).limit(100))
    ]


@router.post("/tickets/{ticket_id}/resolve")
def resolve(ticket_id: str, user=Depends(roles("admin")), db=Depends(get_db)):
    t = db.get(SupportTicket, ticket_id)
    if not t:
        raise HTTPException(404, "الطلب غير موجود")
    t.status = "resolved"
    audit(db, user, "ticket.resolve", t.id)
    db.commit()
    return {"ok": True}


class RuleInput(BaseModel):
    base_fee: int = Field(ge=0, le=100000)
    per_km: int = Field(ge=0, le=10000)
    max_km: int = Field(ge=1, le=100)


@router.get("/delivery-rule")
def get_rule(db=Depends(get_db)):
    rule = db.get(DeliveryRule, 1)
    return {
        "base_fee": rule.base_fee if rule else 1500,
        "per_km": rule.per_km if rule else 200,
        "max_km": rule.max_km if rule else 30,
        "mode": "test",
    }


@router.put("/delivery-rule")
def set_rule(data: RuleInput, user=Depends(roles("admin")), db=Depends(get_db)):
    rule = db.get(DeliveryRule, 1)
    if not rule:
        rule = DeliveryRule(id=1)
        db.add(rule)
    for k, v in data.model_dump().items():
        setattr(rule, k, v)
    audit(db, user, "delivery.rule.update", "1")
    db.commit()
    return {"ok": True}


class CategoryInput(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    icon: str = Field(default="gift", max_length=30)


@router.put("/categories/{category_id}")
def put_category(category_id: str, data: CategoryInput, user=Depends(roles("admin")), db=Depends(get_db)):
    import re

    if not re.fullmatch(r"[a-z0-9-]{2,50}", category_id):
        raise HTTPException(422, "معرف تصنيف غير صالح")
    c = db.get(Category, category_id)
    if not c:
        c = Category(id=category_id)
        db.add(c)
    c.name, c.icon = data.name, data.icon
    audit(db, user, "category.update", category_id)
    db.commit()
    return {"ok": True}
