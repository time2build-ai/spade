"""Command-line entry points: ``dump`` (fixture capture) and ``repl`` (demo).

Usage
-----
    python -m tui_pilot.cli dump --cmd claude [--name pilot-dump]
    python -m tui_pilot.cli repl --cmd claude [--name pilot-repl]

``dump`` is the fixture-collection tool: it spawns the target, tells you how to
attach and drive it live, and snapshots ``capture-pane`` into ``fixtures/``
each time you press Enter (labelling each snapshot). This is how you collect
real BOOTING / IDLE / THINKING / PERMISSION screens to tune ``patterns.yaml``
and seed the tests. Build everything else on top of these fixtures.

``repl`` is the end-to-end smoke test: read a line, ``controller.prompt()`` it,
print the cleaned response.
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

from .controller import Controller, load_patterns
from .screen import classify, normalize
from .session import SessionError, TmuxSession

FIXTURES_DIR = Path(__file__).resolve().parent.parent / "fixtures"


def _spawn(name: str, cmd: str, cols: int, rows: int) -> TmuxSession:
    sess = TmuxSession(name, cmd, cols=cols, rows=rows)
    if sess.is_alive():
        print(f"[!] session {name!r} already exists; killing it first")
        sess.kill()
        time.sleep(0.3)
    sess.spawn()
    return sess


def cmd_dump(args: argparse.Namespace) -> int:
    """Interactive fixture capture loop."""
    FIXTURES_DIR.mkdir(exist_ok=True)
    sess = _spawn(args.name, args.cmd, args.cols, args.rows)
    print(f"[+] spawned {args.name!r} running: {args.cmd}")
    print(f"[+] attach in ANOTHER terminal to drive it live:")
    print(f"\n      tmux attach -t {args.name}\n")
    print("    (detach with Ctrl-b then d — do NOT quit the program)")
    print("    Drive the TUI into a state, come back here, type a LABEL")
    print("    (e.g. booting / idle / thinking / permission / error) and")
    print("    press Enter to snapshot the current screen. Empty label quits.\n")
    patterns = load_patterns(args.patterns)
    try:
        while True:
            try:
                label = input("label> ").strip()
            except EOFError:
                break
            if not label:
                break
            if not sess.is_alive():
                print("[!] session died; stopping")
                break
            raw = sess.capture()
            # The visible screen is what classify() sees; save that.
            out = FIXTURES_DIR / f"{label}.txt"
            out.write_text(raw, encoding="utf-8")
            st = classify(raw, patterns)
            print(f"    saved {out.name}  ({len(raw.splitlines())} lines)  "
                  f"-> classify() == {st.value}")
    finally:
        if not args.keep:
            sess.kill()
            print(f"[+] killed {args.name!r}")
        else:
            print(f"[+] left {args.name!r} running (--keep)")
    return 0


def cmd_repl(args: argparse.Namespace) -> int:
    """Demo loop: prompt -> response."""
    sess = _spawn(args.name, args.cmd, args.cols, args.rows)
    ctrl = Controller(sess, patterns_path=args.patterns)
    print(f"[+] spawned {args.name!r}; waiting for it to boot…")
    try:
        # Wait for the composer to be ready (settle, then sanity-check state).
        ctrl.wait_for_settle(timeout=args.boot_timeout)
        print(f"[+] state: {ctrl.state().value}")
        print("[+] type a prompt and press Enter. Ctrl-D to quit.\n")
        while True:
            try:
                line = input("you> ").strip()
            except EOFError:
                break
            if not line:
                continue
            result = ctrl.prompt(line, timeout=args.timeout)
            print(f"\n[state={result['state'].value}]")
            if result["state"].value == "AWAITING_PERMISSION":
                print("[!] permission dialog detected. Approve? [y/N] ", end="")
                ans = input().strip().lower()
                if ans == "y":
                    ctrl.approve()
                else:
                    ctrl.deny()
                # settle again and show what came out
                ctrl.wait_for_settle(timeout=args.timeout)
                print(normalize(sess.capture()))
            else:
                print("claude>", result["response"] or "(empty)")
            print()
    finally:
        sess.kill()
        print(f"[+] killed {args.name!r}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="tui_pilot.cli", description=__doc__)
    sub = p.add_subparsers(dest="command", required=True)

    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--cmd", default="claude", help="command to run in the session")
    common.add_argument("--cols", type=int, default=200)
    common.add_argument("--rows", type=int, default=50)
    common.add_argument("--patterns", default=None, help="path to patterns.yaml")

    d = sub.add_parser("dump", parents=[common], help="capture fixtures")
    d.add_argument("--name", default="pilot-dump")
    d.add_argument("--keep", action="store_true", help="leave session running on exit")
    d.set_defaults(func=cmd_dump)

    r = sub.add_parser("repl", parents=[common], help="interactive demo")
    r.add_argument("--name", default="pilot-repl")
    r.add_argument("--timeout", type=float, default=180)
    r.add_argument("--boot-timeout", type=float, default=30)
    r.set_defaults(func=cmd_repl)

    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return args.func(args)
    except SessionError as exc:
        print(f"[session error] {exc}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
