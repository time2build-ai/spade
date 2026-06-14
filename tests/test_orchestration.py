import pytest
from tui_pilot.orchestration import parse_orchestration_signal, ORCH_ACTIONS, OrchestrationSignal

def test_parse_spawn():
    s = parse_orchestration_signal({"action": "spawn", "role": "developer",
        "model": "sonnet", "task": "Implement plan.md", "mission": "m1",
        "reason": "standard markup"})
    assert s.action == "spawn" and s.model == "sonnet" and s.mission == "m1"
    assert s.role == "developer" and s.reason == "standard markup"

def test_parse_answer_kill_status():
    assert parse_orchestration_signal({"action": "answer", "worker": "w1", "text": "pg"}).worker == "w1"
    assert parse_orchestration_signal({"action": "kill", "worker": "w1"}).worker == "w1"
    assert parse_orchestration_signal({"action": "status", "text": "halfway"}).text == "halfway"

def test_is_orchestration_action():
    assert ORCH_ACTIONS == {"spawn", "answer", "kill", "status"}

def test_unknown_action_raises():
    with pytest.raises(ValueError):
        parse_orchestration_signal({"action": "nuke"})

from tui_pilot.orchestration import OrchestrationExecutor, Policy

class _Spy:
    def __init__(self): self.calls = []
    def spawn(self, **kw): self.calls.append(("spawn", kw)); return "newworker-id"
    def answer_worker(self, worker, text): self.calls.append(("answer", worker, text)); return True
    def approve_worker(self, worker): self.calls.append(("approve", worker)); return True
    def deny_worker(self, worker): self.calls.append(("deny", worker)); return True
    def kill(self, worker): self.calls.append(("kill", worker)); return True
    def narrate(self, text): self.calls.append(("narrate", text))
    def worker_state(self, worker): return self._state          # injected per test

def _exec(policy=None):
    spy = _Spy(); spy._state = "IDLE"
    return OrchestrationExecutor(spy, policy or Policy(ceiling="sonnet", autopilot=False)), spy

def test_spawn_within_ceiling_executes():
    ex, spy = _exec()
    r = ex.run(parse_orchestration_signal({"action":"spawn","role":"developer","model":"sonnet","task":"x"}))
    assert r.kind == "spawned" and r.worker == "newworker-id"
    assert spy.calls[0][0] == "spawn"
    assert spy.calls[0][1]["model"] == "sonnet"

def test_spawn_above_ceiling_supervised_is_braked():
    ex, spy = _exec(Policy(ceiling="sonnet", autopilot=False))
    r = ex.run(parse_orchestration_signal({"action":"spawn","model":"opus","task":"hard","reason":"gnarly"}))
    assert r.kind == "brake" and r.brake == "opus_spawn"
    assert spy.calls == []

def test_spawn_above_ceiling_autopilot_proceeds():
    ex, spy = _exec(Policy(ceiling="sonnet", autopilot=True))
    r = ex.run(parse_orchestration_signal({"action":"spawn","model":"opus","task":"hard"}))
    assert r.kind == "spawned"
    assert spy.calls[0][1]["model"] == "opus"

def test_answer_routes_to_mailbox_when_worker_blocked():
    ex, spy = _exec(); spy._state = "AWAITING_INPUT"
    r = ex.run(parse_orchestration_signal({"action":"answer","worker":"w1","text":"pg"}))
    assert ("answer", "w1", "pg") in spy.calls and r.kind == "answered"

def test_answer_approve_routes_to_approve_when_permission_dialog():
    ex, spy = _exec(); spy._state = "AWAITING_PERMISSION"
    ex.run(parse_orchestration_signal({"action":"answer","worker":"w1","text":"approve"}))
    assert ("approve", "w1") in spy.calls

def test_answer_deny_routes_to_deny_when_permission_dialog():
    ex, spy = _exec(); spy._state = "AWAITING_PERMISSION"
    ex.run(parse_orchestration_signal({"action":"answer","worker":"w1","text":"deny"}))
    assert ("deny", "w1") in spy.calls

def test_answer_noop_narrates_warning():
    ex, spy = _exec(); spy._state = "IDLE"
    spy.answer_worker = lambda worker, text: (spy.calls.append(("answer",worker,text)), False)[1]
    r = ex.run(parse_orchestration_signal({"action":"answer","worker":"w1","text":"hi"}))
    assert r.kind == "noop"
    assert any(c[0] == "narrate" for c in spy.calls)   # §10: warn when it didn't land

def test_kill_and_status():
    ex, spy = _exec()
    ex.run(parse_orchestration_signal({"action":"kill","worker":"w1"}))
    ex.run(parse_orchestration_signal({"action":"status","text":"hi"}))
    assert ("kill","w1") in spy.calls and ("narrate","hi") in spy.calls
