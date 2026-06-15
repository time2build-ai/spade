"""Accounts domain module.

An "account" wraps a CLAUDE_CONFIG_DIR. tui-pilot manages account dirs under
db.home()/agents/<provider>/<id>/. Users can also import existing ~/.claude-* dirs.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from tui_pilot import db


# -- helpers ------------------------------------------------------------------

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row_to_dict(row) -> dict | None:
    return dict(row) if row is not None else None


# -- CRUD ---------------------------------------------------------------------

def create(
    id: str,
    label: str,
    config_dir: str,
    color: str | None = None,
    provider: str = "claude-code",
) -> dict:
    """Insert a new account and return the created row as a dict."""
    db.execute(
        "INSERT INTO accounts (id, label, config_dir, color, provider, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (id, label, config_dir, color, provider, _now()),
    )
    return get(id)


def get(id: str) -> dict | None:
    """Return one account by id, or None if not found."""
    rows = db.query("SELECT * FROM accounts WHERE id = ?", (id,))
    return _row_to_dict(rows[0]) if rows else None


def list_all() -> list[dict]:
    """Return all accounts ordered by created_at ascending."""
    rows = db.query("SELECT * FROM accounts ORDER BY created_at ASC, rowid ASC")
    return [dict(r) for r in rows]


def set_default(id: str) -> None:
    """Set account `id` as the sole default (clears all others first).

    Raises ValueError if `id` does not exist; the transaction rolls back so a
    previously-set default is never silently lost.
    """
    with db.tx() as cx:
        cx.execute("UPDATE accounts SET is_default = 0")
        cur = cx.execute("UPDATE accounts SET is_default = 1 WHERE id = ?", (id,))
        if cur.rowcount == 0:
            raise ValueError(f"no account {id!r}")


def default_account() -> dict | None:
    """Return the account with is_default=1, or None."""
    rows = db.query("SELECT * FROM accounts WHERE is_default = 1")
    return _row_to_dict(rows[0]) if rows else None


# -- Discovery ----------------------------------------------------------------

def provider_dir(provider: str = "claude-code") -> Path:
    """Return the managed accounts base dir: db.home()/agents/<provider>."""
    return db.home() / "agents" / provider


def scan_managed(provider: str = "claude-code") -> list[str]:
    """Return names of child directories under provider_dir()."""
    base = provider_dir(provider)
    if not base.exists():
        return []
    return [p.name for p in base.iterdir() if p.is_dir()]


def _user_home() -> Path:
    """Wrapped so tests can monkeypatch."""
    return Path.home()


def scan_importable() -> list[str]:
    """Return absolute paths of ~/.claude* dirs in the user home."""
    return [str(p) for p in _user_home().glob(".claude*") if p.is_dir()]


def auth_status(config_dir: str) -> str:
    """Return 'authed' if the config dir holds real credentials, else 'not_logged_in'.

    Content-aware (not mere file existence): both `.credentials.json` and
    `.claude.json` can exist for config-only reasons without the user being
    logged in. We treat:
      * `.credentials.json` as authed only when it parses to a non-empty JSON
        object (dict with >=1 key) or a non-empty array — i.e. not {}/null/[]
        /empty-string/parse-error;
      * `.claude.json` as authed only when it is a JSON object with a non-empty
        `oauthAccount` or `apiKey`.
    Any parse error / missing file → not_logged_in.
    """
    d = Path(config_dir)

    creds = _load_json(d / ".credentials.json")
    if isinstance(creds, dict) and len(creds) > 0:
        return "authed"
    if isinstance(creds, list) and len(creds) > 0:
        return "authed"

    data = _load_json(d / ".claude.json")
    if isinstance(data, dict) and (data.get("oauthAccount") or data.get("apiKey")):
        return "authed"
    return "not_logged_in"


def _load_json(path: Path):
    """Parse a JSON file defensively; return None on any error / missing file."""
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return None


# -- Managed creation & import ------------------------------------------------

def create_managed(
    id: str,
    label: str,
    color: str | None = None,
    provider: str = "claude-code",
) -> dict:
    """Create a managed account dir and register it."""
    target = provider_dir(provider) / id
    target.mkdir(parents=True, exist_ok=True)
    return create(id, label, config_dir=str(target), color=color, provider=provider)


def import_existing(
    id: str,
    label: str,
    config_dir: str,
    color: str | None = None,
    provider: str = "claude-code",
) -> dict:
    """Register an existing config dir as an account (does NOT move/copy the dir)."""
    return create(id, label, config_dir=config_dir, color=color, provider=provider)
