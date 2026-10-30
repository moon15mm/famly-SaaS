"""Explicit development data only. Never runs automatically at startup."""

import os
from dotenv import load_dotenv
from sqlalchemy import select
from .config import settings
from .db import SessionLocal
from .models import Category, User, Household, Product, Plan, DeliveryRule, Media
from .security import hasher

CATEGORIES = [
    ("food", "من مطابخنا", "cooking"),
    ("sweets", "حلا وضيافة", "cake"),
    ("perfume", "عطور وبخور", "flower"),
    ("gifts", "هدايا وتوزيعات", "gift"),
    ("crafts", "حِرف يدوية", "palette"),
    ("other", "أشياء أخرى", "sparkles"),
]
PHOTO_IDS = [
    "photo-1578985545062-69928b1d9587",
    "photo-1555507036-ab1f4038808a",
    "photo-1608571423902-eed4a5ad8108",
    "photo-1490312278390-ab64016e0aa9",
    "photo-1513519245088-0e12902e5a38",
    "photo-1499636136210-6f4ee915583e",
    "photo-1544787219-7f47ccb76574",
    "photo-1578749556568-bc2c40e68b61",
]


def seed():
    load_dotenv()
    if settings.app_env == "production":
        raise RuntimeError("Development seed is forbidden in production")
    password = os.environ.get("DEMO_PASSWORD", "")
    if len(password) < 12:
        raise RuntimeError("Set a unique DEMO_PASSWORD of at least 12 characters locally")
    with SessionLocal() as db:
        if db.scalar(select(User).where(User.email == "seller1@example.test")):
            for p in db.scalars(select(Product)):
                for url in p.images:
                    if not db.get(Media, url):
                        h = db.get(Household, p.household_id)
                        db.add(Media(url=url, owner_id=h.owner_id, public=p.status == "published"))
            db.commit()
            print("Seed already exists; no records changed.")
            return
        for key, name, icon in CATEGORIES:
            if not db.get(Category, key):
                db.add(Category(id=key, name=name, icon=icon))
        plan = Plan(name="بداية", monthly_price=4900, product_limit=30)
        db.add(plan)
        db.add(Plan(name="حكاية أكبر", monthly_price=9900, product_limit=100))
        db.add(DeliveryRule(id=1))
        db.flush()
        stores = []
        for i, (name, description) in enumerate(
            [
                ("مطبخ أم نورة", "نكهات بيتية وضيافة نحضّرها بشغف. متجر تجريبي لا يستقبل طلبات حقيقية."),
                ("لمسة وورد", "هدايا وحرف وتفاصيل صغيرة، نصنعها بحب. بيانات عرض تجريبية."),
                ("عبق الدار", "عطور وبخور ولمسات للبيت. بيانات عرض تجريبية وليست متجرًا حقيقيًا."),
            ]
        ):
            user = User(email=f"seller{i + 1}@example.test", name=name, role="seller", password_hash=hasher.hash(password))
            db.add(user)
            db.flush()
            h = Household(
                owner_id=user.id,
                name=name,
                description=description,
                city=["الرياض", "جدة", "الدمام"][i],
                pickup_address="عنوان عرض تجريبي — لا يمثل موقع أسرة حقيقية",
                # Approximate city centres for demo navigation, not real homes.
                pickup_latitude=[24.7136, 21.5433, 26.4207][i],
                pickup_longitude=[46.6753, 39.1728, 50.0888][i],
                verified=True,
                free_delivery=True,
                plan_id=plan.id,
                subscription_status="trial",
                opening_hour=8,
                closing_hour=23,
            )
            db.add(h)
            db.flush()
            stores.append(h)
        for role in ["customer", "driver", "admin"]:
            db.add(
                User(
                    email=role + "@example.test",
                    name={"customer": "عميل التجربة", "driver": "سائق التجربة", "admin": "مدير التجربة"}[role],
                    role=role,
                    driver_verified=role == "driver",
                    password_hash=hasher.hash(password),
                )
            )
        samples = [
            ("كيكة الشوكولاتة الغنية", "sweets", 8500, 0),
            ("كرواسون الزبدة — بوكس 6 قطع", "food", 4500, 0),
            ("عطر ورد للمنزل", "perfume", 6500, 2),
            ("بوكس هدية بتفاصيلك", "gifts", 12000, 1),
            ("لوحة فنية للبيت", "crafts", 9500, 1),
            ("كوكيز الشوكولاتة — 8 قطع", "sweets", 4800, 0),
            ("مجموعة شاي للضيافة", "food", 5500, 0),
            ("كوب خزفي بلمسة يدوية", "crafts", 7000, 1),
        ]
        for i, (name, category, price, store_index) in enumerate(samples):
            db.add(Media(url="/media/demo-" + str(i) + ".webp", owner_id=stores[store_index].owner_id, public=True))
            db.add(
                Product(
                    household_id=stores[store_index].id,
                    category_id=category,
                    name=name,
                    description="منتج عرض تجريبي لا يباع فعليًا. الصورة من Unsplash للتوضيح فقط. تضاف تفاصيل المنتج ومكوناته واشتراطاته عند رفع المنتج الحقيقي من الأسرة.",
                    price=price,
                    stock=20,
                    prep_hours=24,
                    images=["/media/demo-" + str(i) + ".webp"],
                    status="published",
                    featured=i < 4,
                )
            )
        db.commit()
    print("Development seed created. Emails: seller1/2/3, customer, driver, admin @example.test. Password comes only from DEMO_PASSWORD.")


if __name__ == "__main__":
    seed()
