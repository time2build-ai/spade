"""File mailbox hub. Pure filesystem I/O — no tmux, no FastAPI.

Layout:  <root>/<agent-id>/{outbox,inbox,handoffs,processed}/
Signals are JSON files in outbox/. scan() reads new ones; malformed files are
quarantined to processed/ so the poller never crashes. mark_processed() moves a
handled signal to processed/ for idempotency.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

DEFAULT_ROOT = Path.home() / ".tui-pilot" / "comms"
_SUBDIRS = ("outbox", "inbox", "handoffs", "processed")

class Hub:
    def __init__(self, root: Path | str | None = None) -> None:
        self.root = Path(root) if root else DEFAULT_ROOT

    def agent_dir(self, agent_id: str) -> Path:
        base = self.root / agent_id
        for sub in _SUBDIRS:
            (base / sub).mkdir(parents=True, exist_ok=True)
        return base

    def scan(self, agent_id: str) -> list[dict]:
        outbox = self.agent_dir(agent_id) / "outbox"
        signals: list[dict] = []
        for f in sorted(outbox.glob("*.json")):
            try:
                data = json.loads(f.read_text())
                data.setdefault("id", f.stem)
                signals.append(data)
            except (json.JSONDecodeError, OSError):
                # quarantine bad file so we don't re-read it forever
                self._quarantine(agent_id, f)
        return signals

    def mark_processed(self, agent_id: str, signal_id: str) -> None:
        base = self.agent_dir(agent_id)
        src = base / "outbox" / f"{signal_id}.json"
        if src.exists():
            dst = base / "processed" / f"{signal_id}.json"
            os.replace(src, dst)

    def write_inbox(self, agent_id: str, signal_id: str, payload: dict) -> None:
        dst = self.agent_dir(agent_id) / "inbox" / f"{signal_id}.json"
        dst.write_text(json.dumps(payload, indent=2))

    def archive_report(self, agent_id: str, report: str, ts: str) -> str:
        dst = self.agent_dir(agent_id) / "handoffs" / f"{agent_id}-{ts}.md"
        dst.write_text(report)
        return str(dst)

    def _quarantine(self, agent_id: str, f: Path) -> None:
        dst = self.agent_dir(agent_id) / "processed" / f.name
        try:
            os.replace(f, dst)
        except OSError:
            pass
