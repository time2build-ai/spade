"""Seed agent-role presets from roles.yaml into the SQLite `roles` table, and
serve them back in the same shape server.ROLES uses.

The YAML file is the SEED source only; once seeded, the DB is the source of
truth (so roles can be edited via the HTTP layer without touching the file).
"""
from __future__ import annotations

from pathlib import Path

import yaml

from tui_pilot import db

_ROLES_PATH = Path(__file__).resolve().parent.parent / "roles.yaml"


def _load_yaml() -> list[dict]:
    if not _ROLES_PATH.exists():
        return []
    data = yaml.safe_load(_ROLES_PATH.read_text()) or {}
    return data.get("roles", [])


def seed_if_empty() -> None:
    """Populate the `roles` table from roles.yaml iff it is currently empty.

    Idempotent: a second call is a no-op once any row exists.
    """
    existing = db.query("SELECT count(*) AS c FROM roles")[0]["c"]
    if existing:
        return
    with db.tx() as cx:
        for r in _load_yaml():
            rid = r["id"]
            cx.execute(
                "INSERT OR IGNORE INTO roles "
                "(id, label, emoji, mode, cmd, default_model, description, "
                " instructions, is_system) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    rid,
                    r.get("label", rid),
                    r.get("emoji", ""),
                    r.get("mode", "normal"),
                    r.get("cmd", "claude"),
                    r.get("default_model"),
                    r.get("description", ""),
                    r.get("instructions", ""),
                    1 if rid == "orchestrator" else 0,
                ),
            )


_PIPELINE_ROLES = ["developer", "reviewer", "integrator", "documentor"]


def upsert_pipeline_roles() -> None:
    """Idempotently ensure the four pipeline roles exist in the `roles` table.

    `seed_if_empty()` only seeds an empty table, so an already-seeded DB would
    miss `integrator` and `documentor` (added after the foundation seed). This
    INSERT OR IGNOREs each pipeline role from roles.yaml so existing rows are
    preserved and only the missing ones are added.
    """
    by_id = {r["id"]: r for r in _load_yaml()}
    with db.tx() as cx:
        for rid in _PIPELINE_ROLES:
            r = by_id.get(rid)
            if r is None:
                continue
            cx.execute(
                "INSERT OR IGNORE INTO roles "
                "(id, label, emoji, mode, cmd, default_model, description, "
                " instructions, is_system) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    rid,
                    r.get("label", rid),
                    r.get("emoji", ""),
                    r.get("mode", "normal"),
                    r.get("cmd", "claude"),
                    r.get("default_model"),
                    r.get("description", ""),
                    r.get("instructions", ""),
                    0,
                ),
            )


def load_roles_from_db() -> dict[str, dict]:
    """Return all roles keyed by id, in the shape server.ROLES uses."""
    out: dict[str, dict] = {}
    for row in db.query("SELECT * FROM roles"):
        d = dict(row)
        out[d["id"]] = d
    return out
