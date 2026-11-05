from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from .db import get_db
from .models import Favorite, Product, Household, Notification, SupportTicket, Plan
from .security import current_user, roles, household
from .catalog import product_json, storefront_open
from .orders import visible_order

router = APIRouter(tags=["account"])


class AddressInput(BaseModel):
    address: str = Field(max_length=1000)
    name: str = Field(min_length=2, max_length=100)


@router.put("/account")
def profile(data: AddressInput, user=Depends(current_user), db=Depends(get_db)):
    user.address, user.name = data.address, data.name
    db.commit()
    return {"ok": True}


@router.get("/favorites")
def favorites(user=Depends(current_user), db=Depends(get_db)):
    products = db.scalars(
        select(Product)
        .join(Favorite)
        .join(Household, Household.id == Product.household_id)
        .where(Favorite.user_id == user.id, Product.status == "published", storefront_open())
    )
    return [product_json(p) for p in products]


@router.post("/favorites/{product_id}")
def toggle_favorite(product_id: str, user=Depends(current_user), db=Depends(get_db)):
    p = db.get(Product, product_id)
    if not p or p.status != "published":
        raise HTTPException(404, "المنتج غير موجود")
    item = db.get(Favorite, (user.id, product_id))
    if item:
        db.delete(item)
    else:
        db.add(Favorite(user_id=user.id, product_id=product_id))
    db.commit()
    return {"saved": not bool(item)}


@router.get("/notifications")
def notifications(user=Depends(current_user), db=Depends(get_db)):
    return [
        {"id": n.id, "message": n.message, "read": n.read, "created_at": n.created_at}
        for n in db.scalars(select(Notification).where(Notification.user_id == user.id).order_by(Notification.created_at.desc()).limit(100))
    ]


@router.post("/notifications/read")
def mark_read(user=Depends(current_user), db=Depends(get_db)):
    from sqlalchemy import update

    db.execute(update(Notification).where(Notification.user_id == user.id).values(read=True))
    db.commit()
    return {"ok": True}


class TicketInput(BaseModel):
    order_id: str = Field(max_length=32)
    message: str = Field(min_length=10, max_length=3000)


@router.post("/support", status_code=201)
def support(data: TicketInput, user=Depends(current_user), db=Depends(get_db)):
    visible_order(db, data.order_id, user)
    ticket = SupportTicket(user_id=user.id, **data.model_dump())
    db.add(ticket)
    db.commit()
    return {"id": ticket.id}


@router.get("/plans")
def plans(db=Depends(get_db)):
    return [
        {
            "id": p.id,
            "name": p.name,
            "monthly_price": p.monthly_price,
            "annual_price": p.annual_price,
            "trial_days": p.trial_days,
            "product_limit": p.product_limit,
        }
        for p in db.scalars(select(Plan).where(Plan.active.is_(True)))
    ]


@router.get("/seller/ledger")
def ledger(user=Depends(roles("seller")), db=Depends(get_db)):
    from .models import Ledger, Order

    h = household(db, user)
    # A family sees its own sales, the platform commission on them and refunds; delivery and service fees are not theirs.
    records = db.scalars(
        select(Ledger)
        .join(Order)
        .where(Order.household_id == h.id, Ledger.kind.in_(["product_sales", "merchant_commission", "refund"]))
        .order_by(Ledger.created_at.desc())
        .limit(200)
    )
    return [{"order_id": r.order_id, "kind": r.kind, "amount": r.amount, "note": r.note} for r in records]
