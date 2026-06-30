# pylint: disable=invalid-name
"""Add schedule recording trigger type.

Revision ID: d2f83f4b1c7a
Revises: 7f6d3739fcd6
Create Date: 2026-06-19 16:30:00.000000

"""
from __future__ import annotations

from enum import Enum

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str | None = "d2f83f4b1c7a"
down_revision: str | None = "7f6d3739fcd6"
branch_labels: str | None = None
depends_on: str | None = None


class OldTriggerTypes(Enum):
    """Old trigger types for recordings."""

    MOTION = "motion"
    OBJECT = "object"
    MANUAL = "manual"


class NewTriggerTypes(Enum):
    """New trigger types for recordings."""

    MOTION = "motion"
    OBJECT = "object"
    MANUAL = "manual"
    SCHEDULE = "schedule"


def upgrade() -> None:
    """Run the upgrade migrations."""
    op.execute("ALTER TYPE triggertypes ADD VALUE IF NOT EXISTS 'SCHEDULE'")


def downgrade() -> None:
    """Run the downgrade migrations."""
    op.execute("DELETE FROM recordings WHERE trigger_type = 'SCHEDULE'")

    new_triggertypes_enum = sa.Enum(NewTriggerTypes, name="tmp_triggertypes")
    new_triggertypes_enum.create(op.get_bind(), checkfirst=False)
    op.execute(
        "ALTER TABLE recordings ALTER COLUMN trigger_type TYPE tmp_triggertypes"
        " USING trigger_type::text::tmp_triggertypes"
    )
    sa.Enum(name="triggertypes").drop(op.get_bind(), checkfirst=False)

    triggertypes_enum = sa.Enum(OldTriggerTypes, name="triggertypes")
    triggertypes_enum.create(op.get_bind(), checkfirst=False)
    op.execute(
        "ALTER TABLE recordings ALTER COLUMN trigger_type TYPE triggertypes"
        " USING trigger_type::text::triggertypes"
    )
    sa.Enum(name="tmp_triggertypes").drop(op.get_bind(), checkfirst=False)
