# Orchestrator — Design

**Date:** 2026-06-14
**Project:** tui-pilot
**Status:** Approved (design); pending spec review
**Builds on:** `docs/superpowers/specs/2026-06-14-agent-harness-design.md` (the harness)

## 1. Purpose

Add a **conversational orchestrator**: one agent you talk to in plain language that
decomposes a goal into sub-tasks, spawns worker agents with the right **model for
each task's complexity**, routes their questions, and reports back. It is
supervised by default (pausing for risky moments) and can be flipped to
hands-off **autopilot** per goal so you don't have to babysit.

Crucially it stays within the project's hard constraint: the orchestrator is
itself a tmux-driven `claude` (no `claude -p`, no SDK, no direct API). It manages
other agents by emitting **orchestration signals** through the existing harness
mailbox, which the control center executes.

### Goals
- A single conversational surface to plan, launch, and steer a fleet.
- Per-task model sizing (cheap for simple, big for hard) with a cost ceiling.
- Supervised-by-default with a per-mission autopilot toggle.
- All "behind the scenes" activity remains visible (fleet board, per-agent
  terminals, activity/cost).

### Non-goals (v1)
- MCP tool-calls for the orchestrator (signals first; MCP is a later option).
- Classifying *which* worker command is risky (all worker permission dialogs are
  treated as one brake — see §7).
- Billed-dollar accounting (token estimates only).
- One-orchestrator-per-mission (a single persistent orchestrator handles all
  missions).

## 2. Key decisions (validated)

| # | Decision |
|---|----------|
| Authority | **Supervised autopilot** by default; per-mission toggle to go hands-off |
| Model policy | **Complexity-based with a configurable ceiling** (default `sonnet`); Opus needs a stated reason and is a brake in supervised mode |
| Brakes (supervised) | **Opus spawn** + **worker permission dialogs** (≈ destructive/deploy/external). Spend/ambiguity/stuck deferred to settings |
| Autopilot scope | Per-mission, default supervised |
| Mechanism | **Orchestration signals** (extend agent-comms); orchestrator is an agent with extra verbs |
| Lifecycle | **One persistent orchestrator**; each goal is a *mission* |
| UI | Chat-primary + behind-the-scenes fleet (model + reason), Agent-terminal tab, Activity & cost page; manual spawn → Advanced |

## 3. The orchestrator agent

- A preset `role: orchestrator` in `roles.yaml`: a long-lived tmux `claude`
  primed with orchestration instructions + the orchestration skill.
- You converse with it via the existing `POST /sessions/{id}/prompt` / `send_text`
  path — it is the only agent you normally talk to directly.
- It is spawned once (lazily on first use) and persists across missions. The UI's
  chat panel is bound to this orchestrator session.
- It runs in `auto` mode (so it can write its own orchestration signal files
  without permission prompts; its mailbox is in its cwd per the harness design).

## 4. Orchestration protocol (extends agent-comms)

The orchestrator emits these **orchestration actions** to its outbox (same
JSON-file mailbox as every agent). They are recognised by an **orchestration
executor** that the orchestrator's poller invokes.

```json
{ "action": "spawn",  "role": "developer", "model": "sonnet",
  "task": "Implement plan.md", "cwd": "/abs/or/null", "mode": "accept-edits",
  "mission": "fb-mockup", "reason": "standard static markup, no hard logic" }

{ "action": "answer", "worker": "<agent-id>", "text": "Postgres" }
{ "action": "kill",   "worker": "<agent-id>" }
{ "action": "status", "text": "planner done; starting developer" }   // narration
```

- `spawn` → control center calls `_spawn_agent(... cmd="claude --model <id>" ...)`.
  **This requires extending `_spawn_agent`/`_meta`/`_info`** with new fields
  `model`, `mission`, `parent`, and `reason` (none exist today — see §9); the UI's
  "why this model" and per-mission grouping read these. Returns the new worker id,
  delivered back to the orchestrator by `send_text` into its session (under the
  *worker's* spawn path, not while holding the orchestrator's lock) so it can
  refer to the worker later.
- `answer {worker, text}` → the executor looks up the worker's **currently-open
  signal id** from `_pollers[worker].open_signal.id` and calls
  `_pollers[worker].answer(that_id, text)`. The orchestrator only needs to name
  the worker; it does NOT need to know the signal id. (If the worker has no open
  signal, this is a no-op with a warning relayed back — §10.)
- `kill {worker}` → `delete_session(worker)`.
- `status` → appended to the mission's activity log / chat narration; no-op on
  the fleet.
- The orchestrator also uses the normal `finished` to close a mission with a
  report.

These extend (do not replace) the worker action set (`ask_question`,
`need_context`, `need_help`, `progress`, `finished`).

## 5. Model selection

- Tier → model id map (in a small `models.py`):
  `haiku → claude-haiku-4-5`, `sonnet → claude-sonnet-4-6`, `opus → claude-opus-4-8`.
  Unknown/absent model → server default (no `--model` flag). **Confirm the exact
  `--model` aliases against the installed Claude Code at implementation time** —
  treat the ids above as the intended tiers, not frozen strings.
- Worker launch command becomes `claude --model <id>` (a `--model` flag is
  interactive-compatible, not one of the forbidden non-interactive flags).
- **Ceiling**: a configurable max tier (default `sonnet`). A `spawn` requesting a
  tier above the ceiling is a brake (see §6): in supervised mode it is surfaced
  to the human for Allow/Skip; on autopilot it proceeds. `reason` is required for
  any `spawn` and displayed.

## 6. Supervised vs autopilot + brakes

Each mission carries `autopilot: supervised | hands-off` (default supervised),
set/flipped from the chat header.

**Routine (always handled by the orchestrator):** spawning workers within the
ceiling; answering worker `ask_question` / `need_context` / `need_help` signals
it is confident about (via answer-routing below); sequencing the work.

**Two distinct signals to watch per worker.** They come from *different* code
paths and must not be conflated:
- **Mailbox blocking signals** (`ask_question`/`need_context`/`need_help`) —
  surfaced by the harness `HarnessPoller` (`HarnessState.kind == "blocked"`);
  resolved by typing text via `poller.answer(...)`.
- **The TUI's own permission dialog** — surfaced by *screen classification*
  (`Controller.state() == AWAITING_PERMISSION`, the `_safe_state` path), NOT by
  the mailbox poller; resolved with `Controller.approve()` / `deny()`
  (Enter / Escape), i.e. the existing `/sessions/{id}/approve` and `/deny`
  endpoints. The orchestration executor must poll worker *screen state* (not just
  the mailbox) to detect this.

**Brakes (pause for the human in supervised mode):**
1. **Opus spawn** — a `spawn` above the ceiling (intercepted in the executor).
2. **Worker permission dialog** — any worker whose screen state is
   `AWAITING_PERMISSION` (≈ destructive / deploy / external side-effect).

On **autopilot**, brakes are not surfaced to the human: the orchestrator decides.
For a worker permission dialog it is asked to choose approve/deny, and the
executor calls `Controller.approve()`/`deny()` accordingly (this is the
approve/deny path, separate from the tmux `answer` text path). It may also spawn
Opus. The human can interject at any time.

**Answer-routing (the "don't babysit" core):** when a worker raises either signal
type, the control center forwards the situation to the orchestrator by typing a
structured note into its session — for a mailbox question:
`worker <id> asks: "<q>" options=[...]; reply with answer{worker,...} or escalate`;
for a permission dialog (we don't parse which command — pass the dialog's raw
text best-effort, per §7):
`worker <id> hit a permission prompt: "<dialog text>"; reply with answer{worker,"approve"|"deny"} or escalate`.
The orchestrator responds with an `answer` signal (the executor routes it to the
right resolution path — `poller.answer` for mailbox questions, `approve()/deny()`
for permission dialogs) or `escalate` which surfaces to the human. In supervised
mode, the pinned brakes bypass the orchestrator and go straight to the human as
an inline **Allow / Skip**.

## 7. v1 simplifications (explicit)

- **Destructive/deploy brake = any worker `AWAITING_PERMISSION`.** We do not
  classify which underlying command is risky; every worker permission prompt is
  treated as the brake. (Confirmed acceptable for v1.)
- Spend-threshold, ambiguity, and stuck/repeated-failure brakes are deferred to
  settings (not built in v1).
- Cost figures are token estimates, not billed dollars.
- One persistent orchestrator (not one-per-mission). (Confirmed.)

## 8. UI

- **Chat + Fleet** (default): left = orchestrator chat where you type goals and
  see its narrated actions (spawns with model+reason, answers it gave) and inline
  **Allow / Skip** brake prompts; right = the mission's fleet (worker cards with
  model badge, "why this model", live state, and a token tally).
- **Agent terminal** tab: open any worker's live screen (reuses the existing
  screen view).
- **Activity & cost** page: per-mission timeline of orchestration events + model
  usage tally.
- Mission selector + per-mission **autopilot toggle** in the header.
- The manual "spawn agent" form (today's primary UI) moves to an **Advanced**
  page; chat is the primary driver.

## 9. Components

- `roles.yaml` — add the `orchestrator` preset.
- `tui_pilot/assets/orchestrator-comms/SKILL.md` — documents the orchestration
  actions (spawn/answer/kill/status) and how to refer to workers by id.
- `tui_pilot/models.py` (new, small) — tier→model-id map + ceiling comparison.
- `tui_pilot/session.py` — build `claude --model <id>` when a model tier is set.
- `tui_pilot/harness.py` — extend the signal model/parser with the orchestration
  actions, kept distinct from worker actions. The orchestrator's poll path
  dispatches orchestration actions to the executor (§ below) while still parsing
  the worker action set, so both coexist on one poller.
- `tui_pilot/orchestration.py` (new) — the executor: given an orchestration
  signal + an injected callback set (`spawn`, `answer_worker`, `approve_worker`,
  `deny_worker`, `kill`, `narrate`), performs the action, enforces the
  ceiling/brakes, and returns a result. Pure-ish (callbacks injected) so it is
  unit-testable without tmux. It resolves a worker's open-signal id (for
  `answer`) and chooses the mailbox-answer vs approve/deny path based on the
  worker's current state.
- `tui_pilot/server.py` — **extend `_spawn_agent`/`_meta`/`_info` with new fields
  `model`, `mission`, `parent`, `reason`** (additive schema change; today's meta
  has none of these); wire the executor into the orchestrator's poll path; poll
  each worker's *screen state* (for the `AWAITING_PERMISSION` brake) in addition
  to its mailbox; mission tagging; per-mission autopilot; worker-question →
  orchestrator routing; brake → human (supervised) vs orchestrator (autopilot);
  endpoints:
  `POST /orchestrator` (ensure/spawn + chat), `GET /missions`,
  `POST /missions/{id}/autopilot`, `GET /missions/{id}` (fleet + activity).
- UI (`static/`) — chat panel, fleet-with-models, agent-terminal tab,
  activity/cost page, advanced page.

## 10. Error handling

- **Malformed orchestration signal** → quarantined (like worker signals); a
  `status` note surfaces the parse error to the chat; never crashes the poller.
- **`spawn` for an unknown role** → falls back to a plain agent with the given
  model/cmd (consistent with the harness's tolerant `_spawn_agent`); a note is
  shown.
- **`answer`/`kill` for an unknown/dead worker** → no-op with a warning relayed
  to the orchestrator.
- **Orchestrator session dies** → UI shows it as down with a "restart
  orchestrator" action; in-flight missions' workers keep running and are
  re-attachable.
- **Ceiling/brake while supervised and the human is away** → the action waits
  (worker stays blocked / spawn stays pending) until the human responds or the
  mission is flipped to autopilot.
- **Routing loop guard** → a worker question forwarded to the orchestrator that
  the orchestrator can't answer escalates to the human rather than bouncing.

## 11. Testing

- **Offline unit:** orchestration-signal parsing (valid + malformed); tier→cmd
  mapping and ceiling comparison; executor behaviour for spawn/answer/kill/status
  with injected callbacks; brake enforcement (Opus spawn + worker
  `AWAITING_PERMISSION`) for supervised vs autopilot; answer-routing decision
  (worker blocked → forwarded → orchestrator answer relayed); mission tagging.
  All without a live claude.
- **Server (TestClient):** orchestrator endpoints and a simulated orchestration
  signal driving a `cat` worker (spawn/answer/kill), against per-cwd mailboxes.
- **Live (opt-in, `TUI_PILOT_LIVE=1`):** a real orchestrator runs a 2-step
  mission (planner on haiku → developer on sonnet) on autopilot and reports the
  mission finished; assert workers were spawned with the requested models and a
  report was captured.

## 12. Open items deferred to planning

- Exact chat-history rendering (the orchestrator's conversation vs. its narrated
  actions) and how worker ids are surfaced to the orchestrator.
- Whether `escalate` is a distinct action or just the orchestrator declining to
  answer.
- Settings surface for the ceiling default and the optional brakes.
- The per-worker screen-state poll (for the permission brake) should ride the
  **existing ~1s poll loop** (a lock-free `_safe_state` read), not a second
  thread — confirm at planning time.
- Confirm there is no worker-side turn timeout that would abandon a permission
  dialog left pending while a supervised brake waits for the human.
