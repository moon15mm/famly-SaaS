"""Create ignored local development settings once. Never overwrites existing settings."""

from pathlib import Path
import secrets

target = Path(".env")
if target.exists():
    print("Existing .env preserved.")
else:
    value = Path(".env.example").read_text(encoding="utf-8").replace("PAYMENT_PROVIDER=disabled", "PAYMENT_PROVIDER=test")
    value = value.replace("PAYMENT_WEBHOOK_SECRET=", "PAYMENT_WEBHOOK_SECRET=" + secrets.token_urlsafe(48))
    value = value.replace("MAIL_TRANSPORT=disabled", "MAIL_TRANSPORT=local")
    value = value.replace("PRIVATE_LINK_SECRET=", "PRIVATE_LINK_SECRET=" + secrets.token_urlsafe(48))
    value += "\nDEMO_PASSWORD=" + secrets.token_urlsafe(24) + "\n"
    target.write_text(value, encoding="utf-8")
    print("Local .env created with random development credentials. Never use this configuration in production.")
