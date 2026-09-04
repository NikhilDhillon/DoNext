"""Return existing course work to the known state so activation can be answered for real.

The `d3f7a2c65b81` migration backfills every existing task as activated, because deactivating a
student's whole schedule during an upgrade would be worse than leaving it as it was. That is the
right default for a real user and the wrong one for a database built before activation existed:
nothing has anything left to ask about, so every assignment keeps being placed as though its
handout were already in hand.

This clears `activated_at` for tasks that came from a course, leaving work the student entered
themselves untouched. Blocks already sitting in an accepted schedule are left alone; regenerating
is what drops the work, and re-activating from the intake surface is what brings it back.

    .venv/bin/python apps/api/scripts/reset_activation.py            # report only
    .venv/bin/python apps/api/scripts/reset_activation.py --apply    # make the change
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from sqlalchemy import create_engine, func, select, update
from sqlalchemy.orm import Session

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from donext.config import get_settings  # noqa: E402
from donext.models import AcademicItem, Task  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Write the change. Without it the script only reports what it would do.",
    )
    parser.add_argument(
        "--email",
        help="Limit the reset to one user's work. Omit to cover every user in the database.",
    )
    args = parser.parse_args()

    engine = create_engine(get_settings().database_url)
    with Session(engine) as session:
        # Course work is anything carrying an academic item. A task without one was typed out by
        # the student, which is itself the activation, so it keeps what it has.
        query = (
            select(
                AcademicItem.item_type,
                func.count().label("total"),
            )
            .join(Task, Task.academic_item_id == AcademicItem.id)
            .where(Task.activated_at.is_not(None))
            .group_by(AcademicItem.item_type)
            .order_by(AcademicItem.item_type)
        )
        if args.email:
            from donext.models import User

            user_id = session.scalar(select(User.id).where(User.email == args.email))
            if user_id is None:
                print(f"No user with email {args.email}.")
                return 1
            query = query.where(Task.user_id == user_id)

        rows = session.execute(query).all()
        if not rows:
            print("No activated course work found. Nothing to reset.")
            return 0

        total = sum(row.total for row in rows)
        print(f"Activated course work that would return to the known state ({total} tasks):")
        for row in rows:
            print(f"  {row.item_type.value:<12} {row.total}")

        if not args.apply:
            print("\nReport only. Re-run with --apply to make the change.")
            return 0

        academic_task_ids = select(Task.id).join(
            AcademicItem, Task.academic_item_id == AcademicItem.id
        )
        if args.email:
            academic_task_ids = academic_task_ids.where(Task.user_id == user_id)
        changed = session.execute(
            update(Task)
            .where(Task.id.in_(academic_task_ids), Task.activated_at.is_not(None))
            .values(activated_at=None)
        ).rowcount
        session.commit()
        print(f"\nReset {changed} tasks. Regenerate your plan to see what is left.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
