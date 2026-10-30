"""One-time authoring helper for freezing revision 001, never used during deployment."""

from pathlib import Path
from sqlalchemy import create_engine
from alembic.migration import MigrationContext
from alembic.autogenerate import produce_migrations, render_python_code
from app.db import Base
from app import models  # noqa: F401

path = Path("backend/migrations/versions/001_initial.py")
if "Base.metadata.create_all" not in path.read_text(encoding="utf-8"):
    raise SystemExit("Revision already frozen; no changes made.")
with create_engine("sqlite:///:memory:").connect() as connection:
    operations = produce_migrations(MigrationContext.configure(connection), Base.metadata)
    upgrade = render_python_code(operations.upgrade_ops)
    downgrade = render_python_code(operations.downgrade_ops)
header = '"""Initial marketplace schema. Frozen revision, independent of future model changes."""\nfrom alembic import op\nimport sqlalchemy as sa\n\nrevision = "001_initial"\ndown_revision = None\nbranch_labels = None\ndepends_on = None\n'
path.write_text(header + "\n\ndef upgrade():\n" + upgrade + "\n\ndef downgrade():\n" + downgrade + "\n", encoding="utf-8")
print("Frozen initial migration with explicit schema operations.")
