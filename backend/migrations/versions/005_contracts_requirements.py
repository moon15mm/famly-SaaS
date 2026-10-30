"""Versioned contracts with acceptance records, required document types and document expiry."""

from alembic import op
import sqlalchemy as sa

revision = "005_contracts"
down_revision = "004_driver_tracking"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "document_requirements",
        sa.Column("id", sa.String(length=50), nullable=False),
        sa.Column("role", sa.String(length=16), nullable=False),
        sa.Column("title", sa.String(length=100), nullable=False),
        sa.Column("description", sa.String(length=500), nullable=False),
        sa.Column("required", sa.Boolean(), nullable=False),
        sa.Column("needs_expiry", sa.Boolean(), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("document_requirements", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_document_requirements_role"), ["role"], unique=False)

    op.create_table(
        "contract_versions",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("role", sa.String(length=16), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=150), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("body_hash", sa.String(length=64), nullable=False),
        sa.Column("published_at", sa.DateTime(), nullable=False),
        sa.Column("published_by", sa.String(length=32), nullable=True),
        sa.ForeignKeyConstraint(
            ["published_by"],
            ["users.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("role", "version"),
    )
    with op.batch_alter_table("contract_versions", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_contract_versions_role"), ["role"], unique=False)

    op.create_table(
        "contract_acceptances",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("user_id", sa.String(length=32), nullable=False),
        sa.Column("contract_id", sa.String(length=32), nullable=False),
        sa.Column("full_name", sa.String(length=100), nullable=False),
        sa.Column("accepted_at", sa.DateTime(), nullable=False),
        sa.Column("ip", sa.String(length=64), nullable=False),
        sa.Column("user_agent", sa.String(length=200), nullable=False),
        sa.ForeignKeyConstraint(
            ["contract_id"],
            ["contract_versions.id"],
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "contract_id"),
    )
    with op.batch_alter_table("contract_acceptances", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_contract_acceptances_user_id"), ["user_id"], unique=False)

    with op.batch_alter_table("verification_documents", schema=None) as batch_op:
        batch_op.add_column(sa.Column("requirement_id", sa.String(length=50), nullable=True))
        batch_op.add_column(sa.Column("expires_on", sa.Date(), nullable=True))
        batch_op.create_index(batch_op.f("ix_verification_documents_requirement_id"), ["requirement_id"], unique=False)
        batch_op.create_foreign_key(
            "fk_verification_documents_requirement_id_document_requirements",
            "document_requirements",
            ["requirement_id"],
            ["id"],
        )


def downgrade():
    with op.batch_alter_table("verification_documents", schema=None) as batch_op:
        batch_op.drop_constraint("fk_verification_documents_requirement_id_document_requirements", type_="foreignkey")
        batch_op.drop_index(batch_op.f("ix_verification_documents_requirement_id"))
        batch_op.drop_column("expires_on")
        batch_op.drop_column("requirement_id")
    with op.batch_alter_table("contract_acceptances", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_contract_acceptances_user_id"))
    op.drop_table("contract_acceptances")
    with op.batch_alter_table("contract_versions", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_contract_versions_role"))
    op.drop_table("contract_versions")
    with op.batch_alter_table("document_requirements", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_document_requirements_role"))
    op.drop_table("document_requirements")
