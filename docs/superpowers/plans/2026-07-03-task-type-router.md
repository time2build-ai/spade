# Task-Type Router & Per-Kind Lifecycles — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a task-type router (code/research/docs) and per-kind lifecycle templates on top of the V2 engine, so non-coding tasks get their own flows — including a parallel fan-out for research and a styled shareable deliverable for docs.

**Architecture:** Generalize the V2 lifecycle engine from one hardcoded graph to a **template registry** the engine reads per run; add a **fan-out** primitive (a phase runs N agents, advancing on an all-done barrier); add a small **router** that classifies a task's kind; add **Research** and **Docs** phase handlers, **doc templates**, a **styled-doc renderer** + shareable route; generalize the board to universal columns. Everything V2 built (gates, artifacts, notes, blocked/retry, session dedup, poll-loop collector/drainer, `_lifecycle_git`) is reused.

**Tech Stack:** Python 3 / FastAPI / SQLite (WAL, `db.py`), tmux agents + mailbox harness, `gh`/`git`, Next.js App Router + SWR, Playwright.

**Spec:** `docs/superpowers/specs/2026-07-03-task-type-router-design.md`

**Builds on:** `feat/task-lifecycle-v2` (V2 engine). This plan is authored to execute **after V2 is merged to `development`** (or on a branch off V2). All file references below are to the V2 codebase.

**Conventions (verified in-repo):**
- Tests: `apps/api/tests/test_*.py`; run `cd apps/api && ../../.venv/bin/python -m pytest <args>` (per-test temp SQLite via `conftest.py`). Full suite `make test`.
- DB: new tables in `schema.sql` (CREATE IF NOT EXISTS); new columns on existing tables in `db._ADDED_COLUMNS`. Reads `db.query`, writes `db.tx`/`db.execute`.
- Domain modules are thin `db` wrappers returning dicts; `_now()` = UTC isoformat; ids `uuid.uuid4()`. Activity notes via `tasks.add_comment(task_id, body, author, kind)`.
- Engine injection contract (V2, `lifecycle.py`): `spawn(run, phase) -> (session_id, account_id)`; `git` facade with `prepare_workspace/open_pr/post_review/merge/commit_reached_branch/read_at_branch`. `advance(run_id, *, phase, report, spawn, git, session_id=None)`; `decide_gate(run_id, gate, decision, *, comment, by, spawn, git)`; `start_run(project_id, task_id, *, spawn, git)`.
- Client: `api` methods in `lib/api.ts` (prefix `/api`); `useSWR(key, ()=>api.x())`; write then `mutate`. Types in `lib/types.ts`. Board `components/backlog/Board.tsx` `COLUMNS`; bucketing `lib/adapters.ts`.

**Coexistence:** the Code template must reproduce V2 behavior **exactly**. Every chunk keeps the full backend suite green (V2 baseline: 315 passed, 5 skipped) — a code task must behave identically after each chunk.

---

## Chunk 1: Data model + template registry + engine generalization

Refactor the engine to read a per-kind registry instead of module constants, with the Code template proving byte-for-byte behavior parity. No new kinds yet.

### File Structure
- Create: `apps/api/tui_pilot/lifecycle_templates.py` — pure-data registry + accessors.
- Modify: `apps/api/tui_pilot/schema.sql` — `tasks.kind/kind_suggested/kind_reason/doc_template`, `lifecycle_runs.kind`, `artifacts.content`; and `db._ADDED_COLUMNS` for existing-DB migration.
- Modify: `apps/api/tui_pilot/tasks.py` — extend `STATUSES` with the new phase names + `delivered`; derive `TRANSITIONS` from the registry.
- Modify: `apps/api/tui_pilot/lifecycle.py` — `advance`/`decide_gate`/`start_run` consult the registry; `run.kind` copied at start.
- Modify: `apps/api/tui_pilot/artifacts.py` — `register(...)` gains optional `content`; `repo_path`/`branch` default `None`; `repoint_to_branch` guarded to `repo_path IS NOT NULL`.
- Modify: `apps/api/tui_pilot/spade_server.py` — the artifact content endpoint returns inline `content` when `repo_path` is null.
- Test: `test_lifecycle_templates.py`, extend `test_lifecycle.py`, `test_tasks.py`, `test_artifacts.py`, `test_spade_server.py`.

### Task 1.1: Schema + migration columns

**Files:** `schema.sql`, `db.py`.

- [ ] **Step 1:** Add columns/tables to `schema.sql`: on `tasks` add `kind TEXT`, `kind_suggested TEXT`, `kind_reason TEXT`, `doc_template TEXT`; on `lifecycle_runs` add `kind TEXT`; on `artifacts` add `content TEXT`.
- [ ] **Step 2:** Mirror the *existing-DB* migrations in `db._ADDED_COLUMNS`: `"tasks": {"kind":"TEXT","kind_suggested":"TEXT","kind_reason":"TEXT","doc_template":"TEXT"}`, `"lifecycle_runs": {"kind":"TEXT", ...keep last_finished_session}`, `"artifacts": {"content":"TEXT"}`. Also backfill existing lifecycle runs/tasks to `kind='code'` in `_migrate` (idempotent: `UPDATE lifecycle_runs SET kind='code' WHERE kind IS NULL`; `UPDATE tasks SET kind='code' WHERE kind IS NULL AND id IN (SELECT task_id FROM lifecycle_runs)`).
- [ ] **Step 3: Verify** schema loads + columns present via a `python -c` PRAGMA check. Commit.

### Task 1.2: Template registry

**Files:** Create `lifecycle_templates.py`; Test `test_lifecycle_templates.py`.

- [ ] **Step 1: Write failing tests** — assert the registry has `code`, each phase has a `column`, the terminal phase/status is right, and accessors work:

```python
from tui_pilot import lifecycle_templates as LT

def test_code_template_matches_v2_graph():
    t = LT.template_for("code")
    assert [p["name"] for p in t["phases"]] == \
        ["shaping","plan_review","building","pr_review","shipped"]
    assert LT.phase_after("code","shaping") == "plan_review"
    assert LT.gate_for_phase("code","shaping") == "plan"     # opened when shaping finishes
    assert LT.column_for("code","building") == "In progress"
    assert LT.terminal_status("code") == "shipped"
    assert LT.first_phase("code") == "shaping"

def test_unknown_kind_raises():
    import pytest
    with pytest.raises(KeyError):
        LT.template_for("nope")

def test_consecutive_phase_pairs_union_covers_code_chain():
    pairs = LT.transition_pairs()   # set of (from,to) across all templates
    assert ("shaping","plan_review") in pairs
    assert ("building","pr_review") in pairs

def test_transition_pairs_include_entry_edge_per_kind():
    # start_run does a non-forced tasks.move(task_id, first_phase(kind)), so the
    # entry edge (ready, first_phase) MUST be a legal pair for every kind.
    pairs = LT.transition_pairs()
    assert ("ready","shaping") in pairs        # code
    # research/docs entry edges land once those templates register (Chunks 4-5):
    # ("ready","scoping"), ("ready","outline") — asserted in their chunk tests.
```

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement `lifecycle_templates.py`.** A `LIFECYCLE_TEMPLATES` dict keyed by kind. Each template: `{"terminal_status": "shipped"/"delivered", "phases": [ {name, agent:bool, fanout:bool, gate:str|None, column:str}... ]}`. Register **only `code`** in this chunk, exactly mirroring V2: phases `shaping`(agent, gate=`plan`, col=Planning), `plan_review`(col=Planning — the run sits here while the plan gate waits; NOTE V2 keeps `plan_review` as the phase between the gate opening and approval), `building`(agent, gate=`manual_test`, col=In progress), `pr_review`(agent, gate=`merge`, col=Review), `shipped`(terminal, col=Done). Accessors: `template_for(kind)`, `phases(kind)`, `first_phase(kind)` (the first phase's name — `shaping` for code), `phase_after(kind, phase)`, `gate_for_phase(kind, phase)` (the gate opened when `phase`'s agent finishes), `agent_phases(kind)`, `fanout_phases(kind)`, `column_for(kind, phase)`, `terminal_status(kind)`, `gate_advances(kind)` (see below), `transition_pairs()`.

  `transition_pairs()` = the union across all templates of (a) consecutive `(from,to)` phase pairs, (b) each gate's `(gate_source_phase, approve_next)` and `(gate_source_phase, changes_target)` edges from `gate_advances`, AND (c) the **entry edge** `(ready, first_phase(kind))` for every kind. The entry edge is REQUIRED because `start_run` does a non-forced `tasks.move(task_id, first_phase(kind))` (code `ready→shaping`, research `ready→scoping`, docs `ready→outline`); without it a non-code start would raise an illegal-transition error.

  IMPORTANT subtlety to preserve V2 exactly: in V2 the *gate that a phase opens* differs from the *phase after approval*, AND the gate approve/changes-requested handlers have side-effects and different rework targets. Model all of it with a per-kind **`gate_advances`** map keyed by gate, each value `{approve_next, changes_target}` (or equivalent). For code:
  `{"plan": {"approve_next":"building","changes_target":"shaping"}, "manual_test": {"approve_next":"pr_review","changes_target":"building"}, "merge": {"approve_next":"shipped","changes_target":"building"}}`.
  Note the approve edge for `manual_test`/`merge` is not a plain phase-set (their handlers run `open_pr`/`merge` side-effects — Task 1.4 resolves the per-gate approve-HANDLER, not just a next-phase string), and `changes_target` differs per gate (plan→shaping, manual_test/merge→building). So `gate_for_phase("code","shaping")=="plan"` (shaping finishing opens the plan gate; the run's phase becomes `plan_review`), and the plan-gate approval advances `plan_review → building`.
  NOTE: `"review"` is a reserved **gate** name (used by research/docs, Chunks 4-5). It is never a phase a task sits in for research; docs has a `review` phase-column but the gate name and phase names must not be conflated — keep the gate registry (`gate_advances` keys) distinct from `phases`.
- [ ] **Step 4: Run, verify pass.** Commit.

### Task 1.3: STATUSES + registry-derived transition guard

**Files:** `tasks.py`; Test `test_tasks.py`.

- [ ] **Step 1: Failing tests** — new phase statuses are valid; the guard accepts registry pairs and rejects illegal jumps; `delivered` is terminal-legal from a research/docs terminal phase.

```python
def test_new_phase_statuses_present():
    for s in ["scoping","investigating","synthesis","outline","drafting","review","delivered"]:
        assert s in tasks.STATUSES

def test_guard_uses_registry_pairs():
    import pytest
    projects.create(id="p", name="P", path="/w")
    tid = tasks.create(project_id="p", title="X")["id"]
    tasks.move(tid, "shaping")            # ready->shaping (code ENTRY edge) ok
    with pytest.raises(ValueError):
        tasks.move(tid, "drafting")       # shaping->drafting not a pair

def test_entry_edge_legal_for_code():
    # the non-forced ready->first_phase(kind) start move must be legal
    projects.create(id="p2", name="P", path="/w")
    tid = tasks.create(project_id="p2", title="Y")["id"]
    tasks.move(tid, "shaping")            # no force, no raise
```

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement.** Extend `STATUSES` with `scoping, investigating, synthesis, outline, drafting, review, delivered` (keep the V2 code statuses). Replace the hardcoded `TRANSITIONS` with a derivation: `_pairs = lifecycle_templates.transition_pairs()`; `move()` legal iff `status=="blocked"` OR `(current,status) in _pairs` OR current=="blocked" (resume to any) OR `force`. Keep the `status not in STATUSES` guard first. `transition_pairs()` already includes (a) the consecutive-phase pairs, (b) the gate→next-phase + gate→changes-target edges (so `plan_review→building`, `plan_review→shaping` etc. are legal), and (c) the **entry edges** `(ready, first_phase(kind))` for every kind (so the non-forced start move `ready→shaping`/`→scoping`/`→outline` is legal). (Import lifecycle_templates lazily to avoid a cycle.)
- [ ] **Step 4: Run, verify pass** — plus the FULL suite (code-task transitions must still pass). Commit.

### Task 1.4: Engine reads the registry (Code parity)

**Files:** `lifecycle.py`; extend `test_lifecycle.py`.

- [ ] **Step 1: Failing test** — a `kind` is stored on the run and the code path is unchanged:

```python
def test_start_run_stamps_kind_code_by_default():
    tid = _setup()                      # existing helper
    run = lifecycle.start_run("acme", tid, spawn=_spawn, git=FakeGit())
    assert run["kind"] == "code"
    assert run["phase"] == "shaping"
```

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement.** `start_run` reads the task's `kind` (default `"code"` when null — V2 tasks have no kind), stores it on the `lifecycle_runs` row (`kind` column), and spawns the template's **first phase** (still `shaping` for code) with the template's prepare-workspace behavior. Refactor `advance()` to: look up `run["kind"]`, use `agent_phases(kind)` for the guard, and dispatch to a per-phase handler resolved from the template rather than the hardcoded `if phase=="shaping"...`. Keep the existing `_advance_shaping/_advance_building/_advance_pr_review` as the **code** handlers, registered under the code template. Refactor `decide_gate()` to resolve, per gate, from the template's `gate_advances(kind)[gate]`: (a) an **approve-HANDLER** — not just a next-phase string, because `manual_test`/`merge` run irreversible git side-effects (`_approve_manual_test`/`_approve_merge`) while `plan` is a plain phase move; encode this as a per-gate approve dispatch (e.g. a `{gate: callable}` map for the kind, defaulting to a plain-move handler that sets `phase=approve_next`), and (b) the **`changes_target`** rework phase (plan→shaping; manual_test/merge→building) for the `changes_requested` branch, replacing the hardcoded `if gate=="plan"…`. Keep the existing V2 side-effect ordering exactly (side-effect FIRST, consume gate only on success, block+return on `GitError` with the gate still waiting). The code handlers themselves are unchanged — only the dispatch is now registry-driven. Remember `"review"` is a gate id (not a phase) and belongs in `gate_advances`, never in `agent_phases`.

  Keep `start_run`'s `git.prepare_workspace` call **only for kinds whose first phase needs a repo** (code). Add a template flag `needs_workspace: bool` (true for code, false for research/docs) so research/docs won't try to clone. In this chunk only code exists, so behavior is identical; the flag is plumbed for later chunks.
- [ ] **Step 4: Run, verify pass** — the ENTIRE `test_lifecycle.py` + `test_lifecycle_integration.py` must pass unchanged (proving code parity). Commit.

### Task 1.5: artifacts.register content param + null-repo content endpoint

**Files:** `artifacts.py`, `spade_server.py`; extend `test_artifacts.py`, `test_spade_server.py`.

- [ ] **Step 1: Failing tests** — (a) `register(task, run, kind="finding", title="F", content="hi")` (no `repo_path`/`branch` args) stores inline; `for_task` returns `content`; a repo-path artifact still works. (b) `repoint_to_branch` leaves an inline-content (null `repo_path`) artifact's branch untouched while re-pointing a repo-path one. (c) TestClient: `GET /tasks/{id}/artifacts/{aid}/content` for an inline artifact (repo_path null) returns 200 with `art["content"]` (no git read).
- [ ] **Step 2-4:** In `register`, default **both** `repo_path` AND `branch` to `None` (signature `register(task_id, run_id, kind, title=None, repo_path=None, branch=None, by=None, content=None)`) — Chunks 4/5 call `register(..., kind="finding", content=...)` with no repo_path/branch. Persist `content` (Task 1.1 added the column). Change `repoint_to_branch` to `UPDATE artifacts SET branch=? WHERE task_id=? AND repo_path IS NOT NULL` so inline-content artifacts are never mis-repointed by a code task's merge. **Content endpoint (spade_server `GET /tasks/{id}/artifacts/{aid}/content`):** currently 404s when `repo_path`/`branch` are null — change it to, when `repo_path` is null, return `{"content": art["content"]}` directly (the research report/doc/findings are stored inline); else keep the V2 branch read. Without this the research report is unreadable. Verify + commit.

### Chunk 1 review
Dispatch plan-document-reviewer on Chunk 1 (+ spec path). Fix + re-dispatch until approved.

---

## Chunk 2: Fan-out engine primitive

A phase can run N agents in parallel and advance on an all-done barrier, with per-row idempotency. No kind uses it yet (tested with a synthetic template).

### File Structure
- Modify: `schema.sql` + `db._ADDED_COLUMNS` — `fanout_agents` table.
- Create: `apps/api/tui_pilot/fanout.py` — fanout_agents CRUD (rows, mark_done, all_done, pending, block/drop).
- Modify: `lifecycle.py` — a fan-out branch in `advance`/entry; spawn N; barrier.
- Modify: `server.py` — a `_collect_lifecycle_fanout` collector keyed on the distinct `lifecycle_fanout_run_id` trigger key (per-row done + CAS all-done advance); `_collect_lifecycle_advance` returns None for fan-out sessions; fan-out death → row `blocked`.
- Modify: `spade_server.py` — `_lifecycle_spawn` fan-out variant stamps `lifecycle_fanout_idx` + `lifecycle_fanout_run_id` (last); retry/drop endpoints.
- Test: `test_fanout.py`, extend `test_lifecycle.py`, `test_server.py`.

### Task 2.1: fanout_agents table + CRUD

- [ ] **Step 1: Failing tests** for `fanout.create_rows(run_id, phase, angles)`, `fanout.mark_done(run_id, phase, idx, report_artifact_id)`, `fanout.all_done(run_id, phase)`, `fanout.pending(run_id, phase)`, `fanout.block(idx)/drop(idx)`.
- [ ] **Step 2-4:** Table `fanout_agents(id, run_id, phase, idx, angle, mode, session_id, account_id, status, report_artifact_id, created_at, updated_at)` (status `queued|running|done|blocked|dropped`). Thin `db` wrappers. `all_done` = no rows in `(queued,running,blocked)` (dropped counts as resolved). Verify + commit.

### Task 2.2: Fan-out phase entry + barrier in the engine

**Files:** `lifecycle.py`; Test `test_fanout.py` with a synthetic 2-kind registry + FakeGit + recording spawn.

- [ ] **Step 1: Failing tests** — entering a fan-out phase inserts N rows and calls spawn N times; a **second** `enter_fanout` for the same `(run_id, phase)` is a no-op (rows already exist — guards a double scope-approve); the barrier advances to the next phase only after the Nth `advance_fanout(idx)`; a duplicate `advance_fanout` for a done OR dropped row is a no-op; a blocked/dropped angle holds/releases the barrier. Plus the concurrency races: (a) **concurrent drop-vs-finish** — two threads, one `drop_angle(idx=2)` and one `advance_fanout(idx=2)` on the last-outstanding row, resolve to exactly one advance (never zero, never two syntheses); (b) **late-finish-after-drop** — `drop_angle(idx=1)` then a late `advance_fanout(idx=1, report=...)` must NOT flip the row to `done` or register a finding after synthesis started; (c) **all-angles-dropped** — dropping every row releases the barrier and spawns synthesis with zero findings.

```python
def test_fanout_advances_only_when_all_done():
    # synthetic template: scoping -> investigating(fanout) -> synthesis
    ...
    lifecycle.enter_fanout(run, "investigating", angles=[{...},{...},{...}], spawn=rec, git=FakeGit())
    assert rec.calls == 3                       # 3 agents spawned
    lifecycle.enter_fanout(run, "investigating", angles=[{...}], spawn=rec, git=FakeGit())
    assert rec.calls == 3                       # no-op: rows already exist
    lifecycle.advance_fanout(run_id, "investigating", 0, report='{"...":1}', spawn=rec, git=g)
    lifecycle.advance_fanout(run_id, "investigating", 1, report='{}', spawn=rec, git=g)
    assert lifecycle.get(run_id)["phase"] == "investigating"   # not yet
    lifecycle.advance_fanout(run_id, "investigating", 2, report='{}', spawn=rec, git=g)
    assert lifecycle.get(run_id)["phase"] == "synthesis"       # barrier released
```

- [ ] **Step 2-4:** Implement `enter_fanout(run, phase, angles, spawn, git)`:
  - **idempotency:** if any `fanout_agents` rows already exist for `(run_id, phase)`, no-op (or raise a caught error) and return — guards a double scope-approve from double-spawning N agents.
  - else create N rows, spawn each via `_spawn_fanout(run, phase, idx)` (stamps its own session; builds the per-idx prompt — see Chunk 4 `_fanout_prompt`).

  Implement `advance_fanout(run_id, phase, idx, report, spawn, git, session_id=None)`:
  - **per-row idempotency:** if the row is already `done` **OR** `dropped`, return — a late `finished` for a dropped angle must not flip it to `done` or register a finding after synthesis started.
  - else store the report as a per-angle `finding` artifact (`artifacts.register(..., kind="finding", content=report)`), `fanout.mark_done`.
  - **once-only barrier advance via atomic compare-and-swap** (NOT read-then-act — drop/retry HTTP threads run concurrently with the poll-loop drainer): after resolving the row, if `fanout.all_done(run_id, phase)`, attempt `UPDATE lifecycle_runs SET phase=<phase_after> WHERE id=? AND phase=<this fanout phase>`; **only the resolver whose affected-rowcount == 1** proceeds to spawn synthesis (with all `finding` artifacts as context). All other concurrent resolvers see rowcount 0 and do nothing. This is the CAS analogue of V2's phase-guarded once-only advance, extended to N racing resolvers.

  Add `retry_angle(run_id, phase, idx, spawn, git)` — re-spawn one; **guard against re-spawning an already `done` or `dropped` row** (no-op with a note). Add `drop_angle(run_id, phase, idx)` — mark the row `dropped` + system note; if that now releases the barrier (all rows `done`/`dropped`), run the **same CAS advance** (so the all-angles-dropped edge spawns synthesis with zero findings). Verify + commit.

  **Agent-death → row `blocked`:** a fan-out agent whose harness exits without a `done` handoff must transition its row to `blocked` and surface it (so the barrier never stalls in `running` forever) — mirror how V2 surfaces a failed lifecycle agent. Wire this in the poll loop (Task 2.3) where the fan-out session's death is observed; the `blocked` row holds the barrier until a `retry_angle` or `drop_angle` resolves it.

### Task 2.3: Poll-loop + spawn wiring for fan-out

**Files:** `server.py`, `spade_server.py`; Test `test_server.py`.

- [ ] **Step 1: Failing tests** — a `_meta` entry with `lifecycle_fanout_idx` is collected as a fan-out advance `(run_id, phase, idx, report)` with a once-guard; the drainer calls `lifecycle.advance_fanout(..., session_id=aid)`. AND an assertion that a **fan-out session is NOT collected by `_collect_lifecycle_advance`** (the single-agent collector must return `None` for it), so the single-agent path never fires on a fan-out finish. Plus: a fan-out session whose harness exits without `done` is collected as a death → its row goes `blocked` (Finding 8).
- [ ] **Step 2-4:** In `_lifecycle_spawn`'s fan-out variant, stamp `_meta[sid]` with `lifecycle_phase`, `lifecycle_fanout_idx=idx`, and — written **LAST** — a DISTINCT trigger key `lifecycle_fanout_run_id` (NOT the plain `lifecycle_run_id`). Write order matters: fields first, then `lifecycle_fanout_idx`, then `lifecycle_fanout_run_id` last (single-key dict writes are GIL-atomic, so a poll tick that sees the trigger key also sees idx+phase). Because a fan-out session sets `lifecycle_fanout_run_id` and never `lifecycle_run_id`, there is no window where the single-agent collector fires on a fan-out session.
  - Make `_collect_lifecycle_advance` **return `None` when `m.get("lifecycle_fanout_idx")` is present** (belt-and-suspenders on top of the distinct key), so the single-agent path can never claim a fan-out session.
  - Add `_collect_lifecycle_fanout(aid, st)` (mirrors `_collect_lifecycle_advance` but keyed on `lifecycle_fanout_run_id`, returns idx too) and `_drain_lifecycle_fanout(...)` → `lifecycle.advance_fanout(..., session_id=aid)`. Hook into `_poll_loop` alongside the single-agent path (a session has either `lifecycle_run_id` OR `lifecycle_fanout_run_id`, never both).
  - **Death detection (Finding 8):** when the poll loop observes a fan-out session's harness exited without a `done` handoff, transition its `fanout_agents` row to `blocked` (via `fanout.block(idx)` / a `lifecycle` helper) + surface it, mirroring V2's single-agent failure surfacing — so the barrier doesn't stall in `running`.
  - Add endpoints `POST /lifecycle/{run}/fanout/{idx}/retry` and `/drop`. Verify + commit.

### Chunk 2 review
Dispatch plan-document-reviewer on Chunk 2. Fix + re-dispatch until approved.

---

## Chunk 3: The router

### File Structure
- Create: `apps/api/tui_pilot/router.py` — `classify(title, description) -> {kind, reason, doc_template?}` (**keyword matcher** with an agent seam; see Task 3.1 decision).
- Modify: `spade_server.py` — classify on task creation; `POST /projects/{id}/route-untyped`; kind confirm/override endpoint; `POST /lifecycle/start` writes the resolved kind + relaxes the repo hard-requirement per kind.
- Modify: `tasks.py` — a `set_kind(task_id, kind, doc_template=None)` helper (guarded: rejected once ANY lifecycle run exists for the task; see Finding on circular import).
- Test: `test_router.py`, extend `test_spade_server.py`, `test_tasks.py`.

**DECISION — router mechanism is KEYWORD-ONLY, with an agent seam.** tui-pilot has NO headless/SDK/direct-API model path: the documented invariant (`apps/api/tui_pilot/__init__.py` docstring "No headless flags, no SDK, no direct API calls", plus `server.py`/`controller.py` — every agent is an interactive `claude` driven over tmux) means there is no cheap one-shot model call available. So `router.classify` runs on a keyword matcher; `_llm_classify` ships as a **stub returning `None`** with a one-line comment recording that invariant. A future agent-based classifier is a separate charter (it would spawn a real tmux agent — out of scope here). All tests assume the keyword path.

### Task 3.1: classify — keyword matcher + agent seam

- [ ] **Step 1: Failing tests** — the keyword matcher maps fixtures correctly; `classify` returns a dict with `kind` in {code,research,docs}; docs fixtures also return a `doc_template`; and the `_llm_classify→None` seam still yields a valid `{kind, reason}` for a plain code title.

```python
def test_keyword_classifies():
    assert router.classify("Investigate auth perf","")["kind"] == "research"
    assert router.classify("Write the client SOW","")["kind"] == "docs"
    assert router.classify("Add a dark-mode toggle","")["kind"] == "code"
    d = router.classify("SOW for Q3","")
    assert d["kind"]=="docs" and d["doc_template"] in ("sow","explainer")

def test_llm_seam_returns_none_and_keyword_path_still_valid():
    # tui-pilot has no headless model path: _llm_classify is a stub returning None.
    assert router._llm_classify("Add a login button","") is None
    r = router.classify("Add a login button","")
    assert r["kind"] == "code" and isinstance(r.get("reason"), str) and r["reason"]

def test_research_vs_docs_precedence():
    # a title with both a research verb and a doc noun resolves per the PINNED
    # precedence (research wins — see Step 2-4).
    assert router.classify("Research and write a doc on caching","")["kind"] == "research"
```

- [ ] **Step 2-4:** Implement `classify(title, description)`:
  - `_llm_classify(title, description)` ships as a **stub returning `None`**, with a one-line comment: *tui-pilot has no headless/SDK/direct-API model path (invariant: `__init__.py`, `server.py`, `controller.py` — every agent is interactive `claude` over tmux); an agent-based classifier is a separate charter.* `classify` calls it first (the seam), and always falls through to the keyword matcher.
  - **Keyword matcher** on the lowercased `f"{title} {description}"`. Tokens (fix the near-dead `"doc "` trailing-space token — match on word boundaries, e.g. a regex `\b(...)\b`, not substring-with-space): research = `research|investigate|compare|analyze|analyse|explore|audit`; docs = `sow|explainer|write-up|writeup|documentation|\bdoc\b|\bdocs\b`. **PIN the precedence** (state it explicitly): check **research before docs** — a title containing both a research verb and a doc noun classifies as `research` (research is the higher-effort lifecycle; a doc can be a research follow-up). Else `code`.
  - docs `doc_template`: `sow` if `sow` matched, else `explainer`.
  - Always returns `{kind, reason, doc_template?}` — `reason` a short human string naming the matched token (or "no research/docs keywords → code"). `doc_template` only when `kind=="docs"`. Verify + commit.

### Task 3.2: Route on creation + backfill + confirm

- [ ] **Step 1: Failing endpoint tests** (TestClient) — creating a task populates `kind_suggested`/`kind_reason`; `POST /projects/{id}/route-untyped` tags all null-kind tasks; `POST /tasks/{id}/kind {kind,doc_template?}` sets `kind` when no run exists, returns **409 `{"detail": "..."}`** once ANY lifecycle run exists for the task (active OR terminal — a shipped/delivered task's kind can't be mutated); `POST /lifecycle/start` for a research/docs task with NO configured repo succeeds (needs_workspace False), and writes the resolved kind onto the task before starting.
- [ ] **Step 2-4:**
  - Hook `router.classify` into the task-create path (store `kind_suggested`+`kind_reason`; do NOT set `kind` yet).
  - Add `tasks.set_kind(task_id, kind, doc_template=None)` as a **pure setter** (writes the columns; no lifecycle import). **The run-existence guard lives in the ENDPOINT layer** (`spade_server`, where `lifecycle` is already imported) — NOT inside `tasks.set_kind` — because `lifecycle` imports `tasks`, so calling `lifecycle.active_run_for_task` from `tasks.set_kind` would be a circular import. Add a `lifecycle.has_run_for_task(task_id)` helper (`SELECT 1 FROM lifecycle_runs WHERE task_id=? LIMIT 1`, matching **any** row, active or not — Finding: spec §3 locks kind at Start and it must stay locked through shipped/delivered). The `POST /tasks/{id}/kind` endpoint 409s (HTTPException 409 → `{"detail": ...}`) when `has_run_for_task` is true, else calls `tasks.set_kind`.
  - Add the `route-untyped` batch endpoint (classify every null-`kind` task in the project, store suggestions) and the confirm endpoint (above).
  - **`POST /lifecycle/start` changes (spade_server):** BEFORE `start_run`, resolve the kind as `task.kind or task.kind_suggested or "code"` and write it onto the task via `tasks.set_kind` (records which source was used in a system note), so `start_run` reads a concrete kind. Make the existing **`repo_ssh_url` hard-requirement KIND-CONDITIONAL**: it currently 404s unconditionally when the project has no repo — gate that check on the resolved kind's `needs_workspace` (code → require repo as today; research/docs → `needs_workspace=False`, must NOT require a repo and must not 404). Verify + commit.

### Chunk 3 review
Dispatch plan-document-reviewer on Chunk 3. Fix + re-dispatch until approved.

---

## Chunk 4: Research lifecycle

Register the research template; implement scoping/investigating(fanout)/synthesis handlers; wire `deep-research` for web angles; deliver.

### File Structure
- Modify: `lifecycle_templates.py` — register `research`.
- Modify: `lifecycle.py` — research phase handlers: `_advance_scoping` (scoping finish → scope gate), `_advance_synthesis` (synthesis **finish** handler → report + review gate), `_deliver_research` (review-approve). NOTE: there is **no** separate "_synthesis entry" handler — the synthesis agent is spawned by the generic fan-out barrier (`_spawn_phase` on the `phase_after` of the fan-out phase), Chunk 2. `decide_gate`'s scope-approve path chooses `enter_fanout` vs a single `_spawn_phase` by consulting the next phase's `fanout` flag (`"investigating" in fanout_phases("research")`).
- Modify: `spade_server.py` — `_phase_prompt` gains research phase prompts (scoping proposes angles; synthesis manager with verify pass) AND embeds inline artifact `content` (Finding below); a new angle-aware `_fanout_prompt(run, phase, idx)` builds the per-angle investigator prompt (repo vs web); accept follow-up tasks/brain nodes at the review gate; `_PHASE_JSON` gains `scoping`/investigator/`synthesis` entries.
- Test: `test_lifecycle_research.py`.

### Task 4.1: Research template + scoping → scope gate

- [ ] **Step 1: Failing test** — start a research task → phase `scoping`, no workspace cloned (needs_workspace false); scoping `finished` with `{"angles":[...]}` registers a `plan` artifact and opens the **scope** gate; task status `scoping`→ stays (gate waiting), board column Planning.
- [ ] **Step 2-4:** Register `research` template: phases `scoping`(agent, gate=`scope`, col=Planning), `investigating`(agent, **fanout**, col=In progress), `synthesis`(agent, gate=`review`, col=Review), `delivered`(terminal, col=Done); `gate_advances={"scope":{"approve_next":"investigating","changes_target":"scoping"},"review":{"approve_next":"delivered","changes_target":"synthesis"}}` (the `{approve_next, changes_target}` shape from Chunk 1); `needs_workspace=False`. Add `_advance_scoping` (parse `{angles:[{brief,mode}]}`, register plan artifact with inline `content`, open scope gate). The **scope gate approval** triggers `enter_fanout(run,"investigating",angles)` — resolved via the next phase's `fanout` flag in `decide_gate` (Finding 20).

  **Scratch cwd for non-code agents (Finding 19):** research runs have a null `worktree_path` (needs_workspace False → `start_run` skips `prepare_workspace`). `_lifecycle_spawn`'s `spawn` closure passes `cwd=run.get("worktree_path")` → `None`; confirm this passes `None` **through** to `server._spawn_agent` (it must not crash on a null cwd) — `_spawn_agent` already falls back to a per-agent scratch dir (`~/.spade/workspaces/<aid>`, server.py ~668-676) when `cwd` is falsy. So scoping/investigator/synthesis spawns get a scratch cwd for free; state this explicitly and add a test asserting a research spawn does not raise on null `worktree_path`. Verify + commit.

### Task 4.2: Investigating fan-out + synthesis + deliver

- [ ] **Step 1: Failing tests** (fake agents) — scope-approve fans out N investigator agents (one per angle) each with its **angle-specific** prompt; all-done spawns the synthesis manager whose prompt **embeds the inline `content` of the N finding artifacts** (not just their metadata); synthesis `finished` with `{"report": "...", "followups":[...], "brain_nodes":[...]}` registers the `report` artifact (inline content), **persists the full parsed synthesis JSON**, and opens the **review** gate; review-approve → `delivered`, creates ALL proposed followup tasks + brain nodes; an **invalid brain_node type is skipped** (not a crash) and valid ones get `source="research:<task_id>"`.
- [ ] **Step 2-4:**
  - Scope-gate-approve → `enter_fanout` edge in `decide_gate` (via the `fanout` flag, Finding 20). The synthesis agent is spawned by the fan-out **barrier** (Chunk 2's `_spawn_phase` on `phase_after("research","investigating")=="synthesis"`) — there is no separate synthesis-entry handler.
  - **Angle-aware `_fanout_prompt(run, phase, idx)` (Finding 15):** the generic `_phase_prompt(run, phase)` can't see `idx`, so the fan-out spawn (`_spawn_fanout`, Chunk 2) must build the per-idx prompt. `_fanout_prompt` reads the `fanout_agents` row for `(run_id, phase, idx)` and branches on its `mode`: `repo` → instruct repo tools (grep/read) scoped to the angle's `brief`; `web` → instruct invoking the `deep-research` skill on the `brief`. Both end with the investigator `finished` JSON.
  - **`_phase_prompt` embeds inline content (Finding 16):** where it currently lists prior artifacts as metadata (`- [kind] title @ repo_path`), for artifacts whose `repo_path` is null it must EMBED the artifact's `content` inline (fenced), so the synthesis manager actually sees the N findings rather than a list of `@ None`. (Keep the metadata line for repo-path artifacts.)
  - `_advance_synthesis` (finish handler): register the `report` artifact (inline content = the report), **persist the FULL parsed synthesis JSON** (`{report, followups, brain_nodes}`) so `_deliver_research` can read the proposals at review-approve time — store it on the report artifact (e.g. its `content` IS the report; stash the structured JSON on the run, e.g. a `synthesis_json` column, or a second inline artifact). Open the review gate.
  - **`_deliver_research` (review-approve, Finding 17):** acceptance = **accept all proposals** (simplest). Sets terminal `delivered`, `active=0`, reads the persisted synthesis JSON, and creates every proposed followup (`tasks.create`) + brain node. **Brain-node validation (Finding 18):** validate each `brain_nodes` entry's type against `brain.NODE_TYPES` = `{feature,decision,convention,feedback,bug,metric}` (`brain.create_node` raises `ValueError` on an unknown type) — **skip/default invalid types** rather than crash, and set `source="research:<task_id>"` on created nodes.
  - **`_PHASE_JSON` additions (Finding 21):** add expected-JSON entries so the prompt appends the schema (else agents get `{}` and the defensive-parse blocks them): `scoping` → `{"angles":[{"brief":"...","mode":"repo|web"}]}`; the investigator → the finding schema (e.g. `{"summary":"...","evidence":[...]}`); `synthesis` → `{"report":"...","followups":[...],"brain_nodes":[...]}`. The investigator prompt built by `_fanout_prompt` appends the investigator entry.
  - `_phase_prompt` research prompts: scoping (propose angles + modes, ground vs brain), manager (verify pass cross-checking findings, then synthesize). Verify + commit.

### Chunk 4 review
Dispatch plan-document-reviewer on Chunk 4. Fix + re-dispatch until approved.

---

## Chunk 5: Docs lifecycle + styled-doc renderer

### File Structure
- Create: `apps/api/tui_pilot/doc_templates.py` — SOW + Explainer (required sections + shared HTML/CSS shell).
- Modify: `lifecycle_templates.py` — register `docs`.
- Modify: `lifecycle.py` — docs handlers (`_advance_outline`, `_advance_drafting`, `_deliver_docs`).
- Modify: `spade_server.py` — docs `_phase_prompt`; `GET /doc/{id}` shareable route serving the styled HTML.
- Modify: client — styled-doc renderer for `doc` artifacts (Chunk 6 wires the UI; the server route lands here).
- Test: `test_lifecycle_docs.py`, `test_doc_render.py`.

### Task 5.1: doc_templates + docs lifecycle

- [ ] **Step 1: Failing tests** — start a docs task (doc_template `sow`) → phase `outline`; outline `finished` `{"outline":"..."}` registers an `outline` artifact + opens **outline** gate; approve → `drafting`; drafting `finished` `{"doc_html":"..."}` registers a `doc` artifact whose inline `content` is the **BODY/sections only** (no `<html>`/shell) + opens **review** gate; approve → `delivered`. Assert the stored `doc` content does NOT contain a full-document shell (the shell is applied once at render).
- [ ] **Step 2-4:** `doc_templates.py`: `TEMPLATES = {"sow": {...required sections...}, "explainer": {...}}` + a shared theme-aware HTML/CSS shell function `render_shell(title, body_html)`. Register `docs` template (phases `outline`(agent, gate=`outline`, col=Planning), `drafting`(agent, gate=`review`, col=Review), `delivered`(terminal, col=Done); `gate_advances={"outline":{"approve_next":"drafting","changes_target":"outline"},"review":{"approve_next":"delivered","changes_target":"drafting"}}`; `needs_workspace=False`). Handlers register `outline`/`doc` artifacts with inline content; deliver sets terminal `delivered`.
  **Store the `doc` artifact as BODY/sections only (Finding 26)** — the shared `render_shell` is applied **ONCE** at the `/doc/{id}` render step (Task 5.2), never baked into the stored content (avoids a double-shell when the drawer/route both render). The drafting prompt must produce section body HTML, not a full document.
  **Pre-render mermaid to inline SVG at drafting time**: the drafting agent (or `_advance_drafting`) converts mermaid blocks to inline `<svg>` so the stored `doc` body is static HTML+SVG with no script. This lets the `/doc` view use a **locked `sandbox=""` iframe** (NO `allow-scripts`) — agent-authored HTML must never run scripts. `_phase_prompt` docs prompts embed the chosen template's required sections + instruct mermaid diagrams (pre-rendered to SVG) + the house style. Verify + commit.

### Task 5.2: Shareable /doc/{id} route

- [ ] **Step 1: Failing test** (TestClient) — `GET /doc/{artifact_id}` for a `doc` artifact returns 200 HTML containing the doc body; a non-doc or missing id → 404.
- [ ] **Step 2-4:** Implement the route: load the artifact, 404 unless `kind=="doc"`, wrap its BODY `content` with `doc_templates.render_shell(title, body)` **once** here (the stored content is body-only, Finding 26) and return an `HTMLResponse` (read-only; no auth beyond existing). Verify + commit.

### Chunk 5 review
Dispatch plan-document-reviewer on Chunk 5. Fix + re-dispatch until approved.

---

## Chunk 6: Universal board + task view + client

### File Structure
- Modify: `lib/types.ts` — `Kind`, new statuses, `Artifact.content`, router-suggestion fields, a `LifecycleRun.fanout_count` field (Finding 24); `lib/api.ts` — `setKind`/`routeUntyped`/`templates`, `docUrl(id)` = `/api/doc/{id}` (NO `classifyKind` — there is no such endpoint; drop it).
- Modify: `components/backlog/Board.tsx` — universal 5 columns, takes a new `templates` prop; `lib/adapters.ts` — `columnFor(task, templates)` using the `/lifecycle/templates` mapping.
- Modify: `components/backlog/TaskCard.tsx` — kind badge, precise phase, `▶ N agents` for fan-out, router suggestion chip (confirm/override).
- Modify: `app/backlog/page.tsx` — kind filter + "Waiting on you" default view; "Auto-tag untyped" action.
- Modify: `app/task/[id]/page.tsx` — styled-doc renderer for `doc` artifacts; per-angle findings group; kind badge.
- Test: Playwright `e2e/board-kinds.spec.ts`, `e2e/doc-deliverable.spec.ts`.

### Task 6.1: Template mapping to the client

- [ ] **Step 1:** Add `GET /lifecycle/templates` → the registry's kind→(phase→column) mapping + gate labels (so the client doesn't hardcode a second copy). **Declare this route BEFORE `GET /lifecycle/{run_id}` in `spade_server.py` (Finding 23)** — FastAPI matches in declaration order, so a `/lifecycle/{run_id}` declared first would capture `run_id="templates"` and 404. Test it returns code/research/docs AND that `GET /lifecycle/templates` does not hit the run-lookup 404 path.
- [ ] **Step 2:** `lib/adapters.ts` `columnFor(task, templates)` maps a task's kind+status to one of the 5 universal columns. **Edge handling (Finding 27):** `kind==null` → **Ready**; `status=="ready"` → **Ready** (regardless of kind); `status=="blocked"` → **excluded from the columns** (surfaced in the blocked banner, as V2 does today, not placed in a column). Types + `api.templates()`. Commit.

### Task 6.2: Universal board + cards + filter

- [ ] **Step 1:** Add the client `api` methods (explicit checkbox items): `setKind(taskId, kind, doc_template?)` → `POST /tasks/{id}/kind`; `routeUntyped(projectId)` → `POST /projects/{id}/route-untyped`; `templates()` → `GET /lifecycle/templates`; `docUrl(id)` → the string `/api/doc/{id}` (Finding 22 — Next only proxies `/api/:path*`). Remove any `classifyKind` (no backing endpoint, Finding 27).
- [ ] **Step 2:** **Fan-out count real source (Finding 24):** the `▶ N agents` badge needs a real number — add a `fanout_count` to the run serialization (count of `fanout_agents` rows for the run's current fan-out phase) OR a `GET /lifecycle/{run}/fanout` endpoint, and a `fanout_count` field on the `LifecycleRun` type. The card reads that, not a hardcoded/absent value.
- [ ] **Step 3:** `Board.tsx` COLUMNS → `["Ready","Planning","In progress","Review","Done"]`; bucket via `columnFor(task, templates)`; Board takes a new `templates` prop. `TaskCard` gains kind badge (✨/🔬/📄), phase label, `▶ N agents` (from `run.fanout_count`), env badges on Done for code / `delivered ✓` for research/docs, and the router **suggestion chip** (confirm → `api.setKind`, override picker). **Backlog page (`app/backlog/page.tsx`) fetches `api.templates()` (SWR) and passes it into `<Board templates={...}>` (new prop)**; kind filter chips + a "Waiting on you" toggle (filter to gated cards) + "Auto-tag N untyped" button → `api.routeUntyped`.
- [ ] **Step 4: e2e** `e2e/board-kinds.spec.ts` — mock `/api/tasks` (mixed kinds), `/api/lifecycle/templates`, `/api/lifecycle`, `/api/projects`, `/api/brain/nodes`, `/api/projects/*/gates` (the backlog page calls all of these — mirror the existing `backlog.spec.ts` mock set); assert 5 columns, kind badges, a fan-out card (`▶ N agents`), the filter, and the amber gated card. Commit.

### Task 6.3: Task view — doc renderer + findings + kind

- [ ] **Step 1:** In `app/task/[id]/page.tsx`, render `doc` artifacts via a **locked `sandbox=""` iframe** (NO `allow-scripts` — agent HTML must not run scripts; the doc is static HTML+inline-SVG per Finding 26) pointed at `api.docUrl(id)` = **`/api/doc/{id}`** (Finding 22 — Next only proxies `/api/:path*`, so `/doc/{id}` would not reach the API) with an "Open / Print / Share link" affordance; group `finding` artifacts under the `report`; show the kind badge + gate bar (reused). **Extend the existing `GATE_LABEL` and `ARTIFACT_LABEL` maps (Finding 27):** add new gates (`scope`, `outline`, `review`) and new artifact kinds (`finding`, `report`, `outline`, `doc`) — or drive both from `/lifecycle/templates` — so labels don't fall back to raw ids.
- [ ] **Step 2: e2e** `e2e/doc-deliverable.spec.ts` — mock a docs task + its `doc` artifact + `/api/doc/{id}`; assert the doc renders and the share link is present. Commit.
- [ ] **Step 3: migrate existing specs (Finding 25):** update `apps/client/e2e/backlog.spec.ts` — it currently asserts **6 columns + old labels** (`Ready · Shaping · Plan review · Building · PR review · Shipped`); migrate it to the **5-column** universal model (`Ready · Planning · In progress · Review · Done`) and add the `/api/lifecycle/templates` mock it now needs (keep its existing `/api/brain/nodes`, `/api/projects/*/gates`, `/api/lifecycle` mocks). Also check `task-detail.spec.ts` for any dependence on the old gate/artifact labels or column names and update if needed. Commit.

### Chunk 6 review
Dispatch plan-document-reviewer on Chunk 6. Fix + re-dispatch until approved.

---

## Chunk 7: Integration + verification

### Task 7.1: End-to-end per-kind integration tests

- [ ] Research `ready→delivered` (fake agents + fan-out, real `deep-research` stubbed): scope gate → 3 fan-out angles → synthesis → review gate → delivered; assert plan+3 findings+report artifacts, followups created. Docs `ready→delivered`: outline gate → drafting → review gate → delivered; assert outline+doc artifacts + `/doc/{id}` renders. Commit.

### Task 7.2: Full verification

- [ ] Use superpowers:verification-before-completion. `make test` (backend green, incl. the untouched code-task V2 tests) + `npx playwright test` (client). Manually: create one task of each kind, confirm the router suggestion, drive research (with a small real fan-out) and docs to delivered against a scratch setup. Record evidence.

### Chunk 7 review
Dispatch plan-document-reviewer on Chunk 7. Fix + re-dispatch until approved.

---

## Execution notes
- Each chunk keeps code tasks behaving exactly as V2 (Chunk 1's parity tests are the guardrail). Backend suite green after every chunk.
- Implement in a worktree off the merged V2 (superpowers:using-git-worktrees). Research/Docs are exercised with fake agents until Chunk 7.
- Skills during execution: superpowers:test-driven-development (every task), superpowers:systematic-debugging (failures), superpowers:verification-before-completion (before done).
