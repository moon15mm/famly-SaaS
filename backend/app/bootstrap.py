"""Idempotent production-safe category bootstrap, without users or sample products."""

from .db import SessionLocal
from .models import Category

CATEGORIES = [
    ("food", "من مطابخنا", "cooking"),
    ("sweets", "حلا وضيافة", "cake"),
    ("perfume", "عطور وبخور", "flower"),
    ("gifts", "هدايا وتوزيعات", "gift"),
    ("crafts", "حِرف يدوية", "palette"),
    ("other", "أشياء أخرى", "sparkles"),
]


def bootstrap():
    with SessionLocal() as db:
        for category_id, name, icon in CATEGORIES:
            if not db.get(Category, category_id):
                db.add(Category(id=category_id, name=name, icon=icon))
        db.commit()


if __name__ == "__main__":
    bootstrap()
