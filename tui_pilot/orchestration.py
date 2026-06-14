"""Orchestration signals + executor.

The orchestrator is a normal harness agent with an extended action vocabulary.
It writes these JSON files to its outbox; an OrchestrationExecutor (callback-
injected, so it is testable without tmux/FastAPI) interprets them."""
from __future__ import annotations

from dataclasses import dataclass

ORCH_ACTIONS = {"spawn", "answer", "kill", "status"}

@dataclass
class OrchestrationSignal:
    id: str
    action: str
    role: str | None = None
    model: str | None = None
    task: str = ""
    cwd: str | None = None
    mode: str | None = None
    mission: str | None = None
    reason: str = ""
    worker: str | None = None
    text: str = ""

def parse_orchestration_signal(data: dict) -> OrchestrationSignal:
    action = data.get("action")
    if action not in ORCH_ACTIONS:
        raise ValueError(f"unknown orchestration action {action!r}")
    return OrchestrationSignal(
        id=data.get("id", ""), action=action,
        role=data.get("role"), model=data.get("model"), task=data.get("task", ""),
        cwd=data.get("cwd"), mode=data.get("mode"), mission=data.get("mission"),
        reason=data.get("reason", ""), worker=data.get("worker"), text=data.get("text", ""),
    )
