"""Harness: signal model + poller + finish/handoff orchestration."""
from __future__ import annotations

from dataclasses import dataclass, field

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
