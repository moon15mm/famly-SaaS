"""Latest driver positions for live delivery tracking and household pickup coordinates."""

from alembic import op
import sqlalchemy as sa

revision = "004_driver_tracking"
down_revision = "003_local_workflows"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "driver_positions",
        sa.Column("driver_id", sa.String(length=32), nullable=False),
        sa.Column("latitude", sa.Float(), nullable=False),
        sa.Column("longitude", sa.Float(), nullable=False),
        sa.Column("accuracy", sa.Float(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["driver_id"],
            ["users.id"],
        ),
        sa.PrimaryKeyConstraint("driver_id"),
    )
    with op.batch_alter_table("households", schema=None) as batch_op:
        batch_op.add_column(sa.Column("pickup_latitude", sa.Float(), nullable=True))
        batch_op.add_column(sa.Column("pickup_longitude", sa.Float(), nullable=True))


def downgrade():
    with op.batch_alter_table("households", schema=None) as batch_op:
        batch_op.drop_column("pickup_longitude")
        batch_op.drop_column("pickup_latitude")
    op.drop_table("driver_positions")
