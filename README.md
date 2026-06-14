# tui-pilot

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
| `POST   /sessions`                  | `{name, role?, task?, cmd?, instructions?, mode?, cwd?}` | spawn an (optionally role-based) agent, optionally with a mission |
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

Persisting sessions across server restarts; auth on the HTTP API; any TUI other
than the one demoed (retune `patterns.yaml` for a different target).
