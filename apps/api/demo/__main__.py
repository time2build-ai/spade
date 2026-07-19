"""Bring an example app to life in the live Spade DB.

    # from apps/api
    ../../.venv/bin/python -m demo --list
    ../../.venv/bin/python -m demo --app link-shortener
    ../../.venv/bin/python -m demo --app link-shortener --reset --account ~/.claude

Then open the UI (localhost:8766), switch to the new project, and explore the
backlog, brain, decisions, orchestrator and sprint — all real.
"""

from __future__ import annotations

import argparse
import sys

from demo.seed import advance_task, bring_to_life
from demo.templates import TEMPLATES


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="demo", description="Bring an example app to life.")
    ap.add_argument("--app", default="link-shortener", help="template id (see --list)")
    ap.add_argument("--list", action="store_true", help="list available app templates")
    ap.add_argument("--reset", action="store_true", help="delete + recreate the project first")
    ap.add_argument("--account", metavar="DIR", default=None,
                    help="import a claude config dir as an account (e.g. ~/.claude) so Ask works live")
    # Workshop helper: run one task through the pipeline for free (no live agents).
    ap.add_argument("--advance", metavar="TASK_ID", default=None,
                    help="run a task through the pipeline (fake spawn, free), e.g. SPD-004")
    ap.add_argument("--project", default=None, help="project id (for --advance)")
    ap.add_argument("--to", default="shipped", choices=["in_progress", "review", "shipped"],
                    help="how far to advance (with --advance)")
    args = ap.parse_args(argv)

    if args.advance:
        if not args.project:
            print("--advance needs --project <id>", file=sys.stderr)
            return 2
        r = advance_task(args.project, args.advance, to=args.to)
        print(f"✦ {args.advance} → pipeline {r['status']} ({r['progress']}%)")
        return 0

    if args.list:
        print("Available apps:\n")
        for key, t in TEMPLATES.items():
            print(f"  {key:16s} {t['name']} — {t['tagline']}")
        return 0

    if args.app not in TEMPLATES:
        print(f"unknown app {args.app!r}. Try --list.", file=sys.stderr)
        return 2

    s = bring_to_life(args.app, reset=args.reset, account_dir=args.account)
    print(f"\n✦ {s['name']} is live (project '{s['project']}').\n")
    print(f"  {s['features']} features · {s['decisions']} decisions · {s['tasks']} backlog cards")
    print(f"  {s['pipelines']} pipeline runs · {s['meetings']} meetings · {s['feedback_clusters']} feedback clusters")
    if s["account"]:
        print(f"  account '{s['account']}' connected — Ask the brain will work live")
    print("\nNext: open http://localhost:8766, switch to the project, and explore the")
    print("Backlog, Product brain, Decisions, Orchestrator and Sprints.\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
