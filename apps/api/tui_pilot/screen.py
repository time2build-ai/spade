"""Pure, testable screen interpretation.

No tmux, no I/O. Everything here operates on captured strings so it can be
unit-tested against saved fixtures with no live TUI.

Two responsibilities:

* :func:`normalize` — strip the things that change without meaning (spinner
  glyphs, elapsed-time counters, trailing/blank whitespace) so two screens that
  are "the same" hash equal.
* :func:`classify` — a regex-driven state machine, reading its patterns from
  ``patterns.yaml``, that maps a screen to a :class:`State`.
"""

from __future__ import annotations

import re
from enum import Enum


class State(str, Enum):
    """The lifecycle states we can infer from the rendered screen."""

    BOOTING = "BOOTING"
    IDLE = "IDLE"
    THINKING = "THINKING"
    STREAMING = "STREAMING"
    AWAITING_PERMISSION = "AWAITING_PERMISSION"
    AWAITING_INPUT = "AWAITING_INPUT"
    ERROR = "ERROR"
    EXITED = "EXITED"


# Spinner glyph blocks that animate per-frame and must be stripped so two
# "same" frames hash equal:
#   * Braille block U+2800–U+28FF (classic spinner)
#   * Dingbat star/asterisk sub-range U+2722–U+273F — the Claude Code REPL
#     cycles these (✳ U+2733, ✻ U+273B, ✽ U+273D, ✶ U+2736, ✢ U+2722, …).
#     We deliberately do NOT strip the whole dingbats block, because that
#     would also eat the prompt marker ❯ (U+276F) and other meaningful glyphs.
_BRAILLE = "⠀-⣿"
_DINGBATS = "✢-✿"
_ASCII_SPINNERS = r"|/\-\\"
_SPINNER_CHARS_RE = re.compile(f"[{_BRAILLE}{_DINGBATS}]")
# Elapsed-time counters that increment while a turn runs:
#   "(12s)", "· 4s", "(1m 3s)", and Claude's "Brewed for 1s" / "for 12s" form.
_TIMER_RE = re.compile(
    r"\(\s*\d+\s*s\s*\)|·\s*\d+\s*s|\(\s*\d+m\s*\d+s\s*\)|\bfor\s+\d+(\.\d+)?s\b"
)
# A bare "(123 tokens · esc to interrupt)" style token count also drifts.
_TOKENS_RE = re.compile(r"\d+(\.\d+)?[km]?\s*tokens", re.IGNORECASE)


def normalize(screen: str) -> str:
    """Canonicalise a captured screen so equivalent frames hash equal.

    Removes:
    * braille spinner glyphs (the per-frame animation),
    * elapsed-time counters like ``(12s)`` / ``· 4s``,
    * drifting token counters like ``1.2k tokens``,
    * trailing whitespace on each line,
    * runs of blank lines (collapsed to a single blank line) and
      leading/trailing blank lines.

    The ASCII spinner characters (``|/-\\``) are intentionally *not* blanket
    stripped because they are common punctuation; instead we only collapse a
    lone spinner char surrounded by whitespace (a spinner cell), leaving real
    text untouched.
    """
    # Drop braille spinner glyphs entirely.
    screen = _SPINNER_CHARS_RE.sub("", screen)
    # Drop elapsed-time and token counters (these animate while thinking).
    screen = _TIMER_RE.sub("", screen)
    screen = _TOKENS_RE.sub("tokens", screen)

    out_lines: list[str] = []
    for line in screen.splitlines():
        # Collapse a lone ASCII spinner cell (whitespace-bounded |,/,-,\).
        line = re.sub(rf"(?<=\s)[{_ASCII_SPINNERS}](?=\s)", " ", line)
        out_lines.append(line.rstrip())

    # Collapse runs of blank lines to a single blank line.
    collapsed: list[str] = []
    blank = False
    for line in out_lines:
        if line == "":
            if not blank:
                collapsed.append("")
            blank = True
        else:
            collapsed.append(line)
            blank = False

    # Trim leading/trailing blank lines.
    while collapsed and collapsed[0] == "":
        collapsed.pop(0)
    while collapsed and collapsed[-1] == "":
        collapsed.pop()

    return "\n".join(collapsed)


# --- composer ghost-text autosuggestion --------------------------------------
# Claude Code's composer renders a dim (SGR 2 "faint") ghost-text suggestion in
# its input line, predicting your likely next prompt. `capture-pane -p` strips
# colour, so the suggestion would render identically to text you actually typed.
# Given a colour-preserving capture (`capture-pane -e`), we drop the faint run
# that sits on the composer's ❯ prompt line — and ONLY there, since the same
# faint attribute is used for legitimate content elsewhere (the "+N lines
# (ctrl+o to expand)" hint, welcome-box borders, …) — then de-ANSI the rest so
# the result matches the plain screen the UI expects.
_PROMPT_MARKER = "❯"
_SGR_RE = re.compile(r"\x1b\[[0-9;]*m")
# A faint run = the SGR-2 code plus the (non-escape) text it styles, up to the
# next escape sequence. On the composer line that text is exactly the ghost
# suggestion; real input on that line is bright, so it is left intact.
_FAINT_RUN_RE = re.compile(r"\x1b\[2m[^\x1b]*")


def strip_ghost_suggestion(raw_ansi: str) -> str:
    """Render a colour-preserving pane capture to plain text, dropping Claude's
    composer ghost-text autosuggestion.

    Input is a ``tmux capture-pane -e`` string (ANSI escapes preserved). The
    faint run on the ❯ composer line is removed; every other faint span is kept.
    All remaining ANSI is then stripped, yielding the same plain screen as
    ``capture-pane -p`` minus the suggestion.
    """
    out_lines: list[str] = []
    for line in raw_ansi.splitlines():
        if _PROMPT_MARKER in line:
            line = _FAINT_RUN_RE.sub("", line)
        out_lines.append(_SGR_RE.sub("", line))
    return "\n".join(out_lines)


def _search(patterns: dict, key: str, text: str) -> bool:
    """Return True if the named regex from ``patterns`` matches ``text``.

    Missing or empty patterns never match (so a half-filled patterns.yaml
    degrades gracefully rather than throwing).
    """
    pat = patterns.get(key)
    if not pat:
        return False
    return re.search(pat, text, re.MULTILINE | re.IGNORECASE) is not None


def classify(screen: str, patterns: dict) -> State:
    """Map a rendered screen to a :class:`State` using regexes from config.

    Match order matters and is the heart of the inference. We resolve in this
    priority:

    1. **EXITED** — the program is gone / a shell prompt is showing.
    2. **AWAITING_PERMISSION** — a dialog is blocking the turn. Checked before
       everything else so an idle-looking composer at the bottom cannot mask
       the dialog above it.
    3. **ERROR** — an API/fatal error is displayed.
    4. **active turn** — the footer shows the interrupt hint (``esc to
       interrupt``). Within an active turn we split:
         * **STREAMING** if an output bullet (``⏺``) is already on screen, i.e.
           the model is writing its answer;
         * **THINKING** otherwise (spinner + gerund status, no output yet).
       Both are non-terminal; the distinction is informational. We check the
       active footer *before* IDLE because the idle footer text (e.g. "auto
       mode on") is still present during a turn.
    5. **IDLE** — a ready composer with a resting footer.
    6. **AWAITING_INPUT** — a non-permission prompt waiting on free text.
    7. **BOOTING** — the catch-all when the UI is not yet recognisable.
    """
    norm = normalize(screen)

    # 1. Exited.
    if _search(patterns, "exited_regex", norm):
        return State.EXITED

    # 2 & 3. Blocking / exceptional states first.
    if _search(patterns, "permission_regex", norm):
        return State.AWAITING_PERMISSION
    if _search(patterns, "error_regex", norm):
        return State.ERROR

    # 4. Active turn (interrupt hint in the footer).
    if _search(patterns, "active_regex", norm):
        # Streaming if output is already being written, else thinking.
        if _search(patterns, "streaming_regex", norm):
            return State.STREAMING
        return State.THINKING

    # 5 & 6. Resting states.
    if _search(patterns, "idle_regex", norm):
        return State.IDLE
    if _search(patterns, "awaiting_input_regex", norm):
        return State.AWAITING_INPUT

    # 7. Booting last: explicit signature, else the unknown-UI fallback. We
    # default to BOOTING (not IDLE) so callers keep waiting rather than
    # declaring a turn complete against an unrecognised screen.
    if _search(patterns, "booting_regex", norm):
        return State.BOOTING
    return State.BOOTING


# An interactive selection menu: numbered options, one marked by the ❯ cursor,
# e.g. Claude's clarifying-question menu or a permission dialog.
_MENU_OPT_RE = re.compile(r"^\s*(❯)?\s*(\d+)\.\s+(.*\S)\s*$")


def parse_menu(screen: str) -> dict | None:
    """Detect an active selection menu in the rendered screen.

    Returns ``{"prompt": str, "options": [{"index": int, "label": str}, ...],
    "selected": int}`` (selected is the 1-based number the ❯ cursor is on), or
    ``None`` when there is no active menu.

    The discriminator is a ``❯`` cursor sitting on a numbered option line — that
    only happens for an interactive menu. A plain numbered list (no cursor) or
    the idle composer (a lone ``❯`` prompt with no number) is NOT a menu.
    """
    lines = screen.splitlines()
    options: list[dict] = []
    selected: int | None = None
    first_opt: int | None = None
    for i, line in enumerate(lines):
        m = _MENU_OPT_RE.match(line)
        if not m:
            continue
        idx = int(m.group(2))
        options.append({"index": idx, "label": m.group(3).strip()})
        if m.group(1):  # the ❯ cursor
            selected = idx
        if first_opt is None:
            first_opt = i
    if len(options) < 2 or selected is None:
        return None
    # prompt = nearest non-empty, non-option, non-chrome line above the options
    prompt = ""
    for j in range(first_opt - 1, -1, -1):
        s = lines[j].strip()
        if not s or _MENU_OPT_RE.match(lines[j]):
            continue
        if set(s) <= set("─-│╭╮╰╯ "):  # divider / box chrome
            continue
        prompt = s
        break
    return {"prompt": prompt, "options": options, "selected": selected}
