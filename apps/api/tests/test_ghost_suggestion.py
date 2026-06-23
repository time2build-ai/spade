"""Offline unit tests for screen.strip_ghost_suggestion().

Claude Code's composer shows a dim (SGR 2 "faint") *ghost-text autosuggestion*
in its input line, predicting your likely next prompt. ``capture-pane -p``
strips colour, so that suggestion would render identically to text you actually
typed — making the UI look like a command was auto-entered. We capture with
``-e`` (escape codes preserved) and drop the faint run that sits on the
composer's ❯ prompt line, while keeping every other faint thing on screen.

The byte samples below mirror a real ``tmux capture-pane -e -p`` of the
orchestrator session (faint = ``\\x1b[2m``, bright input = ``\\x1b[38;5;231m``).
"""

from __future__ import annotations

from tui_pilot.screen import strip_ghost_suggestion


def test_drops_faint_suggestion_on_composer_line():
    raw = "\x1b[39m❯ \x1b[2mshow me the backlog\x1b[0m"
    out = strip_ghost_suggestion(raw)
    assert "show me the backlog" not in out
    assert "❯" in out


def test_keeps_real_typed_input_on_composer_line():
    # Real input is rendered bright (256-colour 231), not faint — keep it.
    raw = "\x1b[39m❯ \x1b[38;5;231mWhich projects do we have active?\x1b[39m"
    out = strip_ghost_suggestion(raw)
    assert "Which projects do we have active?" in out


def test_keeps_faint_text_that_is_not_on_the_composer_line():
    # The "+N lines (ctrl+o to expand)" hint is also faint but is real content.
    raw = (
        "\x1b[2m… +16 lines (ctrl+o to expand)\x1b[0m\n"
        "\x1b[39m❯ \x1b[2mshow me the backlog\x1b[0m"
    )
    out = strip_ghost_suggestion(raw)
    assert "+16 lines (ctrl+o to expand)" in out
    assert "show me the backlog" not in out


def test_returns_plain_de_ansi_text():
    raw = "\x1b[38;5;231mHello\x1b[39m \x1b[1mworld\x1b[0m"
    assert strip_ghost_suggestion(raw) == "Hello world"


def test_plain_text_without_escapes_is_unchanged():
    raw = "❯ \njust some plain lines\n  ⏵⏵ bypass permissions on"
    assert strip_ghost_suggestion(raw) == raw
