"""Opt-in LIVE proactivity eval — does the agent capture the right thing from
*natural* conversation, without being told to?

The user never says "insert an ADR"; they just talk. This drives a real `claude`
with Spade's proactive instructions and, for each utterance, checks it classifies
the signal into the right artifact (decision / feature / bug / feedback / task) —
and crucially stays QUIET on chit-chat (no over-capture).

    TUI_PILOT_LIVE=1 /Users/thiagolopez/time2build/projects/tui-pilot/.venv/bin/python -m evals.run_proactivity_eval

Spawns a real, billable `claude` (needs tmux + a logged-in claude). Off by default.
"""

from __future__ import annotations

import os
import re
import sys
import time
import uuid

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

LIVE = os.environ.get("TUI_PILOT_LIVE") == "1"
CMD = os.environ.get("TUI_PILOT_CMD", "claude")

PRIME = (
    "You are Spade's proactive product assistant. People just talk — describing what "
    "they're building, what they decided, what they want, what's broken. You notice and "
    "capture it so the backlog and knowledge graph stay current, WITHOUT being told to. "
    "Artifact types: decision (a choice made — always tentative/'proposed'), feature (a "
    "capability wanted), task (concrete work to do), bug (something broken), feedback "
    "(users asking/complaining). A single message can imply SEVERAL artifacts — capture "
    "each. If the message is pure chit-chat or hypothetical, capture NOTHING.\n\n"
    "For the user message below, reply with ONE LINE PER artifact you'd record:\n"
    "CAPTURE: <type> — <short label>\n(type ∈ decision|feature|task|bug|feedback). "
    "If there's nothing concrete, reply exactly 'CAPTURE: none'. No other text."
)

# (utterance, want, mode):
#   single → it must capture something whose type is in `want`
#   multi  → every type in `want` must appear (one natural pitch → several artifacts)
#   none   → it must capture nothing
SCENARIOS = [
    ("Honestly, let's just use Postgres for the todo storage instead of Mongo.", {"decision"}, "single"),
    ("It'd be really nice if people could set a due date on each todo.", {"feature"}, "single"),
    ("Weird one — checking off a todo sometimes flickers and un-checks itself on slow wifi.", {"bug"}, "single"),
    ("Three different users this week asked for keyboard shortcuts.", {"feedback", "feature"}, "single"),
    ("We still need to add a DELETE endpoint for todos before we can ship.", {"task", "feature"}, "single"),
    # the workshop's hero: one natural pitch → several artifacts pulled out at once
    ("Hey, let's start a little todo app — people add todos, check them off, and can filter to just "
     "the open ones. I'm thinking React on the front and FastAPI on the back. Oh, and heads up: the "
     "date picker is off by one in UTC right now.",
     {"decision", "feature", "bug"}, "multi"),
    ("Anyway, good chat — I'm going to grab some lunch, talk later.", set(), "none"),
]


def _eval(label, cond, detail=""):
    print(f"  {'✓' if cond else '✗'} {label}" + ("" if cond else f"  — {detail}"))
    return bool(cond)


def main() -> int:
    if not LIVE:
        print("Proactivity eval is OFF. Set TUI_PILOT_LIVE=1 to run it (spawns a real,")
        print("billable `claude`). It checks the agent captures the right artifact from")
        print("natural talk — the behavior driven by the spade-data skill's proactive section.")
        return 0

    from tui_pilot.controller import Controller
    from tui_pilot.screen import State
    from tui_pilot.session import TmuxSession

    def ensure_idle(ctrl, timeout=60):
        end = time.time() + timeout
        while time.time() < end:
            ctrl.wait_for_settle(timeout=timeout)
            if ctrl.state() == State.IDLE:
                return
            time.sleep(0.4)

    sess = TmuxSession(f"spade-proact-{uuid.uuid4().hex[:8]}", CMD, cols=120, rows=40)
    sess.spawn()
    ctrl = Controller(sess)
    results = []
    try:
        ensure_idle(ctrl)
        for utterance, want, mode in SCENARIOS:
            ensure_idle(ctrl)
            r = ctrl.prompt(f'{PRIME}\n\nUser message: "{utterance}"', timeout=120)
            resp = r["response"]
            found = {t.lower() for t in re.findall(r"CAPTURE:\s*([a-z]+)", resp, re.I)}
            real = found - {"none"}
            if mode == "none":
                ok = not real
                _eval(f'restraint on chit-chat → {real or "none"}', ok, resp[:90])
            elif mode == "multi":
                ok = want <= found
                _eval(f'pitch → {sorted(real)} (needs {sorted(want)})', ok, resp[:90])
            else:  # single
                ok = bool(found & want)
                _eval(f'"{utterance[:40]}…" → {sorted(real)} (want {"/".join(sorted(want))})', ok, resp[:90])
            results.append(ok)
    finally:
        sess.kill()

    passed = sum(1 for x in results if x)
    print(f"\nProactivity eval: {passed}/{len(results)} captured correctly")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
