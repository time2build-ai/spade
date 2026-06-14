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

from tui_pilot.harness import HarnessPoller, HarnessState
from tui_pilot.comms import Hub
import json

class _FakeSession:
    """Stand-in for TmuxSession: alive + records typed text."""
    def __init__(self, alive=True): self._alive = alive; self.sent = []
    def is_alive(self): return self._alive
    def send_text(self, t): self.sent.append(t)

def _emit(hub, aid, payload):
    (hub.agent_dir(aid) / "outbox" / f"{payload['id']}.json").write_text(json.dumps(payload))

def test_poller_surfaces_blocking_signal(tmp_path):
    hub = Hub(tmp_path); aid = "dev-1-a"; sess = _FakeSession()
    poller = HarnessPoller(aid, sess, hub)
    _emit(hub, aid, {"id": "s1", "action": "ask_question", "text": "PG?"})
    state = poller.poll()
    assert state.kind == "blocked"
    assert state.open_signal.action == "ask_question"

def test_answer_types_via_tmux_and_clears_block(tmp_path):
    hub = Hub(tmp_path); aid = "dev-1-a"; sess = _FakeSession()
    poller = HarnessPoller(aid, sess, hub)
    _emit(hub, aid, {"id": "s1", "action": "ask_question", "text": "PG?"})
    poller.poll()
    poller.answer("s1", "Postgres")
    assert sess.sent == ["Postgres"]                 # typed into agent
    assert poller.poll().kind != "blocked"           # block cleared

def test_progress_is_recorded_not_blocking(tmp_path):
    hub = Hub(tmp_path); aid = "dev-1-a"; sess = _FakeSession()
    poller = HarnessPoller(aid, sess, hub)
    _emit(hub, aid, {"id": "p1", "action": "progress", "text": "2/5"})
    state = poller.poll()
    assert state.kind != "blocked"
    assert poller.timeline[-1].text == "2/5"

def test_finished_writes_summary_and_archives_and_handoffs(tmp_path):
    hub = Hub(tmp_path); aid = "dev-1-a"; sess = _FakeSession()
    cwd = tmp_path / "proj"; cwd.mkdir()
    (cwd / "SUMMARY.md").write_text("OLD")          # must be overwritten
    spawned = []
    poller = HarnessPoller(aid, sess, hub, cwd=str(cwd),
                           on_handoff=lambda nxt, rpt: spawned.append((nxt, rpt)))
    _emit(hub, aid, {"id": "f1", "action": "finished", "report": "# Done\nok",
                     "next": {"role": "developer", "task": "Implement plan.md", "start": "auto"}})
    state = poller.poll()
    assert state.kind == "done"
    assert state.report.startswith("# Done")
    assert (cwd / "SUMMARY.md").read_text() == "# Done\nok"        # overwritten in cwd
    assert list((hub.agent_dir(aid) / "handoffs").glob("*.md"))    # archived copy
    assert spawned and spawned[0][0]["role"] == "developer"        # auto handoff fired
    assert spawned[0][1].startswith("# Done")                      # report passed to handoff

def test_finished_confirm_handoff_is_pending_not_fired(tmp_path):
    hub = Hub(tmp_path); aid = "dev-1-a"; sess = _FakeSession()
    cwd = tmp_path / "proj"; cwd.mkdir()
    spawned = []
    poller = HarnessPoller(aid, sess, hub, cwd=str(cwd),
                           on_handoff=lambda nxt, rpt: spawned.append(nxt))
    _emit(hub, aid, {"id": "f1", "action": "finished", "report": "# Done",
                     "next": {"role": "developer", "task": "x", "start": "confirm"}})
    poller.poll()
    assert spawned == []                            # not auto-fired
    assert poller.pending_handoff["role"] == "developer"
    fired = poller.confirm_handoff()                # explicit confirm spawns it
    assert fired is True and spawned and spawned[0]["role"] == "developer"

def test_dead_agent_reports_exited(tmp_path):
    hub = Hub(tmp_path); poller = HarnessPoller("d", _FakeSession(alive=False), hub, cwd="/tmp")
    assert poller.poll().kind == "exited"

def test_finish_in_same_interval_as_death_is_captured(tmp_path):
    hub = Hub(tmp_path); aid = "dev-1-a"; sess = _FakeSession(alive=False)
    cwd = tmp_path / "proj"; cwd.mkdir()
    poller = HarnessPoller(aid, sess, hub, cwd=str(cwd))
    _emit(hub, aid, {"id": "f1", "action": "finished", "report": "# Done\nok"})
    state = poller.poll()
    assert state.kind == "done"                       # finish wins over exited
    assert (cwd / "SUMMARY.md").read_text() == "# Done\nok"
