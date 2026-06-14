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
