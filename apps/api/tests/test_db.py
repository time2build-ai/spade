import os
from pathlib import Path

import pytest

from tui_pilot import db

def test_home_defaults_to_dot_spade(monkeypatch):
    monkeypatch.delenv("TUI_PILOT_HOME", raising=False)
    assert db.home() == Path.home() / ".spade"

def test_home_honors_env(monkeypatch, tmp_path):
    monkeypatch.setenv("TUI_PILOT_HOME", str(tmp_path))
    assert db.home() == tmp_path
    assert db.db_path() == tmp_path / "tui-pilot.db"

def test_connect_creates_schema(monkeypatch, tmp_path):
    monkeypatch.setenv("TUI_PILOT_HOME", str(tmp_path))
    db.reset()
    conn = db.get_conn()
    tables = {r["name"] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"accounts", "projects", "project_accounts",
            "roles", "sessions", "missions", "app_state"} <= tables

def test_foreign_keys_enabled(monkeypatch, tmp_path):
    monkeypatch.setenv("TUI_PILOT_HOME", str(tmp_path))
    db.reset()
    assert db.get_conn().execute("PRAGMA foreign_keys").fetchone()[0] == 1

def test_nested_tx_inner_commit_does_not_persist_when_outer_rolls_back():
    """A nested (inner) tx that succeeds must NOT commit on its own; if the
    outer tx later raises, the whole logical transaction rolls back."""
    with pytest.raises(RuntimeError):
        with db.tx() as cx:
            cx.execute(
                "INSERT INTO accounts (id, label, config_dir) VALUES (?, ?, ?)",
                ("a1", "Acct One", "/cfg/a1"),
            )
            # Inner tx succeeds (exits cleanly) but must not commit early.
            with db.tx() as cx2:
                cx2.execute(
                    "INSERT INTO accounts (id, label, config_dir) VALUES (?, ?, ?)",
                    ("a2", "Acct Two", "/cfg/a2"),
                )
            # Outer fails after the inner block exited successfully.
            raise RuntimeError("boom")
    # Nothing should have persisted: no partial commit from the inner tx.
    rows = db.query("SELECT id FROM accounts")
    assert rows == []


def test_migrate_remaps_legacy_task_statuses():
    """Deferred legacy migration: a pre-existing 'in_progress'/'review' row (from
    the retired pipeline write path) is remapped to 'building'/'pr_review'."""
    from tui_pilot import projects, tasks
    projects.create(id="acme", name="Acme", path="/w")
    ip = tasks.create(project_id="acme", title="A")["id"]
    rv = tasks.create(project_id="acme", title="B")["id"]
    conn = db.get_conn()
    # Stamp the legacy statuses directly (they are no longer in tasks.STATUSES,
    # so tasks.move would reject them).
    conn.execute("UPDATE tasks SET status = 'in_progress' WHERE id = ?", (ip,))
    conn.execute("UPDATE tasks SET status = 'review' WHERE id = ?", (rv,))
    conn.commit()

    db._migrate(conn)  # idempotent remap

    assert tasks.get(ip)["status"] == "building"
    assert tasks.get(rv)["status"] == "pr_review"
    # Idempotent: a second run is a harmless no-op.
    db._migrate(conn)
    assert tasks.get(ip)["status"] == "building"
