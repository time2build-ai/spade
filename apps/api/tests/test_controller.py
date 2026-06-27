"""Offline unit tests for controller.clean_response().

These operate on hand-built capture strings — no live TUI / tmux — so they stay
CI-safe and deterministic.
"""

from __future__ import annotations

from tui_pilot.controller import clean_response


def test_clean_response_extracts_answer_block():
    raw = "\n".join(
        [
            "❯ What is this project?",
            "",
            "⏺ Hello Spade is a tiny proof-of-concept.",
            "  It exposes greet(name).",
            "",
            "────────────────────────────────────────",
            "❯",
            "────────────────────────────────────────",
            "  ? for shortcuts",
        ]
    )
    out = clean_response(raw, prompt_text="What is this project?")
    assert "Hello Spade is a tiny proof-of-concept." in out
    assert "It exposes greet(name)." in out
    assert "? for shortcuts" not in out


def test_clean_response_strips_tmux_banner():
    # Claude Code prints this tmux hint when running inside tmux; it must never
    # leak into the response body (it rendered as a stray black code box).
    raw = "\n".join(
        [
            "❯ What is this project?",
            "",
            "⏺ Hello Spade is the active project.",
            "",
            "tmux detected · scroll with PgUp/PgDn · or add 'set -g mouse on' "
            "to ~/.tmux.conf for wheel scroll",
            "",
            "────────────────────────────────────────",
            "❯",
        ]
    )
    out = clean_response(raw, prompt_text="What is this project?")
    assert "Hello Spade is the active project." in out
    assert "tmux detected" not in out
    assert "PgUp/PgDn" not in out
    assert "set -g mouse" not in out


def test_clean_response_strips_wrapped_tmux_banner():
    # The banner can wrap across pane lines — each fragment must be dropped.
    raw = "\n".join(
        [
            "❯ ping",
            "",
            "⏺ pong",
            "tmux detected · scroll with PgUp/PgDn · or add",
            "'set -g mouse on' to ~/.tmux.conf for wheel scroll",
            "────────────────────────────────────────",
        ]
    )
    out = clean_response(raw, prompt_text="ping")
    assert out.strip() == "pong"
