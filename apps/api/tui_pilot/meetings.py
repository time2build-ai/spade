"""Meetings domain module — ingested meeting records.

A meeting stores a title, date, summary, attendee list, and (when ingested from a
transcript) the raw `transcript` plus the `source` it came from. attendees is
persisted as a JSON-encoded array.

`ingest` is the demo's headline path: it takes a transcript (a canned sample, or
text from a connected notes tool), records the meeting, and spins each action item
into a backlog task grounded back to the meeting. Extraction is deterministic —
see `extract_action_items` — so the demo is reproducible and costs no tokens.
"""

from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone

from tui_pilot import db, meeting_samples, tasks


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
           summary: str | None = None, attendees: list[str] | None = None,
           transcript: str | None = None, source: str | None = None) -> dict:
    """Insert a meeting and return the created row (attendees decoded)."""
    mid = _new_id()
    db.execute(
        "INSERT INTO meetings "
        "(id, project_id, title, date, summary, attendees, transcript, source, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (mid, project_id, title, date, summary, json.dumps(attendees or []),
         transcript, source, _now()),
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


# -- ingest: transcript → backlog -------------------------------------------

# Drop a leading "Speaker:" label so the kept quote reads as plain speech.
_SPEAKER_RE = re.compile(r"^[A-Z][\w .'-]{0,30}:\s*")


def extract_action_items(transcript: str) -> list[dict]:
    """Pull action items out of a transcript. Any line with an arrow (``→``) is
    an action: the text after the arrow becomes the task title, and the speech
    before it is kept as the grounding quote. ``→!`` marks a high-priority item.

    Deterministic — no model call — so the demo is reproducible and free. Returns
    a list of {"title", "quote", "priority"} in transcript order.
    """
    items: list[dict] = []
    for raw in (transcript or "").splitlines():
        line = raw.strip()
        if "→" not in line:
            continue
        before, _, after = line.partition("→")
        after = after.strip()
        high = after.startswith("!")
        title = after.lstrip("!").strip().rstrip(".")
        if not title:
            continue
        quote = _SPEAKER_RE.sub("", before.strip()).strip() or None
        items.append({"title": title, "quote": quote, "priority": 1 if high else 2})
    return items


def ingest(project_id: str, *, sample: str | None = None, title: str | None = None,
           date: str | None = None, summary: str | None = None,
           attendees: list[str] | None = None, transcript: str | None = None,
           source: str | None = None) -> dict:
    """Ingest a meeting and turn its action items into backlog tasks.

    Provide either ``sample`` (a key in `meeting_samples.SAMPLES`) or an explicit
    ``transcript`` (with ``title``). Sample fields fill any gaps left by explicit
    args. Records the meeting, then creates one 'ready' task per extracted action
    item, grounded back to the meeting (origin_source = meeting title,
    origin_quote = what was said). Returns {"meeting", "tasks"}.
    """
    if sample is not None:
        s = meeting_samples.get(sample)
        if s is None:
            raise ValueError(f"unknown meeting sample {sample!r}")
        title = title or s["title"]
        date = date or s.get("date")
        summary = summary or s.get("summary")
        attendees = attendees if attendees is not None else s.get("attendees")
        transcript = transcript or s.get("transcript")
        source = source or s.get("source")
    if not title:
        raise ValueError("ingest requires a sample or an explicit title")
    if not transcript:
        raise ValueError("ingest requires a sample or an explicit transcript")

    mtg = create(project_id, title=title, date=date, summary=summary,
                 attendees=attendees, transcript=transcript, source=source)
    created = [
        tasks.create(
            project_id=project_id, title=item["title"], priority=item["priority"],
            origin_quote=item["quote"], origin_source=title,
        )
        for item in extract_action_items(transcript)
    ]
    return {"meeting": mtg, "tasks": created}
