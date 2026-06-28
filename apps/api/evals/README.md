# Spade workflow evaluations

A level above the unit tests: these drive the **real API/domain** through the
product workflows a user cares about — *creating projects, getting info, planning,
executing* — and report whether each workflow actually works end-to-end.

## 1. Deterministic workflow suite (no cost, run anytime)

```
/Users/thiagolopez/time2build/projects/tui-pilot/.venv/bin/python -m evals.run_evals
```

Outputs a grouped pass/fail report to the terminal, a markdown copy to
`EVALS-REPORT.md`, and a polished **standalone HTML report** to
`EVALS-REPORT.html` (open it in a browser — summary cards, a pass-rate bar, and
collapsible per-scenario check lists).

**49 scenarios / 143 checks** across:

| Group | Workflows exercised |
|-------|---------------------|
| **Projects** | create → get info (+pool) → update settings → set current → delete; 404s; `~` path expansion; `/env` |
| **Accounts** | create/patch/default, project pool, round-robin dispatch; 404s; content-aware auth status; import/managed dirs |
| **Planning · Brain** | all 6 node types, edges, decision lifecycle, provenance, **MCP export** (incl. empty), **gap analysis** (incl. none-when-connected), **gate conflict** (incl. linked-preference), node delete cascades edges |
| **Planning · Tasks** | create/patch/move, link to brain, comments, task links; 404s + delete; every status; link validation |
| **Execution · Pipeline** | full 4-stage machine create→start→ship, derived progress, **spawn-failure pauses the run**, re-entry safety + session lookup |
| **Inputs** | sprints (counts derived from runs + current/empty), meetings, feedback, integrations (connect/disconnect + 404), chat persistence + thread ordering |
| **System** | settings, roles CRUD + 404s + idempotent upsert |
| **Orchestrator · chat** | the decision core — plans & spawns within ceiling, **gates costly spawns** (human-in-the-loop), answer/kill, strict signal parsing, mission autopilot, brake 404s |
| **End-to-end** | "day in the life" (plan → execute → sprint reflects it), **multi-project isolation**, **planning gap → resolution loop** |

Each scenario runs against a fresh, isolated SQLite DB. Output is a grouped
pass/fail report; a markdown copy is written to `EVALS-REPORT.md`.

The pipeline **execution** scenarios drive the stage state-machine with a fake
spawn closure (deterministic). The real HTTP `POST /pipelines/{id}/start` and
`POST /orchestrator` spawn live `claude` agents — covered by the live eval below.

## 2. Live chat eval (opt-in — spawns a real, billable `claude`)

```
TUI_PILOT_LIVE=1 /Users/thiagolopez/time2build/projects/tui-pilot/.venv/bin/python -m evals.run_live_chat_eval
```

Spawns a real authenticated `claude` session (needs tmux + a logged-in `claude`)
and drives a short **planning → execution** conversation, checking the responses
are coherent and on-task. This costs real tokens; it's off unless `TUI_PILOT_LIVE=1`.

The deeper live harness (agent emits a mailbox signal → control center → answer →
finish) is also covered by `tests/test_integration.py` (same `TUI_PILOT_LIVE=1`).
