import pytest
from tui_pilot.harness import parse_signal, ACTIONS, BLOCKING

def test_parse_valid_ask_question():
    s = parse_signal({"id": "s1", "action": "ask_question",
                      "text": "PG or MySQL?", "options": ["pg", "mysql"]})
    assert s.action == "ask_question"
    assert s.is_blocking is True
    assert s.options == ["pg", "mysql"]

def test_progress_is_non_blocking():
    assert parse_signal({"id": "s2", "action": "progress", "text": "2/5"}).is_blocking is False

def test_finished_carries_report_and_optional_next():
    s = parse_signal({"id": "s3", "action": "finished", "report": "# Done",
                      "next": {"role": "developer", "task": "Implement plan.md"}})
    assert s.report.startswith("# Done")
    assert s.next["role"] == "developer"
    assert s.is_terminal is True

def test_unknown_action_raises():
    with pytest.raises(ValueError):
        parse_signal({"id": "s4", "action": "explode"})

def test_blocking_set_matches_spec():
    assert BLOCKING == {"ask_question", "need_context", "need_help"}
    assert "finished" in ACTIONS
