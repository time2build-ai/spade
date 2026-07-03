# Task-Type Router & Per-Kind Lifecycles — Design

**Date:** 2026-07-03
**Status:** Approved (brainstorming), pending implementation plan
**Builds on:** `2026-07-02-task-lifecycle-v2-design.md` (implemented on `feat/task-lifecycle-v2`, not yet merged). This spec assumes Task Lifecycle V2 lands first.

## Problem

Task Lifecycle V2 forces **every** task through one coding lifecycle: shaping →
plan gate → worktree build → test gate → PR → review → merge gate → shipped. That
is wrong for non-coding work. A **research** task (investigate this codebase, or
research a topic on the web) has nothing to build, no tests, no PR to merge — it
would hit the "no changes produced" escape hatch and land in **blocked**, or
produce a meaningless empty PR. A **docs** task (a client SOW or explainer) should
produce a polished, shareable document, not a git commit.

The fix is a **router** that classifies each task into a **kind**, and a set of
**per-kind lifecycle templates** that the existing graph state machine runs —
including a **parallel fan-out** for research (several investigators, then a
manager that synthesizes one report).

## Goals

1. Support three task kinds in the first cut: **Code** (existing), **Research**,
   **Docs** — each with its own lifecycle, reusing the V2 engine (gates,
   artifacts, activity notes, blocked, session dedup).
2. A **router** that AI-classifies a task's kind (title + description), suggests
   it for one-click confirm/override, and back-fills existing untyped backlog
   tasks.
3. A **fan-out** engine primitive: a phase can run N agents in parallel and
   advance only when all finish. Research uses it; it is general.
4. **Docs** produces a standalone, styled, shareable client deliverable (SOW /
   Explainer) with diagrams — no repo, no PR, no merge.
5. One **universal board** across all kinds, with a kind badge, precise phase per
   card, the existing amber gate overlay, and a kind filter.

## Non-Goals

- Decision/ADR and Spike kinds (deferred; trivial to add once the registry
  exists).
- Auto-start/full-autopilot routing (the seam is provided via the existing
  `autopilot` flag; behavior deferred — this cut always asks you to confirm the
  kind / start).
- Environment promotion for Research/Docs (Releases stays Code-only; those kinds
  terminate at *delivered*, they don't promote).
- Fan-out for Code/Docs (the primitive is general, but only Research's
  investigating phase enables it now).

## Terminology

- **Kind** — `code | research | docs`, the task's type; picks the lifecycle
  template.
- **Lifecycle template** — the phase graph + gates + terminal + board-column
  mapping for a kind.
- **Fan-out phase** — a phase that spawns N parallel agents and advances when all
  finish (barrier).
- **Angle** — one unit of a research plan; one fan-out agent works one angle.
- **Deliverable** — the terminal output of a non-code kind (a report; a styled
  doc). Terminal status `delivered` (vs. `shipped` for code).

---

## Approach

Generalize the V2 engine from one hardcoded graph to a **template registry** the
engine reads per run; add a **fan-out** primitive; add a small **router**; add a
**styled-doc** artifact renderer + shareable route. Everything else in V2 (gate
CRUD, artifact CRUD, activity notes, blocked/retry, `last_finished_session`
dedup, poll-loop collector/drainer, `_lifecycle_git` for code) is reused.

Rejected alternatives:
- **A separate engine per kind** — duplicates the state machine three times;
  the V2 engine is already graph-based, so a per-kind template is the smaller,
  DRY change.
- **Manual-only kind dropdown (no router)** — friction on every task and no help
  for the tasks already sitting untyped in the backlog. The router keeps a cheap
  human veto but does the classification.

---

## 1 · Kinds & Lifecycle-Template Registry

### `tasks` changes
- `kind TEXT` — `code | research | docs`, nullable until routed; locked at Start.
- `kind_suggested TEXT` — the router's proposal (shown as a confirm/override chip).
- `kind_reason TEXT` — the router's one-line justification (tooltip).

### `lifecycle_runs` change
- `kind TEXT` — copied from the task at `start_run`, so a run is self-describing
  and the engine never re-reads the task to know its template.

### Statuses (keeps V2's status = phase mirror)
V2's invariant holds unchanged: `tasks.status` **mirrors the active run's phase**
(identical names), and `tasks.move` is the single writer. Generalizing to three
kinds therefore means **every new phase name is a status**. `tasks.STATUSES`
gains the union of all templates' phases plus the new terminal:

`scoping, investigating, synthesis` (research), `outline, drafting, review`
(docs), and `delivered` (research/docs terminal). `shipped` stays Code's
terminal. Code's phases (`shaping, plan_review, building, pr_review, shipped`) are
already in STATUSES from V2.

**Status derivation (extends V2's table):**

| run state | task status |
| --- | --- |
| no active run | `ready` |
| active run, phase = P | `P` (the phase name) |
| terminal, kind=code | `shipped` |
| terminal, kind=research/docs | `delivered` |
| phase `blocked` | `blocked` (banner) |

So the board still groups by `tasks.status`; the universal **column** for a card
is a pure lookup `column_for(kind, status)` using the template's per-phase
`column` field (§6) — no separate "read run.phase" path.

### `LIFECYCLE_TEMPLATES` (a registry, `lifecycle_templates.py`)
A pure-data description per kind. Each template lists ordered **phases**; each
phase has:

| field | meaning |
| --- | --- |
| `name` | phase id (e.g. `shaping`, `scoping`, `investigating`) |
| `agent` | bool — does it spawn an agent |
| `fanout` | bool — does it spawn N agents (barrier) |
| `gate` | gate id opened when this phase finishes (or null) |
| `column` | which universal board column this phase maps to |
| `terminal` | bool + terminal status (`shipped`/`delivered`) |

`advance()` / `decide_gate()` consult `LIFECYCLE_TEMPLATES[run["kind"]]` to find
the current phase, its gate, and the next phase — replacing V2's hardcoded
`code`-only transitions. The **Code** template is exactly the V2 graph (no
behavior change for code tasks).

**Transition guard** for `tasks.move` is derived at the **phase level** (matching
V2's precision, not the coarser column level): the legal set is the **union of
each template's consecutive-phase pairs** (`shaping→plan_review`,
`scoping→investigating`, `outline→drafting`, …) plus V2's special rules
(`any→blocked`, `blocked→<resume>`). A column-level guard would be lossy (Code's
`shaping` and `plan_review` both map to the Planning column, so a column guard
couldn't reject an illegal jump between them) — so the guard stays phase-level and
`column` is used **only** for board grouping (§6), never for transition legality.

**Unit boundary:** the registry is pure data + a `template_for(kind)` accessor and
a `phase_after(kind, phase)` / `gate_for_phase(kind, phase)` helper. The engine
depends only on those accessors, not on any kind's specifics.

---

## 2 · Fan-Out Engine Primitive

V2 phases spawn one agent and advance on that agent's `finished` (deduped by
`last_finished_session`). A **fan-out** phase spawns N and advances only when all
N finish.

### `fanout_agents` table
`(id, run_id, phase, idx, angle, session_id, account_id, status, report_artifact_id,
created_at, updated_at)`. One row per angle.

### Entering a fan-out phase
The engine reads the **approved plan** (the N angles, produced by the prior phase
and approved at that phase's gate), inserts N `fanout_agents` rows, and spawns N
agents via the existing `_spawn_agent` — each with its own scratch `cwd`, each
`_meta` stamped `lifecycle_run_id`, `lifecycle_phase`, and a new
`lifecycle_fanout_idx` so the poll loop can tie a finished agent to its row.

### Barrier (poll-loop collector) — dedup & once-only advance
V2's single run-level `last_finished_session` cannot dedup N concurrent sessions
(one field can't remember N ids), so fan-out dedups **per row** instead:

On a fan-out agent's `finished`, keyed by its `lifecycle_fanout_idx`:
1. **Per-row idempotency:** if that `fanout_agents` row is already `done` (a
   duplicate/late `finished`), ignore it — do nothing. Otherwise mark the row
   `done` and store its report as a per-angle artifact (`kind=finding`).
2. **Once-only advance:** re-read all rows for `(run_id, phase)`. Advance to the
   next phase (spawning the synthesis agent with all N reports) **only** in the
   transaction that flips the **last** row from not-done to `done` — i.e. the
   advance is performed inside the same guarded step that completed the row, and
   is gated on `run.phase == <this fanout phase>`. A late `finished` arriving
   after the run already advanced hits either the per-row idempotency check (row
   already `done`) or the phase guard (run no longer in the fan-out phase), so it
   cannot double-advance or re-spawn synthesis.

This is the per-row analogue of V2's `last_finished_session` dedup + the V2
`advance` phase guard, extended to N sessions. The single-agent path is unchanged
(a non-fanout phase advances immediately via V2's existing dedup).

### Failure
A fan-out agent that dies → its row `blocked`; the phase surfaces as blocked with
a **retry-this-angle** action (`POST /lifecycle/{run}/fanout/{idx}/retry`) that
re-spawns just that angle. Synthesis cannot start until every angle is `done` or
explicitly **dropped** (`POST .../fanout/{idx}/drop`, logged as a system note).
One bad agent never wastes the other N.

### Concurrency
Rides the existing account pool + tmux spawn; N is bounded by free accounts,
excess angles queue (the pool already serializes). No new scheduler.

---

## 3 · The Router (`router.py`)

Classifies a task into `code | research | docs` from title + description.

### Classification
A single cheap one-shot LLM call (small model, via the existing account/model-tier
infra — NOT a full agent session) with a tight prompt returning
`{kind, reason, doc_template?}` (`doc_template` — `sow`/`explainer` — is suggested
only when `kind=docs`, and is itself human-confirmable). A **keyword fallback**
(`research|investigate|compare|analyze` → research; `sow|doc|explainer|write-up`
→ docs; else `code`) runs when no account is free, so routing never blocks task
creation.

**Unit boundary:** `router.classify(title, description) -> {kind, reason,
doc_template?}` is the only interface; the LLM-vs-fallback choice is internal.

### When it runs
- **On task creation** → sets `kind_suggested` + `kind_reason`. The card shows the
  suggestion with one-click **confirm** or a kind **picker** to override.
- **Back-fill** → `POST /projects/{id}/route-untyped` classifies every
  `kind`-less task for the project in one batch (UI action "Auto-tag N untyped
  tasks"), so nothing is stuck untyped.

### Confirm & lock
`kind` is set on confirm (or implicitly by hitting **Start**). Before Start it is
freely changeable; at Start it locks (it selects the template). Post-Start kind
changes are disallowed — cancel + restart (rare; a forced change is a logged
system note). The per-project `autopilot` flag is the seam for a later
auto-confirm/auto-start, out of scope here.

---

## 4 · Research & Docs Lifecycle Specifics

### Research template
`code-research` and `general-research` are the **same** template; they differ only
in the tools each investigating agent is told to use.

- **Scoping** (agent) — sharpens the question, grounds against the Product Brain,
  proposes a **research plan**: N angles, each with a one-line brief + a
  `mode` (`repo` or `web`). Registers the plan as an artifact (`kind=plan`).
  → **Scope gate**: you approve/edit the angles (editing the plan artifact adjusts
  N before fan-out).
- **Investigating** (fan-out) — one agent per angle. `repo` angles get repo tools
  (grep/read); `web` angles invoke the **`deep-research`** skill (web fan-out +
  source fetch + verification). Each returns a per-angle **findings** artifact.
- **Synthesis** (agent — the "research manager") — runs a **verify pass**
  (cross-checks conflicting findings across angles, flags unsupported claims),
  then writes one **final report** artifact. It may propose **follow-up tasks**
  and **Product Brain nodes**, created only on acceptance at the review gate.
  → **Review gate**: you read the final report.
- **Delivered** — final report + all per-angle findings pinned; accepted
  follow-up tasks / brain nodes created (via existing `tasks.create` /
  `brain` APIs).

### Docs template (standalone client deliverable)
- **Outline** (agent) — the kind is `docs`; the specific template (**SOW** or
  **Explainer**) is suggested by the router (`classify` returns `doc_template`
  when `kind=docs`) and confirmable by you at creation, stored on the task
  (`doc_template`). The agent drafts the section outline for that template.
  Registers an **outline** artifact. → **Outline gate**: approve the structure
  before the full draft (saves rework on a client SOW).
- **Drafting** (agent) — writes each section, generates **mermaid** diagrams, and
  applies the **house style** (a shared theme-aware HTML/CSS shell so every
  SOW/Explainer looks consistent). Output is a **styled document** artifact
  (`kind=doc`).
- **Review gate** → **Delivered** — the doc gets a read-only **shareable link**
  (`/doc/{id}`) and **print/export-to-PDF** (browser print of the styled HTML).
  No repo, no merge.

### Doc templates as data
Each doc template = a structured prompt (required sections for that template) +
the shared HTML/CSS shell. `SOW` and `Explainer` ship first; adding `Tech-design`
later is one registry entry. Stored in `doc_templates.py` (pure data), consumed by
the drafting agent's prompt and the renderer.

### `tasks` addition for docs
- `doc_template TEXT` — `sow | explainer` (null for non-docs).

---

## 5 · Deliverable Rendering & Artifacts

- **Research** artifacts: `plan`, `finding` (one per angle), `report` (final). The
  task view groups per-angle findings under the final report.
- **Docs** artifacts: `outline`, `doc` (the styled deliverable).
- The existing artifact drawer renders markdown for `plan`/`finding`/`report`/
  `outline`. A new **styled-doc renderer** mode renders the `doc` artifact's
  themed HTML (with mermaid) and powers the `/doc/{id}` shareable route + print.
- Reuse: artifacts, `repoint_to_branch` is code-only and simply never called for
  research/docs (their artifacts are not in a repo branch — they store content
  directly; see storage note below).

### Storage note
Code artifacts point at a repo path+branch (V2). Research/Docs artifacts are **not
in a repo**, so `artifacts` gains an optional `content TEXT` column: when
`repo_path` is null, the artifact's content is stored inline (the report / doc
HTML / findings markdown). The drawer/renderer reads `content` when `repo_path` is
null, else reads from the branch (V2 behavior). This is the one schema change that
touches a V2 table, and the V2 artifact writer (`artifacts.register`, which took
`repo_path`/`branch`) gains an optional `content` parameter. `repoint_to_branch`
is never called for research/docs (they never run `merge()`), so the two paths
don't interact.

### Fan-out concurrency note
A `web` investigating agent invokes the `deep-research` skill, which itself fans
out web searches **inside that single agent session**. The account-pool bound (§2)
therefore governs only the **outer** fan-out agents (one per angle); the inner
deep-research concurrency lives within one session and is not multiplied by the
pool.

---

## 6 · Board / UI

### Universal board (replaces the 6 code columns)
Five columns: **Ready · Planning · In progress · Review · Done**. Each kind's
phases map on via the template `column` field:

| kind | Planning | In progress | Review | Done |
| --- | --- | --- | --- | --- |
| Code | shaping, plan_review | building | pr_review | shipped |
| Research | scoping | investigating (fan-out) | synthesis | delivered |
| Docs | outline | drafting | review | delivered |

This table is **illustrative** — the authoritative mapping is the `column` field
defined on **every** phase in each template (§1). Every phase maps to exactly one
column; `ready→Ready` and `blocked→`(banner) are handled outside the table. Code's
`plan_review` phase maps to Planning (its plan gate paints that card amber);
`manual_test` is a gate (not a phase) opened during `building`, so it paints the
In-progress card amber; merge/review/scope/outline gates paint their column's card
amber. The amber overlay = any waiting gate, unchanged from V2.

- Cards gain a **kind badge** (✨ Code / 🔬 Research / 📄 Docs) + the precise phase
  label; fan-out cards show **"▶ N agents"**.
- A **kind filter** (All / Code / Research / Docs) and a **"Waiting on you"**
  view that shows only gated cards across all kinds (the distraction-friendly
  "what needs me?" default).
- `tasksByStatus` becomes `tasksByColumn(task, template)`; the board reads the
  column from the task's kind+phase.

### Task view
- Existing artifacts panel + gate bar (kind-agnostic) reused.
- Add the **styled-doc renderer** for `doc` artifacts and a **per-angle findings**
  group for research.
- Add the **kind badge** + the router **suggestion chip** (confirm / override
  picker) while the task is untyped/Ready.

### New surfaces
- Read-only **`/doc/{id}`** shareable route for docs deliverables (+ print).
- **"Auto-tag untyped tasks"** backlog action → `route-untyped`.
- Releases page stays **Code-only** (guarded: research/docs never appear there).

### Transition guard
`tasks.move` legality is derived from the union of each template's
**consecutive-phase pairs** (§1) plus the existing `any→blocked` /
`blocked→<resume>` rules — a phase-level guard, matching V2's precision. `column`
is used only for board grouping here, never for transition legality.

---

## 7 · Failure Handling

Reuses V2's rule — **no failure is silent; every failure lands as a gate or a
`blocked` state with evidence**:
- A fan-out angle dies → its row `blocked`; **retry-this-angle** re-spawns just
  it; synthesis waits until all angles are `done`/`dropped`.
- Router LLM unavailable → keyword fallback; task creation never blocks.
- Kind not in the registry at Start → clear error (can't start an unknown kind).
- Docs/research agents that fail parse or produce nothing → the V2 defensive-parse
  path (`blocked` + system note), unchanged.

---

## 8 · Testing Strategy

Matches repo conventions (`.venv` pytest, in-memory SQLite via `db._migrate`).

- **Registry** — each template's graph is well-formed (every phase has a valid
  column; terminal reachable; gates reference known ids).
- **Router** — `classify` fixtures per kind + the keyword fallback when the LLM
  path is stubbed unavailable.
- **Fan-out** — N fake agents: advance only when all done; one-dies → phase
  blocked → retry-one → completes; drop-one → synthesis proceeds. Barrier never
  advances early.
- **Research/Docs end-to-end** — fake agents drive `ready → delivered` across the
  scope/outline + review gates, asserting artifacts (plan/findings/report;
  outline/doc), notes, and terminal status `delivered`.
- **Board** — `tasksByColumn` maps each kind's phases to the right universal
  column; amber overlay on gated cards.
- **Client** — Playwright for the universal board + kind filter + "Waiting on
  you" view, the styled-doc renderer, and the `/doc/{id}` shareable route.

---

## Migration & Rollout

1. Add `kind`/`kind_suggested`/`kind_reason`/`doc_template` to `tasks`, `kind` to
   `lifecycle_runs`, `content` to `artifacts`, and the `fanout_agents` table — via
   `schema.sql` + `db._ADDED_COLUMNS`. Existing tasks default to `kind=null`
   (untyped) and get back-filled by the router action; existing V2 code runs are
   unaffected (their `kind` back-fills to `code`).
2. Land `lifecycle_templates.py` (with the Code template = the current V2 graph,
   asserted behavior-identical) + the fan-out primitive + `router.py` +
   `doc_templates.py`.
3. Generalize the board + task view + add the doc renderer / shareable route.
4. Ship behind the assumption that V2 is merged; Code tasks behave exactly as
   today.

Steps 1–2 (schema + registry + fan-out + router, all backend) are independently
testable and shippable before the UI generalization in step 3 — Code tasks keep
working throughout, and Research/Docs become drivable via the API before the board
is generalized.

## Open Questions (non-blocking)

- Router model tier — default to the cheapest available; make configurable if
  misclassification is frequent.
- Whether `general-research` web angles should always use `deep-research` or a
  lighter single-agent web search for small questions — default to
  `deep-research`, revisit if it's overkill for one-angle tasks.
- PDF export fidelity — browser print of the styled HTML first; a real PDF
  pipeline only if clients need pixel-perfect output.
