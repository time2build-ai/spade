"""App-wide key/value settings (a tiny store over the `settings` table).

Currently holds `force_bypass`: when on, every spawned agent launches in full
bypass mode (--dangerously-skip-permissions) so it runs unattended without
permission prompts. Defaults to ON."""
from __future__ import annotations

from . import db

# Keys + their defaults when unset.
_DEFAULTS = {"force_bypass": True}


def get_bool(key: str, default: bool | None = None) -> bool:
    if default is None:
        default = bool(_DEFAULTS.get(key, False))
    rows = db.query("SELECT value FROM settings WHERE key = ?", (key,))
    if not rows:
        return default
    return rows[0]["value"] == "1"


def set_bool(key: str, value: bool) -> None:
    db.execute(
        "INSERT INTO settings (key, value) VALUES (?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, "1" if value else "0"),
    )


def force_bypass() -> bool:
    """True when all spawned agents should launch in full bypass mode."""
    return get_bool("force_bypass")


def all_settings() -> dict:
    return {"force_bypass": force_bypass()}
