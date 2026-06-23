"""Controller: synchronization + the high-level round-trip API.

This is where the *hard 90%* lives — inferring program state from the rendered
screen and knowing when a turn has settled. The controller owns:

* a :class:`~tui_pilot.session.TmuxSession` (the mechanics),
* the loaded ``patterns.yaml`` (the tunable signatures),
* the quiescence loop that decides when the screen has stopped changing,
* the high-level :meth:`prompt` / :meth:`approve` / :meth:`deny` / :meth:`interrupt`.
"""

from __future__ import annotations

import hashlib
import re
import time
from pathlib import Path

import yaml

from .screen import State, classify, normalize
from .session import TmuxSession

_DEFAULT_PATTERNS = Path(__file__).resolve().parent.parent / "patterns.yaml"


def load_patterns(path: str | Path | None = None) -> dict:
    """Load the pattern config from ``patterns.yaml`` (or a given path)."""
    p = Path(path) if path else _DEFAULT_PATTERNS
    with open(p, "r", encoding="utf-8") as fh:
        data = yaml.safe_load(fh) or {}
    return data


def _sha1(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()


class Controller:
    """High-level driver over a single TUI session."""

    def __init__(
        self,
        session: TmuxSession,
        patterns: dict | None = None,
        patterns_path: str | Path | None = None,
    ) -> None:
        self.session = session
        self.patterns = patterns if patterns is not None else load_patterns(patterns_path)

    # -- state -------------------------------------------------------------

    def state(self) -> State:
        """Classify the current visible screen."""
        if not self.session.is_alive():
            return State.EXITED
        return classify(self.session.capture(), self.patterns)

    # -- synchronization ---------------------------------------------------

    def wait_for_settle(
        self,
        settle_polls: int = 4,
        poll: float = 0.25,
        timeout: float = 120,
    ) -> str:
        """Block until the normalized screen stops changing, then return raw.

        The trap this solves: while THINKING the spinner animates every frame,
        so a naive hash of the raw screen never stabilises. We hash the
        *normalized* screen, so "thinking" registers as stable-content-plus-
        spinner rather than as motion.

        Returns the last raw (un-normalized) capture once it has been stable
        for ``settle_polls`` consecutive polls.
        """
        prev_hash: str | None = None
        stable = 0
        deadline = _now() + timeout
        last_raw = ""
        while _now() < deadline:
            if not self.session.is_alive():
                return last_raw
            last_raw = self.session.capture()
            h = _sha1(normalize(last_raw))
            if h == prev_hash:
                stable += 1
            else:
                stable = 0
                prev_hash = h
            if stable >= settle_polls:
                return last_raw
            time.sleep(poll)
        return last_raw

    def wait_until(
        self,
        target: State,
        timeout: float = 120,
        poll: float = 0.25,
    ) -> None:
        """Block until :meth:`state` equals ``target`` or raise on timeout."""
        deadline = _now() + timeout
        while _now() < deadline:
            if self.state() == target:
                return
            time.sleep(poll)
        raise TimeoutError(
            f"timed out after {timeout}s waiting for state {target.value}; "
            f"last state was {self.state().value}"
        )

    # -- high level --------------------------------------------------------

    # States that mean "the turn is over, stop waiting".
    _TERMINAL = frozenset(
        {
            State.IDLE,
            State.AWAITING_PERMISSION,
            State.AWAITING_INPUT,
            State.ERROR,
            State.EXITED,
        }
    )
    # States that mean "still working, keep waiting".
    _ACTIVE = frozenset({State.THINKING, State.STREAMING, State.BOOTING})

    def wait_for_turn_end(
        self,
        settle_polls: int = 4,
        poll: float = 0.25,
        timeout: float = 180,
    ) -> tuple[str, State]:
        """Block until the screen has settled into a *terminal* state.

        This wraps :meth:`wait_for_settle` in an outer loop. The trap it closes:
        while THINKING, the only thing animating is the spinner — which
        :func:`normalize` strips — so the content can hash-stable while the turn
        is still running, and a lone ``wait_for_settle`` would return early in a
        THINKING state. Here we re-settle until the settled screen classifies as
        terminal (IDLE / permission / input / error / exited).

        Returns ``(raw_screen, state)``.
        """
        deadline = _now() + timeout
        while _now() < deadline:
            remaining = max(0.0, deadline - _now())
            raw = self.wait_for_settle(
                settle_polls=settle_polls, poll=poll, timeout=remaining
            )
            if not self.session.is_alive():
                return raw, State.EXITED
            st = classify(raw, self.patterns)
            if st in self._TERMINAL:
                return raw, st
            # Still active (e.g. settled mid-think). Sleep a beat and re-settle
            # so we don't busy-spin on a static thinking frame.
            time.sleep(poll)
        return self.session.capture(), classify(self.session.capture(), self.patterns)

    def prompt(self, text: str, timeout: float = 180) -> dict:
        """Send a prompt, wait for the turn to complete, return the response.

        Returns a dict ``{"response": str, "state": State}``. If the turn ends
        in a permission dialog we surface that (``state == AWAITING_PERMISSION``)
        and do **not** auto-approve — the caller decides.

        Algorithm
        ---------
        1. send the prompt text.
        2. wait_for_turn_end (settle until terminal), then classify.
        3. capture full history; the response is the output block anchored on
           the (last) echoed prompt — see :func:`clean_response`. We anchor on
           the echoed prompt rather than a line-count boundary because short
           replies render in-place and never scroll into history, so a boundary
           diff would be empty.
        """
        self.session.send_text(text)
        # Give the UI a beat to echo input + start the turn before we settle,
        # so we don't catch the pre-send idle screen as "already settled".
        time.sleep(0.5)

        raw, st = self.wait_for_turn_end(timeout=timeout)

        # Prefer full history (captures answers that scrolled off-screen); the
        # anchor keeps only the latest turn's output.
        full = self.session.capture(history=True)
        response = clean_response(full, prompt_text=text)
        if not response:
            # Fallback to the settled visible screen.
            response = clean_response(raw, prompt_text=text)

        return {"response": response, "state": st}

    def approve(self) -> None:
        """Resolve a permission dialog by choosing the (default) yes option.

        Claude's permission dialog is arrow-driven with the cursor on option 1
        ("Yes") by default, so a bare Enter approves. We send Enter.
        """
        self.session.send_key("Enter")

    def deny(self) -> None:
        """Resolve a permission dialog by choosing 'no'.

        The "No" option is the last entry; we move down then confirm. Escape
        also dismisses the dialog in Claude Code, which is the safest "no".
        """
        self.session.send_key("Escape")

    def interrupt(self) -> None:
        """Interrupt an in-progress turn."""
        self.session.interrupt()

    # -- permission mode (autonomy) ---------------------------------------

    # Footer substrings that identify each permission mode, mapped to a short
    # canonical name. These are version-specific signatures, same spirit as
    # patterns.yaml — retune if the TUI changes.
    _MODE_SIGNATURES = {
        "normal": "? for shortcuts",
        "auto": "auto mode on",
        "accept-edits": "accept edits on",
        "plan": "plan mode on",
        # "bypass permissions" is NOT in the Shift-Tab cycle — it can only be
        # entered by launching with --dangerously-skip-permissions. We can still
        # *detect* it from the footer, but set_mode() cannot reach it.
        "bypass": "bypass permissions on",
    }
    # Modes reachable by cycling Shift-Tab in a running session.
    _CYCLABLE_MODES = ("normal", "auto", "accept-edits", "plan")

    def current_mode(self) -> str | None:
        """Return the current permission mode by reading the footer, or None.

        Modes: ``normal`` (asks every time), ``accept-edits`` (auto-accepts file
        edits), ``auto`` (most autonomous), ``plan`` (read-only planning).
        """
        screen = self.session.capture()
        # Look at the lower portion where the footer lives.
        tail = "\n".join(screen.splitlines()[-6:]).lower()
        for name, sig in self._MODE_SIGNATURES.items():
            if sig in tail:
                return name
        return None

    def set_mode(self, target: str, max_cycles: int = 6, poll: float = 0.3) -> bool:
        """Cycle the permission mode to ``target`` by sending Shift-Tab.

        Claude's footer hint "shift+tab to cycle" rotates through the modes;
        tmux sends Shift-Tab as ``BTab``. We press it until the footer shows the
        target mode (or we run out of cycles). Returns True on success.

        This is the keystroke-only way to make an agent autonomous — no
        ``--permission-mode`` flag, no headless mode.

        ``bypass`` is special: it is not in the cycle, so it can only be set at
        launch (see the server's spawn path). Here we just report whether the
        session already happens to be in bypass.
        """
        if target not in self._MODE_SIGNATURES:
            raise ValueError(f"unknown mode {target!r}")
        if target == "bypass":
            # Not reachable by cycling; only verifiable.
            return self.current_mode() == "bypass"
        for _ in range(max_cycles):
            if self.current_mode() == target:
                return True
            self.session.send_key("BTab")
            time.sleep(poll)
        return self.current_mode() == target


def clean_response(raw_screen: str, prompt_text: str = "") -> str:
    """Extract the model's reply from a settled screen / history capture.

    The reply on a settled Claude screen sits in an *output block* — a line
    led by the output bullet ``⏺`` plus its indented continuation — wedged
    between the echoed prompt and the input composer::

        ❯ <my prompt>          <- echoed prompt (anchor)

        ⏺ <answer line 1>       <- output block (what we want)
          <answer line 2>

        ✻ Cogitated            <- status line (leading spinner -> dropped)

        ──────────────         <- composer divider (region boundary)
        ❯
        ──────────────
          ? for shortcuts ...  <- footer

    Algorithm:

    1. anchor on the LAST echoed-prompt line (so multi-turn history keeps only
       the latest answer); fall back to the last ``⏺`` bullet if not found.
    2. take the region from the anchor up to the next long composer divider.
    3. drop status lines (raw line whose first non-space glyph is a stripped
       spinner — braille/dingbat star), composer chrome and footer hints.
    4. strip the leading output bullet, normalize whitespace.

    Heuristic by nature; when output looks wrong, ``dump`` a fresh screen and
    compare against these assumptions.
    """
    lines = raw_screen.splitlines()
    want = prompt_text.strip()

    # 1. Find the anchor: last line that echoes the prompt.
    anchor = -1
    if want:
        for i, line in enumerate(lines):
            if _strip_prompt_arrow(line).strip() == want:
                anchor = i
    if anchor == -1:
        # Fall back to the last output bullet.
        for i, line in enumerate(lines):
            if line.lstrip().startswith("⏺"):
                anchor = i - 1
    region = lines[anchor + 1 :] if anchor >= 0 else lines

    # 2. Cut the region at the first composer divider.
    cut: list[str] = []
    for line in region:
        if _is_divider(line):
            break
        cut.append(line)

    # 3 & 4. Filter chrome/status/footer, strip the output bullet.
    out: list[str] = []
    for line in cut:
        if _is_status_line(line):
            continue
        stripped = line.strip()
        if _is_chrome(stripped) or _is_footer(stripped):
            continue
        out.append(re.sub(r"^\s*[⏺●•]\s?", "", line))

    # Collapse leading/trailing blank lines, normalize spinner/timer noise.
    return normalize("\n".join(out)).strip()


# A long horizontal rule = the composer divider that brackets the input box.
_DIVIDER_RE = re.compile(r"^[\s│]*─{20,}[\s│]*$")
# Box-drawing / composer chrome and the input arrow.
_CHROME_RE = re.compile(r"^[╭╮╰╯│─┌┐└┘├┤┬┴┼>❯]+$|^[╭╮╰╯│─].*[│─╮╯]$")
# Leading spinner glyphs that mark a transient status line (braille + dingbat
# stars). These are what normalize() strips; a line that *starts* with one is a
# status line ("✻ Cogitated", "✳ Brewed for 1s"), never response content.
_STATUS_LEAD_RE = re.compile(r"^\s*[⠀-⣿✢-✿]")
# Footer hints we never want in the response body.
_FOOTER_HINTS = (
    "? for shortcuts",
    "esc to interrupt",
    "ctrl+",
    "auto mode on",
    "accept edits on",
    "plan mode on",
    "shift+tab",
    "for agents",
    "/effort",
    "bypass permissions",
)


def _strip_prompt_arrow(line: str) -> str:
    """Remove a leading composer arrow (``❯``/``>``) from a line."""
    return re.sub(r"^\s*[❯>]\s?", "", line)


def _is_divider(line: str) -> bool:
    return bool(_DIVIDER_RE.match(line))


def _is_status_line(line: str) -> bool:
    return bool(line.strip()) and bool(_STATUS_LEAD_RE.match(line))


def _is_chrome(line: str) -> bool:
    if not line:
        return False
    if _CHROME_RE.match(line):
        return True
    # A composer line is just the prompt arrow plus maybe placeholder text.
    if line in (">", "❯"):
        return True
    return False


def _is_footer(line: str) -> bool:
    low = line.lower()
    return any(hint in low for hint in _FOOTER_HINTS)


def _now() -> float:
    return time.monotonic()
