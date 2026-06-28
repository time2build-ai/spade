"""Feedback domain module — themed clusters of user reports.

A cluster stores a label, a report count, and a source breakdown (JSON array of
{name, n, color}). The verbatim quotes shown in the UI are a later follow-up and
remain client-seeded for now.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone

from tui_pilot import db


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id() -> str:
    return "fc_" + uuid.uuid4().hex[:12]


def _row_to_dict(row) -> dict:
    d = dict(row)
    try:
        d["sources"] = json.loads(d["sources"]) if d.get("sources") else []
    except (TypeError, ValueError):
        d["sources"] = []
    return d


def create(project_id: str, label: str, count: int = 0,
           sources: list[dict] | None = None) -> dict:
    """Insert a feedback cluster and return it (sources decoded)."""
    cid = _new_id()
    db.execute(
        "INSERT INTO feedback_clusters (id, project_id, label, count, sources, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (cid, project_id, label, count, json.dumps(sources or []), _now()),
    )
    return get(cid)


def get(id: str) -> dict | None:
    rows = db.query("SELECT * FROM feedback_clusters WHERE id = ?", (id,))
    return _row_to_dict(rows[0]) if rows else None


def list_for_project(project_id: str) -> list[dict]:
    """All clusters for a project, biggest (highest count) first."""
    rows = db.query(
        "SELECT * FROM feedback_clusters WHERE project_id = ? ORDER BY count DESC, rowid DESC",
        (project_id,),
    )
    return [_row_to_dict(r) for r in rows]
