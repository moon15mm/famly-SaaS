from datetime import datetime
from typing import Literal
from pydantic import BaseModel, Field, field_validator, model_validator


class Register(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    email: str = Field(min_length=5, max_length=254, pattern=r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
    password: str = Field(min_length=12, max_length=128)
    role: Literal["customer", "seller", "driver"] = "customer"


class Login(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(max_length=128)
    otp: str = Field(default="", max_length=6)


class ProductOption(BaseModel):
    id: str = Field(min_length=1, max_length=40, pattern=r"^[a-zA-Z0-9_-]+$")
    name: str = Field(min_length=1, max_length=100)
    price_delta: int = Field(ge=-1000000, le=1000000, default=0)


class ProductInput(BaseModel):
    name: str = Field(min_length=2, max_length=150)
    description: str = Field(max_length=5000)
    category_id: str = Field(max_length=50)
    price: int = Field(ge=100, le=10000000)
    stock: int = Field(ge=0, le=100000)
    prep_hours: int = Field(ge=0, le=720, default=24)
    images: list[str] = Field(default_factory=list, max_length=8)
    status: Literal["draft", "published", "paused"] = "draft"
    options: list[ProductOption] = Field(default_factory=list, max_length=20)

    @field_validator("options")
    @classmethod
    def unique_options(cls, options):
        if len({o.id for o in options}) != len(options):
            raise ValueError("معرفات الخيارات مكررة")
        return options

    @field_validator("images")
    @classmethod
    def safe_images(cls, images):
        for image in images:
            if not image.startswith("/media/") or ".." in image or len(image) > 120:
                raise ValueError("استخدم صورًا مرفوعة إلى المنصة")
        return images


class CartItem(BaseModel):
    product_id: str = Field(max_length=32)
    quantity: int = Field(ge=1, le=100)
    option_id: str = Field(default="", max_length=40)


class Checkout(BaseModel):
    items: list[CartItem] = Field(min_length=1, max_length=40)
    delivery_method: Literal["pickup", "free", "paid"]
    address: str = Field(default="", max_length=1000)
    scheduled_at: datetime
    idempotency_key: str = Field(min_length=16, max_length=80)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    quoted_total: int | None = Field(default=None, ge=100, le=2147483647)


class HouseholdInput(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    description: str = Field(default="", max_length=2000)
    city: str = Field(min_length=2, max_length=80)
    pickup_address: str = Field(min_length=8, max_length=1000)
    free_delivery: bool = False
    delivery_enabled: bool = True
    opening_hour: int = Field(ge=0, le=22, default=9)
    closing_hour: int = Field(ge=1, le=23, default=21)
    on_vacation: bool = False
    slot_capacity: int = Field(ge=1, le=100, default=10)
    pickup_latitude: float | None = Field(default=None, ge=-90, le=90)
    pickup_longitude: float | None = Field(default=None, ge=-180, le=180)

    @model_validator(mode="after")
    def paired_pickup(self):
        if (self.pickup_latitude is None) != (self.pickup_longitude is None):
            raise ValueError("حدد إحداثيي موقع الاستلام معًا")
        return self


class ReviewInput(BaseModel):
    rating: int = Field(ge=1, le=5)
    comment: str = Field(min_length=3, max_length=1000)


class PlanInput(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    monthly_price: int = Field(ge=0, le=1000000)
    product_limit: int = Field(ge=1, le=10000)
    active: bool = True
    annual_price: int | None = Field(default=None, ge=0, le=12000000)
    trial_days: int = Field(default=14, ge=0, le=90)
