"""Bring an example app to life in the live Spade DB.

    # from apps/api
    ../../.venv/bin/python -m demo --list
    ../../.venv/bin/python -m demo --app link-shortener
    ../../.venv/bin/python -m demo --app link-shortener --reset --account ~/.claude

Then open the UI (localhost:3000), switch to the new project, and explore the
backlog, brain, decisions, orchestrator and sprint — all real.
"""

from __future__ import annotations

import argparse
import sys

from demo.seed import bring_to_life
from demo.templates import TEMPLATES


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="demo", description="Bring an example app to life.")
    ap.add_argument("--app", default="link-shortener", help="template id (see --list)")
    ap.add_argument("--list", action="store_true", help="list available app templates")
    ap.add_argument("--reset", action="store_true", help="delete + recreate the project first")
    ap.add_argument("--account", metavar="DIR", default=None,
                    help="import a claude config dir as an account (e.g. ~/.claude) so Ask works live")
    args = ap.parse_args(argv)

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
    print("\nNext: open http://localhost:3000, switch to the project, and explore the")
    print("Backlog, Product brain, Decisions, Orchestrator and Sprints.\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
