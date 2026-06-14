# Agent Harness — Design

**Date:** 2026-06-14
**Project:** tui-pilot
**Status:** Approved (design); pending spec review

## 1. Purpose

tui-pilot can already spawn role-based, mission-driven `claude` agents in tmux and
manage several at once. This design adds a **harness**: a structured,
bidirectional protocol that lets every agent — regardless of which directory it
runs in — signal a central control center when it needs input, is blocked, wants
to report progress, or has finished. A human answers those signals today; the
design leaves a clean seam for a manager/PM agent to auto-answer later.

The result is a managed *fleet*: scattered, independent agent instances become
observable and steerable from one place.

### Goals
- Generic actions that work for any role/agent type (not Claude-specific beyond
  the existing tmux mechanics).
- Reliable detection of agent signals across agents living in **many different
  directories**.
- A clean finish/handoff model: an agent produces a **report** (the baton), and
  optionally triggers a successor agent that consumes it.
- Stay within tui-pilot's hard constraint: control is via tmux keystrokes +
  screen/file observation only — no `--print`, `--output-format`, SDK, or other
  headless interfaces. (A small filesystem side-channel for signals is the one
  deliberate addition, and it is an *artifact* the agent writes, not a control
  interface into it.)

### Non-goals (v1)
- Parallel `delegate` (an agent spawning a helper while it keeps working).
- The PM/manager agent itself (only the pluggable seam for it).
- Cross-machine hubs, authentication, persistence across server restarts.

## 2. Key decisions (validated)

| # | Decision |
|---|----------|
| Communication | **File mailbox** in a **central hub** keyed by agent id |
| Hub layout | `~/.tui-pilot/comms/<agent-id>/{outbox,inbox,handoffs}/` |
| Reply path | Typed into the agent via **tmux send-keys** (existing `prompt()` path); `inbox/` is a structured backup |
| Identity | `id = slug(name) + "__" + short-token`; token (counter+time+random, base32) is the **only** source of uniqueness |
| id usage | `id` is the tmux session name **and** the hub folder (removes today's duplicate-name `409`) |
| Display | `name` + `cwd` are metadata; UI always shows `cwd` to disambiguate same-named agents |
| Actions | `ask_question`, `need_context`, `need_help`, `progress`, `finished` |
| Handoff | Folded into `finished`: always writes a **report**; optional `next` spawns a successor |
| `next.start` | Default **`confirm`** (UI button); `auto` available per-handoff |
| On finish | Default **park** (mark DONE, keep inspectable); one-click Archive&Kill; auto-kill is a setting |
| Routing | **Human answers (v1)** via a **pluggable answerer interface**; PM agent is a drop-in later |
| Teaching | A **skill** in the agent's `.claude/skills/agent-comms/` + a priming line; id + hub path injected at spawn |

## 3. Communication architecture

### 3.1 The hub
A single root the control center watches:

```
~/.tui-pilot/comms/
  <agent-id>/
    outbox/      # agent → control center (one JSON file per signal)
    inbox/       # control center → agent (structured reply backup)
    handoffs/    # finished reports (the baton), copied here for archival
    processed/   # outbox signals moved here once handled (idempotency)
```

Because comms are keyed by **agent identity**, an agent's working directory is
irrelevant to the control plane — "agents in many directories" is not a special
case. Work artifacts (code, `plan.md`, the report) still live in the agent's
project `cwd`; signals reference them by absolute path, and `finished` reports
are additionally copied into `handoffs/`.

### 3.2 Identity / key
- `slug` = sanitized display name (lowercase kebab, ≤16 chars), cosmetic, may repeat.
- `token` = server-generated unique string (monotonic counter + time + small
  random, base32), e.g. `k7x9q2`. Generated in the FastAPI server (plain Python;
  `uuid`/`time` are available — the no-random rule applies only to Workflow
  scripts, not the server).
- `id = f"{slug}__{token}"`, e.g. `dev-1__k7x9q2`. The separator is a double
  underscore: ASCII-safe for tmux session names and folder names, and
  unambiguously splittable (`id.rsplit("__", 1)`) even when the slug contains
  hyphens. Used as the tmux session name and hub folder. Collisions are
  impossible regardless of identical names or cwds.
- The server stores `{id, name, cwd, role, mode, ...}`; the UI shows `name` + `cwd`.

**API migration (breaking).** Today `server.py` keys `_sessions`/`_meta`/`_locks`
by `name`, and routes are `/sessions/{name}`. This design re-keys the registry by
`id` and the path param becomes `{id}` (e.g. `/sessions/{id}/state`). `POST
/sessions` returns the generated `id`; the UI uses `id` for all subsequent calls
and shows `name`+`cwd` for humans. The planner should treat this as an API change
to existing endpoints, not a purely additive feature.

### 3.3 Signal schema (outbox JSON)

```json
{
  "id": "sig-<token>",          // unique signal id (for reply correlation)
  "action": "ask_question | need_context | need_help | progress | finished",
  "text": "human-readable message",
  "options": ["...", "..."],     // optional; ask_question preset choices
  "refs": ["/abs/path/to/file"], // optional; attached artifacts by path
  "report": "markdown string",   // finished only: the handoff document
  "next": {                       // finished only, OPTIONAL: spawn a successor
    "role": "developer",
    "task": "Implement plan.md",
    "mode": "auto",
    "start": "confirm"            // "confirm" (default) | "auto"
  },
  "ts": "<iso8601>"
}
```

### 3.4 Action semantics

| action | class | meaning | control center response |
|--------|-------|---------|--------------------------|
| `ask_question` | blocking | needs a decision; optional preset `options` | surface answer card → type reply via tmux |
| `need_context` | blocking | missing info/files/credentials/access | surface → type reply via tmux (the answer text can name a path the agent should read) |
| `need_help` | blocking | stuck on an error/loop; wants intervention | surface (with `refs`) → type advice, or "take over" |
| `progress` | non-blocking | status heartbeat | append to a quiet timeline; no reply |
| `finished` | terminal | mission complete; writes `report` (+ optional `next`) | capture report → mark DONE → (if `next`) spawn successor → park/kill |

### 3.5 Blocking + reply mechanics
A blocking signal works *with* the interactive REPL, not against it:
1. The agent (instructed by its skill) writes the signal file to `outbox/`.
2. The agent **ends its turn** and goes IDLE — it does not busy-wait.
3. The control center's poller sees the new file, sets the session's
   **harness-state** to `blocked:<action>`, and surfaces the answer card.
4. A human (or, later, the PM agent) answers; the control center **types the
   answer into the agent via `send_text()`** (the existing prompt path).
5. The agent receives the answer as its next user message and continues.
6. The handled signal is moved to `processed/` for idempotency.

**Turn model & the per-session lock (integration note).** Today `_prime()`
runs a mission as a single `ctrl.prompt(task, timeout=1800)` that holds the
per-session lock until the turn ends. Under the harness a mission is **not** one
long blocking call: each agent turn ends when the agent goes IDLE (including when
it emits a blocking signal and stops), which releases the lock. The harness then
inspects `outbox/`; the next input (an answer, or a "continue") is sent as a
**new** turn via `send_text()` under a fresh lock acquisition. So spawning fires
the mission turn-by-turn (non-blocking from the server's perspective), and an
answer never contends with a still-held mission lock. The session's
harness-state — not a held lock — is what tracks "this agent is blocked".

**At most one open blocking signal per agent.** Because a blocking signal ends
the agent's turn, an agent cannot have two blocking signals open at once. A
non-blocking `progress` is fire-and-forget and may be emitted just before a
turn ends; it never blocks and is simply appended to the timeline. The poller
therefore only ever tracks a single `blocked:<action>` per session.

**`inbox/` is backup-only in v1.** The live reply path is tmux (`send_text()`),
which the agent receives as its next message — so the comms skill only teaches
the agent to *write* `outbox/`, not to poll `inbox/`. `inbox/` is written for
auditability/structured record and reserved for a future pull-based reply mode;
agents are not required to read it in v1.

## 4. Finish / handoff lifecycle

`finished` is the single terminal signal; `handoff` is **not** a separate action.

When a `finished` signal arrives, the control center:
1. **Captures** the `report` → writes it to the project (`SUMMARY.md`,
   **overwriting** any existing one, matching the planner's existing `plan.md`
   behavior) and copies it to `handoffs/<id>-<ts>.md`; marks the session **DONE**.
2. **If `next` present** → spawns the successor agent (role + task + mode; `cwd`
   defaults to the finishing agent's cwd) and injects the report as context.
   `start:"auto"` spawns immediately; `start:"confirm"` (default) shows a
   "Spawn ▶" button first.
3. **Tears down** the finishing session — default **park** (DONE, inspectable,
   one-click Archive&Kill); auto-kill is an opt-in setting.

State machine: `WORKING → FINISHED (report captured) → [spawn child if next] → PARKED/KILLED`.

The dead session is never needed for the handoff, because the **control center**
performs the spawn — the agent only declares intent.

### Report format (handoff document)
A markdown document with fixed sections so it is useful to both humans and
successor agents:
- `# Done` — what was accomplished
- `# Current state` — where things stand now
- `# What's next` — recommended next steps
- `# Open questions` — unresolved decisions
- `# Artifacts` — files/paths produced (absolute paths)

## 5. How agents learn the protocol
- A small skill is installed into each agent's `.claude/skills/agent-comms/`
  (`SKILL.md`), teaching the mailbox protocol and the signal schema.
- The role's priming message includes one line pointing at it and stating the
  agent's `id` + absolute hub path (injected by tui-pilot at spawn, since it
  already knows the cwd and assigns the id).
- The same pipe applies to every role; only role instructions/missions vary.

## 6. Control-center UI
- **Fleet list** grouped: **Needs attention → Working → Idle**. Blocking agents
  float to the top with a 🔴 marker. Cards show emoji, `name`, `cwd`, role,
  state, harness-state.
- **Focused agent**: open blocking signal rendered as an **answer card** (preset
  option buttons + free-text box) above a **read-only live screen**. Sending an
  answer types it into the agent via tmux.
- **Global Inbox** (v1): a list of all open signals across the fleet, each with
  the same answer card, for triage without switching focus.
- **Progress timeline**: non-blocking `progress` notes shown as a quiet log.
- **Report viewer**: a finished agent's report shown in a panel with
  "Archive & kill" and (if `next`) "Spawn successor ▶".

## 7. Components

### Backend
- `tui_pilot/comms.py` — hub path resolution; atomic write/read/scan of signals;
  move-to-`processed`; report archival. Pure-ish, unit-testable.
- `tui_pilot/harness.py` — per-session poller that scans `outbox/`, parses +
  validates signals, derives harness-state, and drives finish/handoff
  orchestration. A pluggable `Answerer` interface (human via UI = default;
  PM-agent = future).
- `tui_pilot/identity.py` — id/token generation + slug sanitization.
- `tui_pilot/server.py` (extend) — endpoints: list signals, answer a signal,
  fetch report, spawn-from-handoff; include harness-state in session info.
- Session spawn (extend) — assign id, create hub dirs, install the comms skill,
  inject id + hub path into priming.

### Protocol assets
- `skills/agent-comms/SKILL.md` — the protocol skill installed into agents.
- `report-template.md` — the handoff report skeleton.

### UI
- Attention grouping + harness-state on cards; answer card; global Inbox;
  progress timeline; report viewer.

## 8. Error handling
- **Malformed signal JSON** → quarantined to `processed/` with an `error` badge
  surfaced in the UI; never crashes the poller.
- **Agent dies mid-block** → poller detects `is_alive() == False`; session marked
  EXITED; any open signal flagged "agent gone".
- **Duplicate/replayed signal** (same signal id) → ignored once in `processed/`.
- **Handoff spawn failure** → finishing session stays PARKED with an error; the
  report is still saved; user can retry the spawn.
- **Reply to a no-longer-blocked agent** → no-op with a warning (the agent may
  have timed out or been interrupted).
- **Multiple open signals per agent** → not possible for blocking signals (a
  blocking signal ends the agent's turn; see §3.5). A `progress` emitted just
  before another signal is appended to the timeline and never competes for the
  single `blocked:<action>` slot.

## 9. Testing
- **Offline unit:** signal parse/validate (happy + malformed), id/token
  uniqueness across many generations, finish→report→`next` orchestration against
  a fake session, poller harness-state transitions, comms file atomicity +
  idempotency (move-to-processed). All without a live claude.
- **Server (TestClient):** signal list/answer/report endpoints against a
  deterministic `cat` session.
- **Live integration (opt-in, `TUI_PILOT_LIVE=1`):** one real agent emits
  `ask_question` → control center answers via tmux → agent continues → emits
  `finished` with a report; assert report captured and (with `next`) successor
  spawned.

## 10. Open items deferred to implementation planning
- Exact poll interval / debounce for the outbox watcher.
- Whether to also emit the optional one-line screen "ping" (hybrid detection) if
  folder polling proves too slow — deferred; file-watch is the v1 default.
- Settings surface for park-vs-auto-kill and confirm-vs-auto defaults.
