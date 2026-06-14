"""Orchestration signals + executor.

The orchestrator is a normal harness agent with an extended action vocabulary.
It writes these JSON files to its outbox; an OrchestrationExecutor (callback-
injected, so it is testable without tmux/FastAPI) interprets them."""
from __future__ import annotations

from dataclasses import dataclass

from .models import within_ceiling

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

@dataclass
class Policy:
    ceiling: str = "sonnet"
    autopilot: bool = False

@dataclass
class Result:
    kind: str                 # "spawned" | "answered" | "killed" | "narrated" | "brake" | "noop"
    worker: str | None = None
    brake: str | None = None  # "opus_spawn" when kind == "brake"
    detail: str = ""

# callbacks expected: spawn(**kw)->worker_id, answer_worker(worker,text)->bool,
# approve_worker(worker)->bool, deny_worker(worker)->bool, kill(worker)->bool,
# narrate(text)->None, worker_state(worker)->str
# (answer_worker resolves the worker's open-signal id internally, so the executor
#  does NOT need a separate worker_open_signal_id callback.)
# Callbacks are only invoked in the poll loop's DRAIN phase or an endpoint handler
# (no session lock held by the caller), so each may take its own single target lock.

class OrchestrationExecutor:
    def __init__(self, callbacks, policy: Policy):
        self.cb = callbacks
        self.policy = policy

    def run(self, sig) -> Result:
        if sig.action == "spawn":
            return self._spawn(sig)
        if sig.action == "answer":
            return self._answer(sig)
        if sig.action == "kill":
            ok = self.cb.kill(sig.worker)
            return Result("killed" if ok else "noop", worker=sig.worker)
        if sig.action == "status":
            self.cb.narrate(sig.text)
            return Result("narrated", detail=sig.text)
        return Result("noop")

    def _spawn(self, sig) -> Result:
        # Opus / above-ceiling spawn is a brake in supervised mode.
        if not within_ceiling(sig.model, self.policy.ceiling) and not self.policy.autopilot:
            return Result("brake", brake="opus_spawn",
                          detail=f"requested {sig.model} (ceiling {self.policy.ceiling}): {sig.reason}")
        worker = self.cb.spawn(role=sig.role, model=sig.model, task=sig.task,
                               cwd=sig.cwd, mode=sig.mode, mission=sig.mission, reason=sig.reason)
        return Result("spawned", worker=worker)

    def _answer(self, sig) -> Result:
        # Choose resolution path by the worker's CURRENT state:
        # a permission dialog (AWAITING_PERMISSION) → approve/deny; else → mailbox answer.
        state = self.cb.worker_state(sig.worker)
        if state == "AWAITING_PERMISSION":
            txt = sig.text.strip().lower()
            if txt in ("deny", "no", "reject"):
                self.cb.deny_worker(sig.worker)
            else:
                self.cb.approve_worker(sig.worker)
            return Result("answered", worker=sig.worker)
        ok = self.cb.answer_worker(sig.worker, sig.text)
        if not ok:
            self.cb.narrate(f"answer to {sig.worker} did not land (no open question)")
        return Result("answered" if ok else "noop", worker=sig.worker)
