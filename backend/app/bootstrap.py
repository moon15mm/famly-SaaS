"""Idempotent production-safe bootstrap: categories, document requirements and first contract versions.

Never creates users or sample products, and never overwrites anything an administrator edited.
"""

import hashlib
from sqlalchemy import select
from .db import SessionLocal
from .models import Category
from .models_ext import ContractVersion, DocumentRequirement
from .contract_texts import CONTRACTS, REQUIREMENTS

CATEGORIES = [
    ("food", "من مطابخنا", "cooking"),
    ("sweets", "حلا وضيافة", "cake"),
    ("perfume", "عطور وبخور", "flower"),
    ("gifts", "هدايا وتوزيعات", "gift"),
    ("crafts", "حِرف يدوية", "palette"),
    ("other", "أشياء أخرى", "sparkles"),
]


def ensure_defaults(db):
    for category_id, name, icon in CATEGORIES:
        if not db.get(Category, category_id):
            db.add(Category(id=category_id, name=name, icon=icon))
    for requirement_id, role, title, description, required, needs_expiry, position in REQUIREMENTS:
        if not db.get(DocumentRequirement, requirement_id):
            db.add(
                DocumentRequirement(
                    id=requirement_id,
                    role=role,
                    title=title,
                    description=description,
                    required=required,
                    needs_expiry=needs_expiry,
                    active=True,
                    position=position,
                )
            )
    for role, (title, body) in CONTRACTS.items():
        if not db.scalar(select(ContractVersion.id).where(ContractVersion.role == role).limit(1)):
            db.add(ContractVersion(role=role, version=1, title=title, body=body, body_hash=hashlib.sha256(body.encode()).hexdigest()))


def bootstrap():
    with SessionLocal() as db:
        ensure_defaults(db)
        db.commit()


if __name__ == "__main__":
    bootstrap()
