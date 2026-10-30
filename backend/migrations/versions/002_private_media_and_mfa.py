"""Private media ownership and administrator TOTP replay protection."""

from alembic import op
import sqlalchemy as sa

revision = "002_media_mfa"
down_revision = "001_initial"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("users", sa.Column("mfa_last_counter", sa.Integer(), nullable=False, server_default="-1"))
    op.add_column("users", sa.Column("active_trip_id", sa.String(32), nullable=True))
    op.create_table(
        "media",
        sa.Column("url", sa.String(128), primary_key=True),
        sa.Column("owner_id", sa.String(32), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("public", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_index("ix_media_owner_id", "media", ["owner_id"])


def downgrade():
    op.drop_index("ix_media_owner_id", table_name="media")
    op.drop_table("media")
    op.drop_column("users", "mfa_last_counter")
    op.drop_column("users", "active_trip_id")
