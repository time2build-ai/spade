# tui-pilot

## Quick start

```bash
make setup     # one-time: create the venv (uv) + install dependencies
make dev       # start the server with auto-reload → http://127.0.0.1:8765/ui/
```

`make dev` runs the API + web UI in one process with hot-reload (Python changes
apply automatically — no manual restart). Data (the SQLite DB + managed account
dirs) lives in `~/spade-qa` by default; override with
`make dev DATA_HOME=~/other PORT=9000`. Other targets: `make test`, `make stop`,
`make open`, `make fresh` (wipe the data dir). Requires `tmux` and the `claude`
CLI on PATH. Run `make` with no args to list everything.

---

A programmatic controller for an **interactive** terminal TUI, driven entirely
through **tmux** and exposed over an HTTP API. The reference target is the
Claude Code interactive REPL, but nothing here is Claude-specific — it works
against any line-or-screen-oriented TUI by retuning a single config file.

This is a learning exercise: the point is to **reconstruct programmatic control
from raw terminal-automation primitives**, not to use a headless/SDK shortcut.

## The hard constraint

The **only** sanctioned interface to the running program is the terminal:
keystrokes in via `tmux send-keys`, the rendered screen out via
`tmux capture-pane`. No `claude -p` / `--print`, no `--output-format`, no
`--input-format`, no `--resume`/`--bare`, no Agent SDK, no direct API calls.
The TUI is a black box you can only see and type into.

```
$ grep -rnE -- '--print|--output-format|stream-json|agent-sdk| -p ' tui_pilot/
(no matches)
```

## How it works

Driving an interactive TUI decomposes into three problems:

1. **Input injection** (easy) — `tmux send-keys`. Prompt *body* goes in literally
   (`send-keys -l`), then `Enter` as a separate keystroke. Menus and permission
   dialogs are arrow-driven (`Up`/`Down`/`Enter`, or numbered options).
2. **Output capture** (easy) — `tmux capture-pane -p` returns the **rendered**
   screen as a plain 2D character grid. tmux is itself a terminal emulator, so
   escape sequences and redraws are already resolved. We never parse ANSI.
3. **Synchronization** (the hard 90%) — nothing signals when the program is
   booting, thinking, streaming, idle, or blocked on a prompt. We **infer state
   from the rendered screen** (the classic `expect` problem).

The key trick for synchronization is the **quiescence loop**
(`Controller.wait_for_settle`): poll the screen, hash the *normalized* screen,
and declare "settled" once the hash is stable for N polls. Normalization is what
makes this work — while the program is thinking, the only thing changing is the
spinner glyph and an elapsed-time counter; `screen.normalize()` strips both, so
a thinking screen registers as *stable-content-plus-spinner* rather than as
motion. `Controller.wait_for_turn_end` wraps that loop and keeps re-settling
until the settled screen classifies as a terminal state (so it never returns
mid-think).

## Layout

```
tui_pilot/
  session.py     TmuxSession — tmux mechanics only (send-keys / capture-pane)
  screen.py      PURE functions: normalize() + classify()  (no I/O, fully tested)
  controller.py  synchronization + prompt()/approve()/deny()/interrupt()
  server.py      FastAPI HTTP layer (roles, multi-session) + bundled UI
  cli.py         `dump` (fixture capture) and `repl` (demo)
  static/        the multi-agent browser control panel served at /ui/
patterns.yaml    version-specific regexes — TUNE THESE per target TUI
roles.yaml       agent-role presets (Planner, Developer, …) — TUNE per use
fixtures/        saved capture-pane snapshots, one per state (seed the tests)
tests/           offline unit tests (screen + server + roles) + live integration
```

## Setup

Requires `tmux` on PATH (`brew install tmux`) and Python 3.11+.

```bash
uv venv --python 3.12 .venv          # or: python3 -m venv .venv
uv pip install --python .venv/bin/python -r requirements.txt
```

## Usage

### HTTP server (the "programmatic mode")

```bash
.venv/bin/python -m uvicorn tui_pilot.server:app --host 127.0.0.1 --port 8765
```

Then drive a real session entirely over HTTP from any other process:

```bash
B=http://127.0.0.1:8765
curl -s -X POST $B/sessions -d '{"name":"s","cmd":"claude"}' -H 'content-type: application/json'
sleep 6
curl -s $B/sessions/s/state                       # {"state":"IDLE"}
curl -s -X POST $B/sessions/s/prompt -d '{"text":"Reply one word: pong"}' -H 'content-type: application/json'
                                                  # {"response":"pong","state":"IDLE"}
curl -s -X DELETE $B/sessions/s
```

| Method & path                       | Body                          | Does                          |
|-------------------------------------|-------------------------------|-------------------------------|
| `GET    /roles`                     |                               | list agent-role presets       |
| `POST   /sessions`                  | `{name, role?, task?, cmd?, instructions?, mode?, cwd?, account_id?, project_id?}` | spawn an (optionally role-based) agent, optionally with a mission; `account_id` pins a specific account (CLAUDE_CONFIG_DIR), `project_id` draws from that project's round-robin account pool |
| `GET    /sessions`                  |                               | list sessions + role/prep/state |
| `GET    /sessions/{name}`           |                               | one session's full info       |
| `GET    /sessions/{name}/state`     |                               | current `State` + `prep`      |
| `GET    /sessions/{name}/screen`    | `?history=bool`               | raw capture                   |
| `POST   /sessions/{name}/prompt`    | `{text}`                      | `{response, state}`           |
| `POST   /sessions/{name}/key`       | `{key}`                       | send one tmux key             |
| `POST   /sessions/{name}/mode`      | `{mode}`                      | change permission mode (Shift-Tab) |
| `POST   /sessions/{name}/approve`   |                               | resolve permission dialog: yes|
| `POST   /sessions/{name}/deny`      |                               | resolve permission dialog: no |
| `POST   /sessions/{name}/interrupt` |                               | interrupt the current turn    |
| `DELETE /sessions/{name}`           |                               | kill the session              |

### Browser control panel

With the server running, open **http://127.0.0.1:8765/ui/** — a multi-agent
control panel. Spawn role-based agents, manage several at once (each card shows
live state + autonomy mode), focus one to watch its live screen and message it,
approve/deny permission dialogs, send raw keys, interrupt, and see the exact
JSON the API returned for each action.

## Agents & roles

On top of the raw drive-a-TUI API, the server adds **agent roles** — presets in
`roles.yaml` (Planner, Autonomous Developer, Reviewer, …) that customise an
interactive `claude` session **without any headless flag or SDK**. A role
customises an agent two ways, both purely through the terminal:

- **Autonomy** — `mode` (`normal` / `accept-edits` / `auto` / `plan`) is set by
  sending **Shift-Tab (`BTab`) keystrokes** to cycle Claude's permission mode
  until the footer shows the target (`Controller.set_mode`). No
  `--permission-mode` flag.
- **Instructions** — the role's `instructions` are typed in as the **first
  interactive message** ("priming"), so the agent adopts them like a system
  prompt before you give it real tasks.

### Role + mission

A role is the *reusable behavior*; a **`task`** (the "Initial task / mission" field
in the UI) is *what this particular agent should do*, given at spawn time. With
a task, the agent starts working the moment it's ready — no second step. This is
how you say "spawn a **developer** to implement **this plan**" or "spawn a
**planner** focused on **a new Salesforce integration**".

Priming + task run in a background thread after spawn; poll `prep`
(`booting` → `priming` → `working` → `ready`) to follow progress.

Example — a Planner whose mission is a Salesforce integration, then a Developer
whose mission is to implement the resulting plan:

```bash
B=http://127.0.0.1:8765
# Planner with a focused mission — writes plan.md autonomously (accept-edits)
curl -s -X POST $B/sessions -H 'content-type: application/json' -d '{
  "name":"sf-planner","role":"planner","cwd":"/path/to/project",
  "task":"Plan a new Salesforce integration: OAuth, sync Contacts + Opportunities, webhooks."
}'

# Developer whose mission is to build that plan (auto = fully hands-off)
curl -s -X POST $B/sessions -H 'content-type: application/json' -d '{
  "name":"sf-dev","role":"developer","mode":"auto","cwd":"/path/to/project",
  "task":"Implement plan.md."
}'
```

You can still drive any agent interactively afterwards (send more prompts), and
you can omit `task` to spawn an idle agent and message it yourself.

**Autonomy levels** (pick in the UI's mode dropdown, or `mode` field / `/mode`):
`normal` asks before every action; `accept-edits` auto-applies file edits but
still asks before running commands (safe default for the developer); `auto` is
fully hands-off (runs commands too — use deliberately); `plan` is read-only;
`bypass` ⚠ skips **all** permission prompts.

`bypass` is the one exception to the keystroke-only rule: it is not in the
Shift-Tab cycle, so it is set at **launch** by appending
`--dangerously-skip-permissions` to the command (the session is still fully
interactive and still driven only via tmux afterwards). It cannot be toggled on
a running session — respawn with `mode: bypass`. Use only in a trusted or
sandboxed working directory; the agent will run every action with no prompts.

Roles are tunable — edit `roles.yaml` (restart the server to reload). The
shipped role instructions explicitly tell agents to run unattended (no
clarifying questions / brainstorming) so they don't block waiting for input.

### CLI

```bash
# Demo loop: prompt in, cleaned response out
.venv/bin/python -m tui_pilot.cli repl --cmd claude

# Fixture capture: drive the TUI live in `tmux attach`, snapshot states here
.venv/bin/python -m tui_pilot.cli dump --cmd claude
```

## Agent harness (fleet control)

The harness turns scattered agents into a managed fleet: any agent — in any
directory — can **signal** a central control center (ask a question, request
context/help, report progress, or finish with a report/handoff), and you answer
from the UI. Everything still flows through tmux + the filesystem; no headless
mode.

**How an agent signals.** At spawn, tui-pilot installs a small **agent-comms
skill** into the agent's `.claude/skills/`, rendered with that agent's exact
**outbox path**. To communicate, the agent writes one JSON file per signal into
its outbox. The control center watches a single central hub keyed by agent id:

```
~/.tui-pilot/comms/<agent-id>/{outbox,inbox,handoffs,processed}/
```

Because comms are keyed by *who* the agent is (a collision-proof
`slug__token` id), not *where* it runs, agents in many different directories are
not a special case — the control plane watches one root.

**Actions** (`outbox/<id>.json`):

| action | blocks? | meaning |
|--------|---------|---------|
| `ask_question` | yes | needs a decision (optional `options`) |
| `need_context` | yes | missing info/files/credentials |
| `need_help`    | yes | stuck; attach paths in `refs` |
| `progress`     | no  | status heartbeat |
| `finished`     | terminal | writes a `report`; optional `next` spawns a successor |

Blocking signals: the agent writes the file and ends its turn. The control
center surfaces it; your answer is **typed back into the agent via tmux**
(`POST /sessions/{id}/answer`), and it continues. `finished` always writes a
**report** (the baton) to `SUMMARY.md` + `handoffs/`; an optional
`next:{role,task,mode,start}` spawns a successor that receives the report —
that's the agent-to-agent handoff (document-first; new instance only when asked).

**In the UI** (`/ui/`): agents needing input float into a **Needs attention**
group (🔴); the focused agent's open signal renders as an **answer card**
(option buttons + free text); a global **Inbox** tab lets you triage all blocked
agents at once; a finished agent shows its **report** with *Archive & kill* and
*Spawn successor*.

**Harness endpoints:** `GET /sessions/{id}/signals`, `POST /sessions/{id}/answer`
`{signal_id,text}`, `GET /sessions/{id}/report`, `POST /sessions/{id}/handoff`.
Session info/list include a `harness_state` (`idle|blocked|done|exited`).

Roles, autonomy mode, and missions compose with all of this — e.g. spawn a
`planner` whose mission produces `plan.md` and whose `finished.next` hands off to
an autonomous `developer`.

## Orchestrator (conversational fleet control)

On top of the harness you can chat with one **orchestrator** agent that runs the
whole fleet for you. It decomposes your goal, spawns workers with the **right
model per task**, routes their questions, and reports back — supervised by
default, hands-off (autopilot) when you flip a per-mission toggle. It stays
within the rules: the orchestrator is itself a tmux `claude` (no API); it manages
others by emitting **orchestration signals** the control center executes.

**Orchestration actions** (the orchestrator writes these to its outbox, on top of
the normal agent-comms actions):

| action | does |
|--------|------|
| `spawn {role, model, task, mission, reason, cwd?, mode?}` | launch a worker as `claude --model <tier>` |
| `answer {worker, text}` | reply to a worker's question or permission prompt (`approve`/`deny`) |
| `kill {worker}` | stop a worker |
| `status {text}` | narrate progress to you |

**Model selection.** Tiers `haiku` / `sonnet` / `opus` map to concrete
`--model` ids; the orchestrator sizes the model to the task and must give a
`reason` (shown as "why this model"). A configurable **ceiling** (default
`sonnet`) caps it — a `spawn` above the ceiling (Opus) is a **brake**.

**Supervised vs autopilot.** Each mission has a toggle (default supervised). In
supervised mode the orchestrator handles routine coordination itself but pauses
for you on **brakes** — an Opus spawn, or any worker hitting a permission dialog
— surfaced as an inline **Allow / Skip**. On autopilot it decides those too, so
you can walk away. When a worker raises a question or permission prompt, the
control center forwards it to the orchestrator, which answers (relayed to the
worker via tmux) or escalates to you.

**Endpoints:** `POST /orchestrator` (ensure/return the orchestrator),
`GET /missions`, `POST /missions/{id}/autopilot`, `GET /missions/{id}`,
`GET /brakes`, `POST /brakes/{id}/allow`, `POST /brakes/{id}/skip`.

**In the UI** (`/ui/`): the **🧠 Orchestrator** chat is the primary surface;
behind it the fleet shows each worker's **model badge + "why"**, grouped by
mission with a per-mission autopilot toggle; brakes appear as **Allow / Skip**
cards; the manual spawn form moves to **Advanced**.

## Persistence, accounts & projects

The control plane keeps an in-memory registry as its live source of truth, but
it is now **backed by SQLite** at `~/.tui-pilot/tui-pilot.db` (override the home
with `$TUI_PILOT_HOME`). Sessions, roles, projects, accounts and missions are
all persisted. On startup the server **reconciles**: still-live tmux agents from
a prior run are reattached (Controller / poller / meta rebuilt) and kept `live`;
dead rows are marked `exited`; persisted missions (and their autopilot flags) are
restored so `GET /missions` is correct immediately. Roles are seeded from
`roles.yaml` into the DB on first run and are then editable at runtime via
`/roles` (the YAML is only a seed source).

**Accounts** each wrap a Claude `CLAUDE_CONFIG_DIR` (its own auth/login). The
server manages them under `~/.tui-pilot/agents/claude-code/` and can import
existing ones from `~/.claude-*`. A spawn runs under a resolved account's config
dir, and a not-logged-in account is rejected at spawn (auth guard).

**Projects** own an ordered **account pool** and are selected round-robin: a
spawn that passes a `project_id` advances that project's cursor and runs on the
next account in the pool (falling back to the default account when the pool is
empty). A project also carries a `model_ceiling` and an `autopilot` baseline that
the orchestrator policy reads. There is one **current project** (app-wide).

**Management endpoints:**

| Method & path                          | Does                                              |
|----------------------------------------|---------------------------------------------------|
| `GET    /accounts`                     | list accounts                                     |
| `POST   /accounts`                     | register an account `{id,label,config_dir,color?,provider?}` |
| `PATCH  /accounts/{id}`                | update label/color                                |
| `DELETE /accounts/{id}`                | remove an account                                 |
| `POST   /accounts/scan`               | discover `managed` + `importable` candidate dirs   |
| `POST   /accounts/import`              | import an existing config dir as an account        |
| `POST   /accounts/{id}/default`        | mark the global default account                    |
| `POST   /accounts/{id}/login`          | open an interactive `claude` to complete OAuth     |
| `GET    /projects`                     | list projects                                      |
| `POST   /projects`                     | create a project `{id,name,path,account_strategy?,model_ceiling?,autopilot?}` |
| `GET    /projects/{id}`                | one project + its account `pool`                   |
| `PATCH  /projects/{id}`                | update fields (e.g. clear `model_ceiling`)         |
| `DELETE /projects/{id}`                | delete a project                                   |
| `PUT    /projects/{id}/accounts`       | set the ordered account pool `{account_ids:[…]}`   |
| `GET    /current-project`              | the current project id                             |
| `PUT    /current-project`              | set the current project `{project_id}`             |
| `POST   /roles`                        | upsert a role                                      |
| `PATCH  /roles/{id}`                   | update a role                                      |
| `DELETE /roles/{id}`                   | delete a role                                      |

A **`/ui`** frontend exposes all of this: a nav rail, a project bar, and
accounts / projects / agents pages (with each worker's account shown).

This persistence + accounts/projects foundation is the basis for a broader
product — see [`docs/spade-alignment.md`](docs/spade-alignment.md) for the
roadmap it supports.

## Spade MVP — product-work layer

The `feat/spade-mvp` branch adds a product-management layer (the "Spade" product) on top of the agent-fleet foundation. All entities are stored in the same SQLite database and served from the same FastAPI server via a mounted router (`tui_pilot/spade_server.py`).

### What's included

| Feature | Description |
|---|---|
| **Tasks / Backlog** | SPD-id–keyed tasks (SPD-001, …) with status kanban (ready → in_progress → review → shipped / blocked), priority (P0–P3), feature grouping, origin quotes, and task–brain-node grounding. |
| **Product Brain** | Typed knowledge graph: nodes (feature / decision / convention / feedback / bug / metric) + directed edges. Visualised as an SVG force layout; tasks can be grounded to nodes. |
| **Pipelines** | 4-stage agent execution: Developer → Reviewer → Integrator → Documentor. Each stage runs a tmux `claude` agent on the project's account pool (round-robin). Stages auto-advance when the current agent emits a `finished` signal. |
| **Home dashboard** | Default landing view: project KPI band (task counts by status), active pipeline list, recent brain nodes — all scoped to the current project. |

### Spade endpoints

| Method & path | Body / params | Does |
|---|---|---|
| `GET    /tasks` | `?project_id=` | list tasks for a project |
| `POST   /tasks` | `{project_id, title, feature?, priority?, description?, origin_quote?, origin_source?}` | create a task (auto-assigns SPD-id) |
| `GET    /tasks/{task_id}` | | get one task (includes grounded node ids) |
| `PATCH  /tasks/{task_id}` | `{title?, feature?, priority?, description?, …}` | update task fields |
| `DELETE /tasks/{task_id}` | | delete a task |
| `POST   /tasks/{task_id}/move` | `{status}` | move task to a new kanban column |
| `PUT    /tasks/{task_id}/nodes` | `{node_ids:[…]}` | set grounded brain-node links |
| `GET    /brain/nodes` | `?project_id=` | list brain nodes |
| `POST   /brain/nodes` | `{project_id, type, label, detail?}` | create a node |
| `PATCH  /brain/nodes/{node_id}` | `{type?, label?, detail?}` | update a node |
| `DELETE /brain/nodes/{node_id}` | | delete a node |
| `GET    /brain/edges` | `?project_id=` | list edges |
| `POST   /brain/edges` | `{project_id, from_id, to_id, rel?}` | create a directed edge |
| `DELETE /brain/edges/{edge_id}` | | delete an edge |
| `POST   /pipelines` | `{project_id, task_id}` | create a pipeline run |
| `GET    /pipelines` | `?project_id=` | list pipeline runs |
| `GET    /pipelines/{run_id}` | | get one pipeline run + stage states |
| `POST   /pipelines/{run_id}/start` | | start the pipeline (spawns Developer agent) |
| `POST   /pipelines/{run_id}/advance` | `{report?}` | manually advance to the next stage |

See [`docs/spade-alignment.md`](docs/spade-alignment.md) for the full product vision and remaining gap-list.

## ⚠ Pattern tuning — the brittle part

**`patterns.yaml` is version-specific and WILL drift when the TUI changes.** It
is the single point of adaptation. The regexes shipped here were *discovered*,
not guessed — captured from the live Claude Code REPL **v2.1.177** into
`fixtures/` and tuned until the tests classified every fixture correctly.

When state detection misbehaves (a prompt hangs, a response comes back empty,
the wrong `State` is reported), the first move is **not** to add retries — it is
to capture the live screen and compare it against your regexes:

1. `python -m tui_pilot.cli dump --cmd claude` and snapshot the misbehaving state.
2. Eyeball `fixtures/<label>.txt` and the relevant regex in `patterns.yaml`.
3. Fix the regex.
4. `.venv/bin/pytest tests/test_screen.py` until green.

Notes specific to the captured version, to illustrate what "tuning" means:

- The spinner is **dingbat stars** (`✳✻✽✶✢`, U+2722–U+273F), not braille.
  `normalize()` strips that sub-range — but deliberately **not** the whole
  dingbats block, because `❯` (U+276F, the prompt marker) lives in it.
- A turn is "active" whenever the footer shows `esc to interrupt`. Within an
  active turn, the presence of the output bullet `⏺` (U+23FA) distinguishes
  STREAMING from THINKING.
- The idle footer differs by mode: `? for shortcuts` (normal),
  `⏵⏵ auto mode on` / `accept edits on` / `⏸ plan mode on`.
- Permission dialogs show `Do you want to proceed?` + numbered `1. Yes` … and
  `Esc to cancel`. **They are not auto-approved** — `prompt()` surfaces
  `AWAITING_PERMISSION` and the caller decides via `approve`/`deny`.

## Testing

```bash
# Offline, deterministic, CI-safe (no live claude needed):
.venv/bin/pytest tests/ --ignore=tests/test_integration.py

# Opt-in live tests (need an authenticated `claude` on PATH), incl. the
# end-to-end harness round-trip (agent emits a signal → answer → finish):
TUI_PILOT_LIVE=1 .venv/bin/pytest tests/test_integration.py -v
```

Offline suite (no live claude): `test_screen.py` (normalize/classify over
fixtures), `test_server.py` (HTTP layer vs a `cat` session), `test_roles.py`
(role presets + metadata), `test_identity.py` / `test_comms.py` /
`test_harness.py` (pure harness units), `test_harness_server.py` (signal/answer/
report/handoff endpoints + concurrency). `test_integration.py` (incl.
`test_harness_round_trip`) is skipped unless `TUI_PILOT_LIVE=1`.

## Out of scope

Auth on the HTTP API; any TUI other than the one demoed (retune `patterns.yaml`
for a different target). (Sessions, roles, projects, accounts and missions *are*
now persisted in SQLite, and live tmux agents are reattached on restart — see
[Persistence, accounts & projects](#persistence-accounts--projects).)
