"""Offline unit tests for screen.normalize() and screen.classify().

These run against the committed fixtures in ``fixtures/`` — no live TUI is
needed, so the suite is CI-safe and deterministic. If the target TUI changes,
re-capture fixtures with ``python -m tui_pilot.cli dump`` and re-tune
``patterns.yaml`` until these pass again.
"""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from tui_pilot.screen import State, classify, normalize

ROOT = Path(__file__).resolve().parent.parent
FIXTURES = ROOT / "fixtures"
PATTERNS = yaml.safe_load((ROOT / "patterns.yaml").read_text())


def _fixture(name: str) -> str:
    return (FIXTURES / f"{name}.txt").read_text()


# Each fixture and the State classify() must return for it.
EXPECTED = {
    "booting": State.BOOTING,
    "idle": State.IDLE,
    "thinking": State.THINKING,
    "streaming": State.STREAMING,
    "permission": State.AWAITING_PERMISSION,
    "error": State.ERROR,
    "exited": State.EXITED,
    "response_idle": State.IDLE,
}


@pytest.mark.parametrize("name,expected", list(EXPECTED.items()))
def test_classify_fixture(name: str, expected: State) -> None:
    screen = _fixture(name)
    assert classify(screen, PATTERNS) == expected


# ---- normalize() behaviour ------------------------------------------------


def test_normalize_strips_spinner_so_thinking_frames_hash_equal() -> None:
    """The whole point of normalize(): spinner-only differences collapse.

    Two thinking frames differing only by the animated spinner glyph must
    normalize to the same string, otherwise wait_for_settle() never settles.
    """
    frame_a = "✳ Fiddle-faddling…\n\n❯ \n  esc to interrupt"
    frame_b = "✻ Fiddle-faddling…\n\n❯ \n  esc to interrupt"
    assert normalize(frame_a) == normalize(frame_b)
    assert frame_a != frame_b  # they really are different before normalizing


def test_normalize_strips_elapsed_timer() -> None:
    a = "✻ Brewed for 1s"
    b = "✻ Brewed for 9s"
    assert normalize(a) == normalize(b)


def test_normalize_strips_braille_spinner() -> None:
    a = "⠋ Working"
    b = "⠹ Working"
    assert normalize(a) == normalize(b)


def test_normalize_collapses_blank_runs_and_trailing_ws() -> None:
    raw = "line one   \n\n\n\nline two\n\n\n"
    assert normalize(raw) == "line one\n\nline two"


def test_normalize_preserves_prompt_marker() -> None:
    """❯ (U+276F) lives inside the dingbats block but must NOT be stripped."""
    assert "❯" in normalize("❯ hello")


def test_normalize_preserves_output_bullet() -> None:
    """⏺ (U+23FA) is the output marker; it must survive normalization."""
    assert "⏺" in normalize("⏺ pong")


# ---- classify() ordering / robustness -------------------------------------


def test_permission_beats_idle_when_both_present() -> None:
    """A permission dialog above an idle composer must win."""
    screen = (
        "Do you want to proceed?\n"
        " 1. Yes\n 2. No\n\n"
        "❯ \n  ? for shortcuts\n"
    )
    assert classify(screen, PATTERNS) == State.AWAITING_PERMISSION


def test_active_footer_beats_idle_footer() -> None:
    """During a turn the idle footer text is still present; active must win."""
    screen = "❯ do something\n\n✳ Thinking…\n  ⏵⏵ auto mode on · esc to interrupt"
    assert classify(screen, PATTERNS) == State.THINKING


def test_empty_screen_is_booting() -> None:
    assert classify("", PATTERNS) == State.BOOTING
    assert classify("   \n  \n", PATTERNS) == State.BOOTING


def test_classify_accepts_missing_patterns_gracefully() -> None:
    """A half-filled patterns dict must not throw — it just under-matches."""
    assert classify("anything", {}) == State.BOOTING
