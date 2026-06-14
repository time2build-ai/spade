"""Opt-in live integration tests — actually spawn the TUI.

These are SKIPPED by default (they need a working, authenticated `claude` on
PATH and they cost a real round-trip). Enable with::

    TUI_PILOT_LIVE=1 .venv/bin/pytest tests/test_integration.py -v

Override the target command with ``TUI_PILOT_CMD`` (default: ``claude``).
"""

from __future__ import annotations

import os
import time
import uuid

import pytest

from tui_pilot.controller import Controller
from tui_pilot.screen import State
from tui_pilot.session import TmuxSession

LIVE = os.environ.get("TUI_PILOT_LIVE") == "1"
CMD = os.environ.get("TUI_PILOT_CMD", "claude")

pytestmark = pytest.mark.skipif(
    not LIVE, reason="set TUI_PILOT_LIVE=1 to run live integration tests"
)


@pytest.fixture()
def controller():
    name = f"pilot-it-{uuid.uuid4().hex[:8]}"
    sess = TmuxSession(name, CMD, cols=120, rows=40)
    sess.spawn()
    ctrl = Controller(sess)
    try:
        ctrl.wait_for_settle(timeout=30)
        yield ctrl
    finally:
        sess.kill()


def test_boots_to_idle(controller: Controller) -> None:
    assert controller.state() == State.IDLE


def test_prompt_round_trip(controller: Controller) -> None:
    result = controller.prompt("Reply with exactly one word: pong", timeout=90)
    assert result["state"] == State.IDLE
    assert "pong" in result["response"].lower()


def test_interrupt_stops_a_long_turn(controller: Controller) -> None:
    controller.session.send_text(
        "Write a detailed 500-word essay about the history of typography."
    )
    time.sleep(2.5)
    assert controller.state() in (State.THINKING, State.STREAMING)
    controller.interrupt()
    _, state = controller.wait_for_turn_end(timeout=30)
    assert state in (State.IDLE, State.AWAITING_INPUT)


# --- harness round-trip (real agent emits a mailbox signal) ----------------


def test_harness_round_trip(tmp_path) -> None:
    """A real agent: emits ask_question via the comms skill → control center
    surfaces it → we answer via tmux → agent continues → emits finished with a
    report → report captured + SUMMARY.md written.

    This is the end-to-end proof that the whole harness works against a live
    `claude` (skill install + priming + mailbox + poller + answer + finish).
    """
    from fastapi.testclient import TestClient

    from tui_pilot import server
    from tui_pilot.comms import Hub

    # Isolate the hub so the test doesn't touch the real ~/.tui-pilot.
    server.HUB = Hub(tmp_path / "comms")
    cwd = str(tmp_path / "proj")
    os.makedirs(cwd)
    client = TestClient(server.app)

    aid = client.post(
        "/sessions",
        json={
            "name": "it",
            "role": "developer",
            "mode": "auto",
            "cwd": cwd,
            "task": (
                'Emit exactly ONE ask_question signal asking "Which DB: pg or '
                'sqlite?" with options [pg, sqlite] via the agent-comms skill, '
                "then stop and wait. After I answer, emit a finished signal whose "
                "report records the choice."
            ),
        },
    ).json()
    aid = aid["id"]
    try:
        # 1. a blocking ask_question signal appears in the mailbox
        sig = None
        for _ in range(60):
            sigs = client.get(f"/sessions/{aid}/signals").json()["signals"]
            if sigs:
                sig = sigs[0]
                break
            time.sleep(1)
        assert sig is not None, "agent never emitted a signal to its outbox"
        assert sig["action"] == "ask_question"

        # 2. answer it (typed into the agent via tmux)
        assert (
            client.post(
                f"/sessions/{aid}/answer",
                json={"signal_id": sig["id"], "text": "pg"},
            ).status_code
            == 200
        )

        # 3. the agent finishes; its report is captured and SUMMARY.md written
        done = False
        for _ in range(60):
            if client.get(f"/sessions/{aid}").json()["harness_state"] == "done":
                done = True
                break
            time.sleep(1)
        assert done, "agent did not reach a finished state"
        assert client.get(f"/sessions/{aid}/report").status_code == 200
        assert (tmp_path / "proj" / "SUMMARY.md").exists()
    finally:
        client.delete(f"/sessions/{aid}")
