# Spade workflow evaluations

A level above the unit tests: these drive the **real API/domain** through the
product workflows a user cares about — *creating projects, getting info, planning,
executing* — and report whether each workflow actually works end-to-end.

## 1. Deterministic workflow suite (no cost, run anytime)

```
/Users/thiagolopez/time2build/projects/tui-pilot/.venv/bin/python -m evals.run_evals
```

26 scenarios / 86 checks across:

| Group | Workflows exercised |
|-------|---------------------|
| **Projects** | create → get info (+pool) → update settings → set current → delete |
| **Accounts** | create/patch/default, project pool, round-robin dispatch |
| **Planning · Brain** | all 6 node types, edges, decision lifecycle, provenance, **MCP export**, **gap analysis**, **gate conflict** |
| **Planning · Tasks** | create/patch/move, link to brain nodes, comments, task links |
| **Execution · Pipeline** | full 4-stage machine create→start→ship, derived progress |
| **Inputs** | sprints (counts derived from runs), meetings, feedback, integrations, chat persistence |
| **System** | settings, roles CRUD |
| **Orchestrator · chat** | the decision core — plans & spawns within ceiling, **gates costly spawns** (human-in-the-loop), answer/kill a worker |
| **End-to-end** | "day in the life": plan → execute → sprint reflects the shipped run |

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
