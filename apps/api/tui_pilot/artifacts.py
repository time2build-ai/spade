"""Artifacts domain module — documents pinned to a task.

An artifact is a durable pointer to a document living in the repo (``spec`` /
``plan`` / ``test_guide`` / ``review_report``): a ``repo_path`` on a ``branch``.
The lifecycle engine registers artifacts as agents produce them, then re-points
them to the promotion branch on merge (so the drawer keeps resolving after the
feature branch and worktree are gone).
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from tui_pilot import db


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row_to_dict(row) -> dict | None:
    return dict(row) if row is not None else None


def register(task_id: str, run_id: str | None, kind: str, title: str | None,
             repo_path: str, branch: str, by: str | None = None) -> dict:
    """Pin a document to a task and return the created row."""
    aid = str(uuid.uuid4())
    db.execute(
        "INSERT INTO artifacts "
        "(id, task_id, run_id, kind, title, repo_path, branch, created_by, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (aid, task_id, run_id, kind, title, repo_path, branch, by, _now()),
    )
    return get(aid)


def get(artifact_id: str) -> dict | None:
    rows = db.query("SELECT * FROM artifacts WHERE id = ?", (artifact_id,))
    return _row_to_dict(rows[0]) if rows else None


def for_task(task_id: str) -> list[dict]:
    """Return all artifacts pinned to a task, oldest first."""
    rows = db.query(
        "SELECT * FROM artifacts WHERE task_id = ? ORDER BY created_at ASC, rowid ASC",
        (task_id,),
    )
    return [dict(r) for r in rows]


def repoint_to_branch(task_id: str, branch: str) -> None:
    """Re-point every artifact of a task to ``branch`` (called on merge)."""
    db.execute("UPDATE artifacts SET branch = ? WHERE task_id = ?", (branch, task_id))
