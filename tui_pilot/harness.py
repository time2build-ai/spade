"""Harness: signal model + poller + finish/handoff orchestration."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

ACTIONS = {"ask_question", "need_context", "need_help", "progress", "finished"}
BLOCKING = {"ask_question", "need_context", "need_help"}

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
        if not self.session.is_alive():
            return HarnessState("exited")
        for data in self.hub.scan(self.agent_id):
            try:
                sig = parse_signal(data)
            except ValueError:
                self.hub.mark_processed(self.agent_id, data.get("id", ""))
                continue
            self._handle(sig)
        if self.done_report:
            return HarnessState("done", report=self.done_report)
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
        import time
        from pathlib import Path
        ts = time.strftime("%Y%m%d-%H%M%S")
        self.done_report = sig.report or "(no report)"
        # 1. write SUMMARY.md into the project cwd (overwrite, like plan.md)
        if self.cwd:
            (Path(self.cwd) / "SUMMARY.md").write_text(self.done_report)
        # 2. archive a copy into the hub's handoffs/
        self.hub.archive_report(self.agent_id, self.done_report, ts)
        self.hub.mark_processed(self.agent_id, sig.id)
        # 3. handoff: auto fires now; confirm waits for confirm_handoff()
        nxt = sig.next or None
        if nxt and nxt.get("start") == "auto" and self.on_handoff:
            self.on_handoff(nxt, self.done_report)
        elif nxt:
            self.pending_handoff = nxt      # waits for UI confirm

    def confirm_handoff(self) -> bool:
        """Spawn the pending (start:"confirm") successor. Returns True if fired."""
        if self.pending_handoff and self.on_handoff:
            self.on_handoff(self.pending_handoff, self.done_report)
            self.pending_handoff = None
            return True
        return False

    def answer(self, signal_id: str, text: str) -> None:
        """The pluggable 'answerer' seam: a human (v1) or a PM agent (future)
        calls this to reply. The reply is typed into the agent via tmux."""
        if self.open_signal and self.open_signal.id == signal_id:
            self.session.send_text(text)
            self.hub.write_inbox(self.agent_id, signal_id, {"answer": text})
            self.hub.mark_processed(self.agent_id, signal_id)
            self.open_signal = None
