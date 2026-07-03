"""Per-project git/GitHub config (repo url + promotion branch names)."""
from __future__ import annotations

from datetime import datetime, timezone

from tui_pilot import db

_WRITABLE = {"repo_ssh_url", "dev_branch", "staging_branch", "prod_branch", "worktrees_root"}
_DEFAULTS = {"dev_branch": "development", "staging_branch": "staging", "prod_branch": "main"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _default_worktrees_root(project_id: str) -> str:
    # Honor TUI_PILOT_HOME like the rest of the codebase (db.home()).
    return str(db.home() / "worktrees" / project_id)


def get(project_id: str) -> dict | None:
    rows = db.query("SELECT * FROM project_git WHERE project_id = ?", (project_id,))
    return dict(rows[0]) if rows else None


def upsert(project_id: str, **fields) -> dict:
    bad = set(fields) - _WRITABLE
    if bad:
        raise ValueError(f"non-writable columns: {sorted(bad)}")
    existing = get(project_id)
    with db.tx() as cx:
        if existing is None:
            root = fields.get("worktrees_root") or _default_worktrees_root(project_id)
            cx.execute(
                "INSERT INTO project_git "
                "(project_id, repo_ssh_url, dev_branch, staging_branch, prod_branch, "
                " worktrees_root, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (project_id, fields.get("repo_ssh_url"),
                 fields.get("dev_branch", _DEFAULTS["dev_branch"]),
                 fields.get("staging_branch", _DEFAULTS["staging_branch"]),
                 fields.get("prod_branch", _DEFAULTS["prod_branch"]),
                 root, _now()),
            )
        elif fields:
            set_clause = ", ".join(f"{c} = ?" for c in fields)
            cx.execute(
                f"UPDATE project_git SET {set_clause} WHERE project_id = ?",
                tuple(fields.values()) + (project_id,),
            )
    return get(project_id)
