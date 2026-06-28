"""Opt-in LIVE chat evaluation — drives a real `claude` agent through a planning
conversation and checks the responses are coherent and on-task.

This SPAWNS A REAL, AUTHENTICATED `claude` SESSION and costs real tokens, so it is
disabled unless you opt in:

    TUI_PILOT_LIVE=1 /Users/thiagolopez/time2build/projects/tui-pilot/.venv/bin/python -m evals.run_live_chat_eval

Override the agent command with TUI_PILOT_CMD (default: claude). It needs tmux and
a logged-in `claude` on PATH. The deterministic, no-cost workflow suite is
`run_evals.py`; this one is the live counterpart for the conversational layer.
"""

from __future__ import annotations

import os
import sys
import uuid

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

LIVE = os.environ.get("TUI_PILOT_LIVE") == "1"
CMD = os.environ.get("TUI_PILOT_CMD", "claude")


def _eval(label, cond, detail=""):
    mark = "✓" if cond else "✗"
    print(f"  {mark} {label}" + ("" if cond else f"  — {detail}"))
    return bool(cond)


def main() -> int:
    if not LIVE:
        print("LIVE chat eval is OFF. Set TUI_PILOT_LIVE=1 to run it (spawns a real,")
        print("billable `claude` session). The no-cost workflow suite is run_evals.py.")
        return 0

    import time

    from tui_pilot.controller import Controller
    from tui_pilot.screen import State
    from tui_pilot.session import TmuxSession

    def ensure_idle(ctrl, timeout=60):
        """Block until the agent is genuinely IDLE before prompting — without this
        a prompt sent mid-boot reads the prior frame (one-turn lag)."""
        deadline = time.time() + timeout
        while time.time() < deadline:
            ctrl.wait_for_settle(timeout=timeout)
            if ctrl.state() == State.IDLE:
                return True
            time.sleep(0.5)
        return False

    name = f"spade-chat-eval-{uuid.uuid4().hex[:8]}"
    sess = TmuxSession(name, CMD, cols=120, rows=40)
    sess.spawn()
    ctrl = Controller(sess)
    results = []
    try:
        results.append(_eval("agent boots to IDLE", ensure_idle(ctrl)))

        # 1. Sanity round-trip.
        r = ctrl.prompt("Reply with exactly one word: pong", timeout=90)
        results.append(_eval("basic chat round-trip", "pong" in r["response"].lower(),
                             r.get("response", "")[:120]))

        # 2. Planning: ask it to plan a feature; expect concrete, ordered steps.
        ensure_idle(ctrl)
        r = ctrl.prompt(
            "You are a software orchestrator. In 3-5 numbered steps, plan how to add "
            "a 'mobile checkout speed' optimization to an e-commerce app. Be concise.",
            timeout=120,
        )
        resp = r["response"].lower()
        results.append(_eval("planning produces numbered steps",
                             any(f"{n}." in r["response"] or f"{n})" in r["response"] for n in (1, 2, 3)),
                             r["response"][:160]))
        results.append(_eval("plan is on-topic (checkout/mobile/perf)",
                             any(k in resp for k in ("checkout", "mobile", "load", "perf", "speed", "lcp")),
                             r["response"][:160]))

        # 3. Execution reasoning: ask which role/agent should do the work.
        ensure_idle(ctrl)
        r = ctrl.prompt(
            "For that work, which single role would you assign first — developer, "
            "reviewer, integrator, or documentor? Answer with just the role word.",
            timeout=90,
        )
        results.append(_eval("execution: picks a concrete role",
                             any(role in r["response"].lower()
                                 for role in ("developer", "reviewer", "integrator", "documentor")),
                             r["response"][:120]))
    finally:
        sess.kill()

    passed = sum(1 for x in results if x)
    print(f"\nLIVE chat eval: {passed}/{len(results)} checks passed")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
