"""Authoring only: generate one frozen migration from the existing v1 database."""

from pathlib import Path
from alembic.migration import MigrationContext
from alembic.autogenerate import produce_migrations, render_python_code
from app.db import engine, Base
from app import models, models_ext  # noqa: F401

target = Path("backend/migrations/versions/003_complete_local_workflows.py")
if target.exists():
    raise SystemExit("Migration already exists; never regenerate an applied revision")
with engine.connect() as connection:
    operations = produce_migrations(MigrationContext.configure(connection), Base.metadata)
    up = render_python_code(operations.upgrade_ops, render_as_batch=True)
    down = render_python_code(operations.downgrade_ops, render_as_batch=True)
header = '"""Account lifecycle, scheduling, subscriptions, documents and reliable outbox."""\nfrom alembic import op\nimport sqlalchemy as sa\nrevision="003_local_workflows"\ndown_revision="002_media_mfa"\nbranch_labels=None\ndepends_on=None\n'
target.write_text(header + "\n\ndef upgrade():\n" + up + "\n\ndef downgrade():\n" + down + "\n", encoding="utf-8")
print("Frozen migration 003 generated without modifying database")
