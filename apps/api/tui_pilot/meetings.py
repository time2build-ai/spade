"""Meetings domain module — ingested meeting records.

A meeting stores a title, date, summary and attendee list. The richer extracted
artifacts (outcomes, transcript highlights) are a later follow-up; for now those
remain client-seeded. attendees is persisted as a JSON-encoded array.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone

from tui_pilot import db


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id() -> str:
    return "mtg_" + uuid.uuid4().hex[:12]


def _row_to_dict(row) -> dict:
    d = dict(row)
    # Decode the attendees JSON array (defensive: tolerate null / bad JSON).
    try:
        d["attendees"] = json.loads(d["attendees"]) if d.get("attendees") else []
    except (TypeError, ValueError):
        d["attendees"] = []
    return d


def create(project_id: str, title: str, date: str | None = None,
           summary: str | None = None, attendees: list[str] | None = None) -> dict:
    """Insert a meeting and return the created row (attendees decoded)."""
    mid = _new_id()
    db.execute(
        "INSERT INTO meetings (id, project_id, title, date, summary, attendees, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (mid, project_id, title, date, summary, json.dumps(attendees or []), _now()),
    )
    return get(mid)


def get(id: str) -> dict | None:
    rows = db.query("SELECT * FROM meetings WHERE id = ?", (id,))
    return _row_to_dict(rows[0]) if rows else None


def list_for_project(project_id: str) -> list[dict]:
    """All meetings for a project, newest first (by date, then insert order)."""
    rows = db.query(
        "SELECT * FROM meetings WHERE project_id = ? ORDER BY date DESC, rowid DESC",
        (project_id,),
    )
    return [_row_to_dict(r) for r in rows]
