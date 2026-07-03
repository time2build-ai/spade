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
- Modify: `apps/api/tui_pilot/artifacts.py` — `register(...)` gains optional `content`.
- Test: `test_lifecycle_templates.py`, extend `test_lifecycle.py`, `test_tasks.py`.

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

def test_unknown_kind_raises():
    import pytest
    with pytest.raises(KeyError):
        LT.template_for("nope")

def test_consecutive_phase_pairs_union_covers_code_chain():
    pairs = LT.transition_pairs()   # set of (from,to) across all templates
    assert ("shaping","plan_review") in pairs
    assert ("building","pr_review") in pairs
```

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement `lifecycle_templates.py`.** A `LIFECYCLE_TEMPLATES` dict keyed by kind. Each template: `{"terminal_status": "shipped"/"delivered", "phases": [ {name, agent:bool, fanout:bool, gate:str|None, column:str}... ]}`. Register **only `code`** in this chunk, exactly mirroring V2: phases `shaping`(agent, gate=`plan`, col=Planning), `plan_review`(col=Planning — the run sits here while the plan gate waits; NOTE V2 keeps `plan_review` as the phase between the gate opening and approval), `building`(agent, gate=`manual_test`, col=In progress), `pr_review`(agent, gate=`merge`, col=Review), `shipped`(terminal, col=Done). Accessors: `template_for(kind)`, `phases(kind)`, `phase_after(kind, phase)`, `gate_for_phase(kind, phase)` (the gate opened when `phase`'s agent finishes), `agent_phases(kind)`, `fanout_phases(kind)`, `column_for(kind, phase)`, `terminal_status(kind)`, `transition_pairs()` (union of consecutive `(from,to)` across all templates).

  IMPORTANT subtlety to preserve V2 exactly: in V2 the *gate that a phase opens* differs from the *phase after approval*. Model both: `gate_for_phase("code","shaping")=="plan"` (shaping finishing opens the plan gate; the run's phase becomes `plan_review`), and the plan-gate approval advances `plan_review → building`. Encode the gate→next-phase edges in the template too (e.g. a `gate_advances` map: `{"plan":"building","manual_test":"pr_review","merge":"shipped"}` per kind).
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
    tasks.move(tid, "shaping")            # ready->shaping (code pair) ok
    with pytest.raises(ValueError):
        tasks.move(tid, "drafting")       # shaping->drafting not a pair
```

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement.** Extend `STATUSES` with `scoping, investigating, synthesis, outline, drafting, review, delivered` (keep the V2 code statuses). Replace the hardcoded `TRANSITIONS` with a derivation: `_pairs = lifecycle_templates.transition_pairs()`; `move()` legal iff `status=="blocked"` OR `(current,status) in _pairs` OR current=="blocked" (resume to any) OR `force`. Keep the `status not in STATUSES` guard first. Add the gate→next-phase edges to the pair set (so `plan_review→building` etc. are legal). (Import lifecycle_templates lazily to avoid a cycle.)
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
- [ ] **Step 3: Implement.** `start_run` reads the task's `kind` (default `"code"` when null — V2 tasks have no kind), stores it on the `lifecycle_runs` row (`kind` column), and spawns the template's **first phase** (still `shaping` for code) with the template's prepare-workspace behavior. Refactor `advance()` to: look up `run["kind"]`, use `agent_phases(kind)` for the guard, and dispatch to a per-phase handler resolved from the template rather than the hardcoded `if phase=="shaping"...`. Keep the existing `_advance_shaping/_advance_building/_advance_pr_review` as the **code** handlers, registered under the code template. Refactor `decide_gate()` to resolve the gate→next-phase + handler from the template's `gate_advances`. The code handlers themselves are unchanged — only the dispatch is now registry-driven.

  Keep `start_run`'s `git.prepare_workspace` call **only for kinds whose first phase needs a repo** (code). Add a template flag `needs_workspace: bool` (true for code, false for research/docs) so research/docs won't try to clone. In this chunk only code exists, so behavior is identical; the flag is plumbed for later chunks.
- [ ] **Step 4: Run, verify pass** — the ENTIRE `test_lifecycle.py` + `test_lifecycle_integration.py` must pass unchanged (proving code parity). Commit.

### Task 1.5: artifacts.register content param

**Files:** `artifacts.py`; extend `test_artifacts.py`.

- [ ] **Step 1: Failing test** — `register(..., content="hi")` stores inline; `for_task` returns it; a repo-path artifact still works.
- [ ] **Step 2-4:** Add optional `content: str | None = None` to `register`, persist it; `repoint_to_branch` untouched (only rewrites `branch` where `repo_path` is not null). Verify + commit.

### Chunk 1 review
Dispatch plan-document-reviewer on Chunk 1 (+ spec path). Fix + re-dispatch until approved.

---

## Chunk 2: Fan-out engine primitive

A phase can run N agents in parallel and advance on an all-done barrier, with per-row idempotency. No kind uses it yet (tested with a synthetic template).

### File Structure
- Modify: `schema.sql` + `db._ADDED_COLUMNS` — `fanout_agents` table.
- Create: `apps/api/tui_pilot/fanout.py` — fanout_agents CRUD (rows, mark_done, all_done, pending, block/drop).
- Modify: `lifecycle.py` — a fan-out branch in `advance`/entry; spawn N; barrier.
- Modify: `server.py` — collector handles `lifecycle_fanout_idx` (per-row done + all-done advance).
- Modify: `spade_server.py` — `_lifecycle_spawn` stamps `lifecycle_fanout_idx`; retry/drop endpoints.
- Test: `test_fanout.py`, extend `test_lifecycle.py`, `test_server.py`.

### Task 2.1: fanout_agents table + CRUD

- [ ] **Step 1: Failing tests** for `fanout.create_rows(run_id, phase, angles)`, `fanout.mark_done(run_id, phase, idx, report_artifact_id)`, `fanout.all_done(run_id, phase)`, `fanout.pending(run_id, phase)`, `fanout.block(idx)/drop(idx)`.
- [ ] **Step 2-4:** Table `fanout_agents(id, run_id, phase, idx, angle, mode, session_id, account_id, status, report_artifact_id, created_at, updated_at)` (status `queued|running|done|blocked|dropped`). Thin `db` wrappers. `all_done` = no rows in `(queued,running,blocked)` (dropped counts as resolved). Verify + commit.

### Task 2.2: Fan-out phase entry + barrier in the engine

**Files:** `lifecycle.py`; Test `test_fanout.py` with a synthetic 2-kind registry + FakeGit + recording spawn.

- [ ] **Step 1: Failing tests** — entering a fan-out phase inserts N rows and calls spawn N times; the barrier advances to the next phase only after the Nth `advance_fanout(idx)`; a duplicate `advance_fanout` for a done row is a no-op; a blocked/dropped angle holds/releases the barrier.

```python
def test_fanout_advances_only_when_all_done():
    # synthetic template: scoping -> investigating(fanout) -> synthesis
    ...
    lifecycle.enter_fanout(run, "investigating", angles=[{...},{...},{...}], spawn=rec, git=FakeGit())
    assert rec.calls == 3                       # 3 agents spawned
    lifecycle.advance_fanout(run_id, "investigating", 0, report='{"...":1}', spawn=rec, git=g)
    lifecycle.advance_fanout(run_id, "investigating", 1, report='{}', spawn=rec, git=g)
    assert lifecycle.get(run_id)["phase"] == "investigating"   # not yet
    lifecycle.advance_fanout(run_id, "investigating", 2, report='{}', spawn=rec, git=g)
    assert lifecycle.get(run_id)["phase"] == "synthesis"       # barrier released
```

- [ ] **Step 2-4:** Implement `enter_fanout(run, phase, angles, spawn, git)` (create rows, spawn each via `_spawn_fanout(run, phase, idx)` which stamps its own session) and `advance_fanout(run_id, phase, idx, report, spawn, git, session_id=None)`:
  - per-row idempotency: if the row is already `done`, return;
  - else store the report as a per-angle `finding` artifact (`artifacts.register(..., kind="finding", content=report)`), `fanout.mark_done`;
  - **once-only advance**, gated on `run.phase == phase`: if `fanout.all_done`, advance to the template's `phase_after` (spawn the synthesis agent with all finding artifacts as context) — inside the same call that resolved the last row.
  Add `retry_angle(run_id, phase, idx, spawn, git)` (re-spawn one) and `drop_angle(run_id, phase, idx)` (mark dropped + system note; if that releases the barrier, advance). Verify + commit.

### Task 2.3: Poll-loop + spawn wiring for fan-out

**Files:** `server.py`, `spade_server.py`; Test `test_server.py`.

- [ ] **Step 1: Failing test** — a `_meta` entry with `lifecycle_fanout_idx` is collected as a fan-out advance `(run_id, phase, idx, report)` with a once-guard; the drainer calls `lifecycle.advance_fanout(..., session_id=aid)`.
- [ ] **Step 2-4:** In `_lifecycle_spawn`'s fan-out variant, stamp `_meta[sid]["lifecycle_fanout_idx"]=idx` (+ run_id/phase). Add `_collect_lifecycle_fanout(aid, st)` (mirrors `_collect_lifecycle_advance` but keyed on `lifecycle_fanout_idx`, returns idx too) and `_drain_lifecycle_fanout(...)` → `lifecycle.advance_fanout(..., session_id=aid)`. Hook into `_poll_loop` alongside the single-agent path (a session has either `lifecycle_phase` OR `lifecycle_fanout_idx`, never both). Add endpoints `POST /lifecycle/{run}/fanout/{idx}/retry` and `/drop`. Verify + commit.

### Chunk 2 review
Dispatch plan-document-reviewer on Chunk 2. Fix + re-dispatch until approved.

---

## Chunk 3: The router

### File Structure
- Create: `apps/api/tui_pilot/router.py` — `classify(title, description) -> {kind, reason, doc_template?}` (LLM one-shot + keyword fallback).
- Modify: `spade_server.py` — classify on task creation; `POST /projects/{id}/route-untyped`; kind confirm/override endpoint.
- Modify: `tasks.py` — a `set_kind(task_id, kind, doc_template=None)` helper (guarded: only before an active run).
- Test: `test_router.py`, extend `test_spade_server.py`.

### Task 3.1: classify + keyword fallback

- [ ] **Step 1: Failing tests** — keyword fallback maps fixtures correctly with the LLM path stubbed unavailable; `classify` returns a dict with `kind` in {code,research,docs}; docs fixtures also return a `doc_template`.

```python
def test_keyword_fallback_classifies(monkeypatch):
    monkeypatch.setattr(router, "_llm_classify", lambda *a, **k: None)  # LLM unavailable
    assert router.classify("Investigate auth perf","")["kind"] == "research"
    assert router.classify("Write the client SOW","")["kind"] == "docs"
    assert router.classify("Add a dark-mode toggle","")["kind"] == "code"
    d = router.classify("SOW for Q3","")
    assert d["kind"]=="docs" and d["doc_template"] in ("sow","explainer")
```

- [ ] **Step 2-4:** Implement `classify` — try `_llm_classify(title, description)` (a single cheap model call via the existing account/model infra; return `None` on any failure/no-account), else the keyword fallback (`research|investigate|compare|analyze|explore` → research; `sow|explainer|write-up|documentation|doc ` → docs, with `sow`→doc_template `sow` else `explainer`; else `code`). Always returns `{kind, reason, doc_template?}`. Keep `_llm_classify` behind a small interface so tests stub it. Verify + commit.

### Task 3.2: Route on creation + backfill + confirm

- [ ] **Step 1: Failing endpoint tests** (TestClient) — creating a task populates `kind_suggested`/`kind_reason`; `POST /projects/{id}/route-untyped` tags all null-kind tasks; `POST /tasks/{id}/kind {kind,doc_template?}` sets `kind` when no active run, 409s when a run is active.
- [ ] **Step 2-4:** Hook `router.classify` into the task-create path (store `kind_suggested`+`kind_reason`; do NOT set `kind` yet). Add `tasks.set_kind` (guarded via `lifecycle.active_run_for_task`), the `route-untyped` batch endpoint, and the confirm endpoint. `POST /lifecycle/start` requires `task.kind` set (falls back to `kind_suggested` if the user starts without explicit confirm; records which). Verify + commit.

### Chunk 3 review
Dispatch plan-document-reviewer on Chunk 3. Fix + re-dispatch until approved.

---

## Chunk 4: Research lifecycle

Register the research template; implement scoping/investigating(fanout)/synthesis handlers; wire `deep-research` for web angles; deliver.

### File Structure
- Modify: `lifecycle_templates.py` — register `research`.
- Modify: `lifecycle.py` — research phase handlers (`_advance_scoping`, `_synthesis` entry, `_deliver_research`).
- Modify: `spade_server.py` — `_phase_prompt` gains research phase prompts (scoping proposes angles; per-angle investigator prompt with mode repo/web; synthesis manager with verify pass); accept follow-up tasks/brain nodes at the review gate.
- Test: `test_lifecycle_research.py`.

### Task 4.1: Research template + scoping → scope gate

- [ ] **Step 1: Failing test** — start a research task → phase `scoping`, no workspace cloned (needs_workspace false); scoping `finished` with `{"angles":[...]}` registers a `plan` artifact and opens the **scope** gate; task status `scoping`→ stays (gate waiting), board column Planning.
- [ ] **Step 2-4:** Register `research` template: phases `scoping`(agent, gate=`scope`, col=Planning), `investigating`(agent, **fanout**, col=In progress), `synthesis`(agent, gate=`review`, col=Review), `delivered`(terminal, col=Done); `gate_advances={"scope":"investigating","review":"delivered"}`; `needs_workspace=False`. Add `_advance_scoping` (parse `{angles:[{brief,mode}]}`, register plan artifact with inline `content`, open scope gate). The **scope gate approval** triggers `enter_fanout(run,"investigating",angles)`. Verify + commit.

### Task 4.2: Investigating fan-out + synthesis + deliver

- [ ] **Step 1: Failing tests** (fake agents) — scope-approve fans out N investigator agents (one per angle); all-done spawns the synthesis manager; synthesis `finished` with `{"report": "...", "followups":[...], "brain_nodes":[...]}` registers the `report` artifact (inline content) and opens the **review** gate; review-approve → `delivered`, creates the accepted followup tasks + brain nodes.
- [ ] **Step 2-4:** Implement the scope-gate-approve → `enter_fanout` edge in `decide_gate`; the synthesis entry (barrier target) spawns the manager with all `finding` artifacts; `_advance_synthesis` registers the report + opens review gate; review-approve handler (`_deliver_research`) sets terminal `delivered`, `active=0`, and creates followups (`tasks.create`) + brain nodes (existing `brain` API) that were accepted. `_phase_prompt` research prompts: scoping (propose angles + modes, ground vs brain), investigator (repo→grep/read tools; web→invoke `deep-research` skill), manager (verify pass cross-checking findings, then synthesize). Verify + commit.

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

- [ ] **Step 1: Failing tests** — start a docs task (doc_template `sow`) → phase `outline`; outline `finished` `{"outline":"..."}` registers an `outline` artifact + opens **outline** gate; approve → `drafting`; drafting `finished` `{"doc_html":"..."}` registers a `doc` artifact (inline content) + opens **review** gate; approve → `delivered`.
- [ ] **Step 2-4:** `doc_templates.py`: `TEMPLATES = {"sow": {...required sections...}, "explainer": {...}}` + a shared theme-aware HTML/CSS shell function `render_shell(title, body_html)`. Register `docs` template (phases `outline`(agent, gate=`outline`, col=Planning), `drafting`(agent, gate=`review`, col=Review), `delivered`(terminal, col=Done); `needs_workspace=False`). Handlers register `outline`/`doc` artifacts with inline content; deliver sets terminal `delivered`. `_phase_prompt` docs prompts embed the chosen template's required sections + instruct mermaid diagrams + the house shell. Verify + commit.

### Task 5.2: Shareable /doc/{id} route

- [ ] **Step 1: Failing test** (TestClient) — `GET /doc/{artifact_id}` for a `doc` artifact returns 200 HTML containing the doc body; a non-doc or missing id → 404.
- [ ] **Step 2-4:** Implement the route: load the artifact, 404 unless `kind=="doc"`, return its `content` wrapped by `doc_templates.render_shell` as an `HTMLResponse` (read-only; no auth beyond existing). Verify + commit.

### Chunk 5 review
Dispatch plan-document-reviewer on Chunk 5. Fix + re-dispatch until approved.

---

## Chunk 6: Universal board + task view + client

### File Structure
- Modify: `lib/types.ts` — `Kind`, new statuses, `Artifact.content`, router-suggestion fields; `lib/api.ts` — `classifyKind`/`setKind`/`routeUntyped`, `docUrl(id)`.
- Modify: `components/backlog/Board.tsx` — universal 5 columns; `lib/adapters.ts` — `columnFor(task)` using a client mirror of the registry (or a `/lifecycle/templates` endpoint).
- Modify: `components/backlog/TaskCard.tsx` — kind badge, precise phase, `▶ N agents` for fan-out, router suggestion chip (confirm/override).
- Modify: `app/backlog/page.tsx` — kind filter + "Waiting on you" default view; "Auto-tag untyped" action.
- Modify: `app/task/[id]/page.tsx` — styled-doc renderer for `doc` artifacts; per-angle findings group; kind badge.
- Test: Playwright `e2e/board-kinds.spec.ts`, `e2e/doc-deliverable.spec.ts`.

### Task 6.1: Template mapping to the client

- [ ] **Step 1:** Add `GET /lifecycle/templates` → the registry's kind→(phase→column) mapping + gate labels (so the client doesn't hardcode a second copy). Test it returns code/research/docs.
- [ ] **Step 2:** `lib/adapters.ts` `columnFor(task, templates)` maps a task's kind+status to one of the 5 universal columns. Types + `api.templates()`. Commit.

### Task 6.2: Universal board + cards + filter

- [ ] **Step 1:** `Board.tsx` COLUMNS → `["Ready","Planning","In progress","Review","Done"]`; bucket via `columnFor`. `TaskCard` gains kind badge (✨/🔬/📄), phase label, `▶ N agents` (from the run's fanout count), env badges on Done for code / `delivered ✓` for research/docs, and the router **suggestion chip** (confirm → `api.setKind`, override picker). Backlog page: kind filter chips + a "Waiting on you" toggle (filter to gated cards) + "Auto-tag N untyped" button → `api.routeUntyped`.
- [ ] **Step 2: e2e** `e2e/board-kinds.spec.ts` — mock `/api/tasks` (mixed kinds), `/api/lifecycle/templates`, `/api/projects`; assert 5 columns, kind badges, a fan-out card, the filter, and the amber gated card. Commit.

### Task 6.3: Task view — doc renderer + findings + kind

- [ ] **Step 1:** In `app/task/[id]/page.tsx`, render `doc` artifacts via an iframe/sandboxed HTML view (from `api.docUrl(id)` = `/doc/{id}`) with an "Open / Print / Share link" affordance; group `finding` artifacts under the `report`; show the kind badge + gate bar (reused).
- [ ] **Step 2: e2e** `e2e/doc-deliverable.spec.ts` — mock a docs task + its `doc` artifact + `/doc/{id}`; assert the doc renders and the share link is present. Commit.

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
