"""Run the Spade workflow evaluations and print/write a report.

    /Users/thiagolopez/time2build/projects/tui-pilot/.venv/bin/python -m evals.run_evals
"""

from __future__ import annotations

import os
import sys

# Make `import evals` / `import tui_pilot` work when run as a module from apps/api.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from evals.harness import run
from evals.scenarios import ALL


def main() -> int:
    report = os.path.join(os.path.dirname(os.path.abspath(__file__)), "EVALS-REPORT.md")
    ok = run(ALL, report_path=report)
    print(f"\nReport written to {report}")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
