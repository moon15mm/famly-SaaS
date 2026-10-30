from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select, update
from .db import get_db
from .security import current_user, audit
from .models_ext import Address
from .models import User

router = APIRouter(prefix="/addresses", tags=["addresses"])


class AddressInput(BaseModel):
    label: str = Field(min_length=2, max_length=80)
    city: str = Field(min_length=2, max_length=80)
    details: str = Field(min_length=10, max_length=1000)
    phone: str = Field(default="", max_length=20, pattern=r"^\+?[0-9 ]*$")
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    is_default: bool = False

    @model_validator(mode="after")
    def paired(self):
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("حدد إحداثيي الموقع معًا")
        return self


def address_json(a):
    return {k: getattr(a, k) for k in ["id", "label", "city", "details", "phone", "latitude", "longitude", "is_default"]}


@router.get("")
def addresses(user=Depends(current_user), db=Depends(get_db)):
    return [address_json(a) for a in db.scalars(select(Address).where(Address.user_id == user.id).order_by(Address.is_default.desc()))]


@router.post("", status_code=201)
def create(data: AddressInput, user=Depends(current_user), db=Depends(get_db)):
    db.scalar(select(User).where(User.id == user.id).with_for_update())
    current = list(db.scalars(select(Address).where(Address.user_id == user.id)))
    if len(current) >= 20:
        raise HTTPException(409, "يمكن حفظ 20 عنوانًا كحد أقصى")
    values = data.model_dump()
    if data.is_default or not current:
        db.execute(update(Address).where(Address.user_id == user.id).values(is_default=False))
        values["is_default"] = True
    a = Address(user_id=user.id, **values)
    db.add(a)
    db.flush()
    audit(db, user, "address.create", a.id)
    db.commit()
    return address_json(a)


@router.put("/{address_id}")
def edit(address_id: str, data: AddressInput, user=Depends(current_user), db=Depends(get_db)):
    db.scalar(select(User).where(User.id == user.id).with_for_update())
    a = db.get(Address, address_id)
    if not a or a.user_id != user.id:
        raise HTTPException(404, "العنوان غير موجود")
    if data.is_default:
        db.execute(update(Address).where(Address.user_id == user.id).values(is_default=False))
    for key, value in data.model_dump().items():
        setattr(a, key, value)
    audit(db, user, "address.update", a.id)
    db.commit()
    return address_json(a)


@router.delete("/{address_id}")
def remove(address_id: str, user=Depends(current_user), db=Depends(get_db)):
    a = db.get(Address, address_id)
    if not a or a.user_id != user.id:
        raise HTTPException(404, "العنوان غير موجود")
    db.delete(a)
    audit(db, user, "address.delete", address_id)
    db.commit()
    return {"ok": True}
