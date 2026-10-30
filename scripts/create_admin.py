"""Interactive admin creation. No default account or password in production."""

import getpass
from sqlalchemy import select
from app.db import SessionLocal
from app.models import User
from app.security import hasher

email = input("Admin email: ").strip().lower()
name = input("Name: ").strip()
password = getpass.getpass("Unique password (at least 16 characters): ")
if "@" not in email or len(password) < 16 or len(name) < 2:
    raise SystemExit("Invalid account details")
with SessionLocal() as db:
    if db.scalar(select(User).where(User.email == email)):
        raise SystemExit("Account already exists; no changes made")
    db.add(User(email=email, name=name, role="admin", password_hash=hasher.hash(password)))
    db.commit()
print("Administrator created. Restrict admin access at the reverse proxy until MFA is configured.")
