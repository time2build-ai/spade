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


def register(task_id: str, run_id: str | None, kind: str, title: str | None = None,
             repo_path: str | None = None, branch: str | None = None,
             by: str | None = None, content: str | None = None) -> dict:
    """Pin a document to a task and return the created row.

    Two flavours: a repo-path pointer (``repo_path`` on a ``branch`` — code specs/
    plans/reports resolved via git) OR an INLINE document (``content`` with a null
    ``repo_path``/``branch`` — research findings/reports and docs, which never live
    in a repo). Both ``repo_path`` and ``branch`` default to None so inline callers
    write ``register(task_id, run_id, kind="finding", content=...)``.
    """
    aid = str(uuid.uuid4())
    db.execute(
        "INSERT INTO artifacts "
        "(id, task_id, run_id, kind, title, repo_path, branch, content, "
        " created_by, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (aid, task_id, run_id, kind, title, repo_path, branch, content, by, _now()),
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
    """Re-point every repo-path artifact of a task to ``branch`` (called on merge).

    Inline-content artifacts have no branch to re-point and are left untouched — a
    code task's merge must not stamp a branch onto an inline research/docs
    deliverable. The guard is ``content IS NULL`` (an inline artifact always has
    ``content`` set), NOT ``repo_path IS NOT NULL``: V2 code artifacts can
    legitimately carry a null ``repo_path`` (an agent report omitting the path)
    and must still be re-pointed on merge — so keying on ``repo_path`` would
    silently regress the code path (see test_merge_approve_ships).
    """
    db.execute(
        "UPDATE artifacts SET branch = ? WHERE task_id = ? AND content IS NULL",
        (branch, task_id),
    )
