"""Chat domain module — persisted /ask threads + messages.

A thread groups messages for a project. Each message carries a role/who/text plus
an optional `payload` (JSON) holding structured tool output — citation lists,
plan cards, ADR-EDIT action cards. Adding a message bumps the thread's updated_at.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone

from tui_pilot import db


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _tid() -> str:
    return "th_" + uuid.uuid4().hex[:12]


def _mid() -> str:
    return "msg_" + uuid.uuid4().hex[:12]


# -- threads ------------------------------------------------------------------

def create_thread(project_id: str, title: str | None = None, pinned: bool = False) -> dict:
    tid = _tid()
    now = _now()
    db.execute(
        "INSERT INTO chat_threads (id, project_id, title, pinned, updated_at, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (tid, project_id, title, 1 if pinned else 0, now, now),
    )
    return get_thread(tid)


def get_thread(id: str) -> dict | None:
    rows = db.query("SELECT * FROM chat_threads WHERE id = ?", (id,))
    return dict(rows[0]) if rows else None


def list_threads(project_id: str) -> list[dict]:
    """Threads for a project: pinned first, then most-recently-updated."""
    rows = db.query(
        "SELECT * FROM chat_threads WHERE project_id = ? "
        "ORDER BY pinned DESC, updated_at DESC, rowid DESC",
        (project_id,),
    )
    return [dict(r) for r in rows]


# -- messages -----------------------------------------------------------------

def _msg_row(row) -> dict:
    d = dict(row)
    try:
        d["payload"] = json.loads(d["payload"]) if d.get("payload") else None
    except (TypeError, ValueError):
        d["payload"] = None
    return d


def add_message(thread_id: str, role: str, text: str, who: str | None = None,
                payload: dict | None = None) -> dict:
    mid = _mid()
    now = _now()
    with db.tx() as cx:
        cx.execute(
            "INSERT INTO chat_messages (id, thread_id, role, who, text, payload, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (mid, thread_id, role, who, text, json.dumps(payload) if payload else None, now),
        )
        # Bump the thread's updated_at so it floats to the top of the list.
        cx.execute("UPDATE chat_threads SET updated_at = ? WHERE id = ?", (now, thread_id))
    rows = db.query("SELECT * FROM chat_messages WHERE id = ?", (mid,))
    return _msg_row(rows[0])


def list_messages(thread_id: str) -> list[dict]:
    """Messages for a thread in chronological order (payload JSON-decoded)."""
    rows = db.query(
        "SELECT * FROM chat_messages WHERE thread_id = ? ORDER BY created_at ASC, rowid ASC",
        (thread_id,),
    )
    return [_msg_row(r) for r in rows]
