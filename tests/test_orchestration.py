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
