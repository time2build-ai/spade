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
    "You are Spade's proactive product assistant. People just talk — about what they "
    "decided, what they want, what's broken. You notice and capture it so the backlog "
    "and knowledge graph stay current, WITHOUT being told to. Map a signal to exactly "
    "one artifact: decision (a choice made — always tentative/'proposed'), feature (a "
    "capability wanted), task (concrete work to do), bug (something broken), feedback "
    "(users asking/complaining). If the message is chit-chat or hypothetical, capture "
    "NOTHING.\n\nFor the single user message below, reply with ONLY one line:\n"
    "CAPTURE: <type> — <short label>\nwhere <type> is one of decision|feature|task|bug|"
    "feedback|none. Nothing else."
)

# utterance → acceptable artifact types (a set; 'none' means it must NOT capture)
SCENARIOS = [
    ("Honestly, let's just use Postgres for the todo storage instead of Mongo.", {"decision"}),
    ("It'd be really nice if people could set a due date on each todo.", {"feature"}),
    ("Weird one — checking off a todo sometimes flickers and un-checks itself on slow wifi.", {"bug"}),
    ("Three different users this week asked for keyboard shortcuts.", {"feedback", "feature"}),
    ("We still need to add a DELETE endpoint for todos before we can ship.", {"task", "feature"}),
    ("Anyway, good chat — I'm going to grab some lunch, talk later.", {"none"}),
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
        for utterance, expected in SCENARIOS:
            ensure_idle(ctrl)
            r = ctrl.prompt(f'{PRIME}\n\nUser message: "{utterance}"', timeout=110)
            resp = r["response"]
            m = re.search(r"CAPTURE:\s*([a-z]+)", resp, re.I)
            got = (m.group(1).lower() if m else "?")
            if "none" in expected:
                ok = got == "none"
                _eval(f'restraint on chit-chat → "{got}"', ok, resp[:90])
            else:
                ok = got in expected
                _eval(f'"{utterance[:42]}…" → {got} (want {"/".join(expected)})', ok, resp[:90])
            results.append(ok)
    finally:
        sess.kill()

    passed = sum(1 for x in results if x)
    print(f"\nProactivity eval: {passed}/{len(results)} captured correctly")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
