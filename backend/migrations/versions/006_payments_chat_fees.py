"""Tap charge tracking, the fee split stored per order, order chat, driver ratings and the pickup switch.

`order_chat_messages` and `households.pickup_enabled` were created by hand on one server before
this migration existed, so both are added only when missing; everything else is new.
"""

from alembic import op
import sqlalchemy as sa

revision = "006_payments_chat"
down_revision = "005_contracts"
branch_labels = None
depends_on = None


def _inspector():
    return sa.inspect(op.get_bind())


def _columns(table):
    return {column["name"] for column in _inspector().get_columns(table)}


def _indexes(table):
    return {index["name"] for index in _inspector().get_indexes(table)}


def _backfill_order_fees():
    """Orders placed since the 1.50 SAR service fee went live carry it inside `total`; split those exactly."""
    bind = op.get_bind()
    orders = sa.table(
        "orders",
        sa.column("id", sa.String),
        sa.column("household_id", sa.String),
        sa.column("subtotal", sa.Integer),
        sa.column("delivery_fee", sa.Integer),
        sa.column("total", sa.Integer),
        sa.column("service_fee", sa.Integer),
        sa.column("delivery_margin", sa.Integer),
        sa.column("merchant_fee", sa.Integer),
    )
    households = sa.table("households", sa.column("id", sa.String), sa.column("plan_id", sa.String))
    plans = sa.table("plans", sa.column("id", sa.String), sa.column("name", sa.String), sa.column("monthly_price", sa.Integer))
    plan_of = {row.id: row.plan_id for row in bind.execute(sa.select(households.c.id, households.c.plan_id))}
    plan_rows = {row.id: row for row in bind.execute(sa.select(plans.c.id, plans.c.name, plans.c.monthly_price))}
    rows = bind.execute(
        sa.select(orders.c.id, orders.c.household_id, orders.c.subtotal, orders.c.delivery_fee, orders.c.total).where(
            orders.c.total > orders.c.subtotal + orders.c.delivery_fee
        )
    ).fetchall()
    for row in rows:
        plan = plan_rows.get(plan_of.get(row.household_id))
        restaurant = bool(plan) and (plan.monthly_price >= 19900 or "نخبة" in plan.name or "مطاعم" in plan.name)
        bind.execute(
            orders.update()
            .where(orders.c.id == row.id)
            .values(
                service_fee=row.total - row.subtotal - row.delivery_fee,
                # Under the distance rule a fee of 12.50 SAR or more always includes the 2.50 SAR platform margin.
                delivery_margin=250 if row.delivery_fee >= 1250 else 0,
                merchant_fee=int(round(row.subtotal * (0.035 if restaurant else 0.02))),
            )
        )


def upgrade():
    if "pickup_enabled" not in _columns("households"):
        with op.batch_alter_table("households", schema=None) as batch_op:
            batch_op.add_column(sa.Column("pickup_enabled", sa.Boolean(), nullable=False, server_default=sa.true()))

    if not _inspector().has_table("order_chat_messages"):
        op.create_table(
            "order_chat_messages",
            sa.Column("id", sa.String(length=32), nullable=False),
            sa.Column("order_id", sa.String(length=32), nullable=False),
            sa.Column("sender_id", sa.String(length=32), nullable=True),
            sa.Column("sender_role", sa.String(length=20), nullable=False),
            sa.Column("sender_name", sa.String(length=100), nullable=False),
            sa.Column("message_type", sa.String(length=30), nullable=False),
            sa.Column("content", sa.Text(), nullable=False),
            sa.Column("image_url", sa.String(length=255), nullable=True),
            sa.Column("metadata_json", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["order_id"], ["orders.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["sender_id"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
    if "ix_order_chat_messages_order_id" not in _indexes("order_chat_messages"):
        op.create_index("ix_order_chat_messages_order_id", "order_chat_messages", ["order_id"], unique=False)

    existing = _columns("orders")
    with op.batch_alter_table("orders", schema=None) as batch_op:
        for name in ["service_fee", "delivery_margin", "merchant_fee"]:
            if name not in existing:
                batch_op.add_column(sa.Column(name, sa.Integer(), nullable=False, server_default="0"))
    _backfill_order_fees()

    existing = _columns("reviews")
    with op.batch_alter_table("reviews", schema=None) as batch_op:
        if "driver_id" not in existing:
            batch_op.add_column(sa.Column("driver_id", sa.String(length=32), nullable=True))
            batch_op.create_foreign_key("fk_reviews_driver_id_users", "users", ["driver_id"], ["id"])
        if "driver_rating" not in existing:
            batch_op.add_column(sa.Column("driver_rating", sa.Integer(), nullable=True))
        if "driver_comment" not in existing:
            batch_op.add_column(sa.Column("driver_comment", sa.String(length=1000), nullable=False, server_default=""))
        if "photo_url" not in existing:
            batch_op.add_column(sa.Column("photo_url", sa.String(length=128), nullable=True))

    op.create_table(
        "tap_charges",
        sa.Column("id", sa.String(length=80), nullable=False),
        sa.Column("kind", sa.String(length=12), nullable=False),
        sa.Column("target_id", sa.String(length=32), nullable=False),
        sa.Column("amount", sa.Integer(), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("detail", sa.String(length=500), nullable=False),
        sa.Column("refund_id", sa.String(length=80), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("tap_charges", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_tap_charges_status"), ["status"], unique=False)
        batch_op.create_index(batch_op.f("ix_tap_charges_target_id"), ["target_id"], unique=False)


def downgrade():
    with op.batch_alter_table("tap_charges", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_tap_charges_target_id"))
        batch_op.drop_index(batch_op.f("ix_tap_charges_status"))
    op.drop_table("tap_charges")
    with op.batch_alter_table("reviews", schema=None) as batch_op:
        batch_op.drop_constraint("fk_reviews_driver_id_users", type_="foreignkey")
        batch_op.drop_column("photo_url")
        batch_op.drop_column("driver_comment")
        batch_op.drop_column("driver_rating")
        batch_op.drop_column("driver_id")
    with op.batch_alter_table("orders", schema=None) as batch_op:
        batch_op.drop_column("merchant_fee")
        batch_op.drop_column("delivery_margin")
        batch_op.drop_column("service_fee")
    op.drop_index("ix_order_chat_messages_order_id", table_name="order_chat_messages")
    op.drop_table("order_chat_messages")
    with op.batch_alter_table("households", schema=None) as batch_op:
        batch_op.drop_column("pickup_enabled")
