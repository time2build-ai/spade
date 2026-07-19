"""Harness: signal model + poller + finish/handoff orchestration."""
from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

ACTIONS = {"ask_question", "need_context", "need_help", "progress", "finished"}
BLOCKING = {"ask_question", "need_context", "need_help"}

# Keys that mark an outbox payload as a substantive report — used to salvage a
# finish whose envelope was malformed (see _salvage_finish).
_REPORT_HINTS = ("report", "summary", "evidence", "angles", "findings", "recommendation", "conclusion")

@dataclass
class Signal:
    id: str
    action: str
    text: str = ""
    options: list[str] = field(default_factory=list)
    refs: list[str] = field(default_factory=list)
    report: str = ""
    next: dict | None = None
    ts: str = ""

    @property
    def is_blocking(self) -> bool:
        return self.action in BLOCKING

    @property
    def is_terminal(self) -> bool:
        return self.action == "finished"

def _salvage_finish(data: dict) -> Signal | None:
    """Best-effort recovery of a finish whose signal lacks the strict
    ``{"action": "finished", "report": ...}`` envelope — e.g. an agent that
    emitted just its report JSON (a real failure mode: the deep-research
    investigator whose auto-synthesis crashed wrote a bare
    ``{"summary": ..., "evidence": ...}``). Without this, ``parse_signal``
    rejects it, the poller quarantines it, and the report is silently lost —
    stalling that agent's lifecycle (or a fan-out barrier) forever.

    Only a payload that clearly looks like a substantive report is salvaged;
    anything else returns None and is quarantined as before.
    """
    if not isinstance(data, dict) or data.get("action") in ACTIONS:
        return None
    if not any(k in data for k in _REPORT_HINTS):
        return None
    rep = data.get("report")
    if not isinstance(rep, str):
        # Use an explicit report object if present, else the whole payload
        # (minus envelope keys) as the report body.
        payload = rep if isinstance(rep, (dict, list)) else {
            k: v for k, v in data.items() if k not in ("id", "ts", "action")
        }
        try:
            rep = json.dumps(payload)
        except (TypeError, ValueError):
            return None
    if not rep.strip():
        return None
    return Signal(id=data.get("id", ""), action="finished", report=rep, ts=data.get("ts", ""))


def parse_signal(data: dict) -> Signal:
    action = data.get("action")
    if action not in ACTIONS:
        raise ValueError(f"unknown action {action!r}")
    return Signal(
        id=data.get("id", ""),
        action=action,
        text=data.get("text", ""),
        options=list(data.get("options") or []),
        refs=list(data.get("refs") or []),
        report=data.get("report", ""),
        next=data.get("next"),
        ts=data.get("ts", ""),
    )

@dataclass
class HarnessState:
    kind: str                      # "idle" | "blocked" | "done" | "exited"
    open_signal: Signal | None = None
    report: str = ""

class HarnessPoller:
    """Per-session: scans outbox, derives state, orchestrates finish/handoff.

    on_handoff(next_dict, report) is called by the server to spawn a successor
    when a finished signal carries next.start == "auto" (or after a UI confirm).

    Not internally synchronized: the server serializes ``poll()``, ``answer()``,
    and ``confirm_handoff()`` for a given session under that session's lock.
    ``confirm_handoff()`` is additionally double-fire safe.
    """
    def __init__(self, agent_id, session, hub, cwd: str | None = None,
                 on_handoff: Callable | None = None):
        self.agent_id = agent_id
        self.session = session
        self.hub = hub
        self.cwd = cwd                     # where to write SUMMARY.md
        self.on_handoff = on_handoff
        self.open_signal: Signal | None = None
        self.timeline: list[Signal] = []
        self.done_report: str = ""
        self.pending_handoff: dict | None = None

    def poll(self) -> HarnessState:
        alive = self.session.is_alive()
        for data in self.hub.scan(self.agent_id):
            try:
                sig = parse_signal(data)
            except ValueError:
                # Not a valid signal — try to salvage a report-shaped payload as
                # a finish (so a malformed finish isn't silently dropped, which
                # would hang the lifecycle/fan-out barrier); else quarantine it.
                sig = _salvage_finish(data)
                if sig is None:
                    self.hub.mark_processed(self.agent_id, data.get("id", ""))
                    continue
            self._handle(sig)
        if self.done_report:
            return HarnessState("done", report=self.done_report)
        # A dead agent beats a stale open_signal: if the session died while a
        # blocking signal was open, report it as exited (spec §8 "agent dies
        # mid-block") rather than leaving a permanent 🔴 for a gone agent.
        if not alive:
            return HarnessState("exited")
        if self.open_signal:
            return HarnessState("blocked", open_signal=self.open_signal)
        return HarnessState("idle")

    def _handle(self, sig: Signal) -> None:
        if sig.action == "progress":
            self.timeline.append(sig)
            self.hub.mark_processed(self.agent_id, sig.id)
        elif sig.is_blocking:
            self.open_signal = sig          # at most one at a time (spec §3.5)
        elif sig.is_terminal:
            self._finish(sig)

    def _finish(self, sig: Signal) -> None:
        ts = time.strftime("%Y%m%d-%H%M%S")
        self.done_report = sig.report or "(no report)"
        # 1. write SUMMARY.md into the project cwd (overwrite, like plan.md)
        if self.cwd:
            (Path(self.cwd) / "SUMMARY.md").write_text(self.done_report)
        # 2. archive a copy into the hub's handoffs/
        self.hub.archive_report(self.agent_id, self.done_report, ts)
        self.hub.mark_processed(self.agent_id, sig.id)
        # 3. handoff: auto fires now; confirm waits for confirm_handoff()
        nxt = sig.next
        if nxt and nxt.get("start") == "auto" and self.on_handoff:
            self.on_handoff(nxt, self.done_report)
        elif nxt:
            self.pending_handoff = nxt      # waits for UI confirm

    def confirm_handoff(self) -> bool:
        """Spawn the pending (start:"confirm") successor. Returns True if fired."""
        nxt, self.pending_handoff = self.pending_handoff, None
        if nxt and self.on_handoff:
            self.on_handoff(nxt, self.done_report)
            return True
        return False

    def answer(self, signal_id: str, text: str) -> bool:
        """The pluggable 'answerer' seam: a human (v1) or a PM agent (future)
        calls this to reply. The reply is typed into the agent via tmux.

        Returns True if the answer landed (it matched the open blocking signal),
        False if there was no matching open signal (stale/duplicate answer) — so
        the caller can tell a real reply from a dropped one (spec §8).
        """
        if self.open_signal and self.open_signal.id == signal_id:
            self.session.send_text(text)
            self.hub.write_inbox(self.agent_id, signal_id, {"answer": text})
            self.hub.mark_processed(self.agent_id, signal_id)
            self.open_signal = None
            return True
        return False
