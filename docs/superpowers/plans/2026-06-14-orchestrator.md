# Orchestrator Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a conversational orchestrator — one tmux `claude` you chat with that spawns workers with the right model per task, routes their questions, and runs missions supervised-by-default or hands-off (autopilot).

**Architecture:** The orchestrator is a normal harness agent with an extended action vocabulary (`spawn`/`answer`/`kill`/`status`). A pure, callback-injected **executor** (`orchestration.py`) interprets those actions; the server wires it into the orchestrator's poll path and adds mission tagging, per-mission autopilot, model-tier launching (`claude --model <id>`), the Opus-spawn + worker-permission brakes, and worker-question → orchestrator routing. The UI gains a chat-primary view with the live fleet (model + reason) behind it.

**Tech Stack:** Python 3.12, FastAPI, tmux, pytest, vanilla JS/CSS. No new runtime deps.

**Spec:** `docs/superpowers/specs/2026-06-14-orchestrator-design.md`
**Builds on:** the harness (`tui_pilot/{comms,harness,session,identity,server}.py`, already implemented on branch `feat/agent-harness`).

**Branch:** continue on `feat/agent-harness` (or branch `feat/orchestrator` from it). All commit steps assume git is initialized (it is).

---

## File Structure

**New files:**
- `tui_pilot/models.py` — tier→model-id map (`haiku/sonnet/opus`), ceiling comparison. Pure.
- `tui_pilot/orchestration.py` — `parse_orchestration_signal()` + `OrchestrationExecutor` (callback-injected; runs spawn/answer/kill/status, enforces ceiling/brakes). Pure-ish, unit-testable without tmux.
- `tui_pilot/orchestrator_server.py` — the server-side orchestrator wiring kept OUT of `server.py`: the callback object the executor uses, the missions + brakes state, the deferred-work drain helpers, and an `APIRouter` with the orchestrator/mission/brake endpoints. `server.py` imports it and includes the router; the `_poll_loop` calls its `collect_*`/`drain_*` helpers.
- `tui_pilot/assets/orchestrator-comms/SKILL.md` — documents the orchestration actions for the orchestrator agent.
- `tests/test_models.py`, `tests/test_orchestration.py`, `tests/test_orchestrator_server.py`.

**Modified files:**
- `roles.yaml` — add the `orchestrator` role preset.
- `tui_pilot/session.py` — append `--model <id>` to the launch command when a model tier is set.
- `tui_pilot/server.py` — extend `_meta`/`_info`/`_spawn_agent` with `model`/`mission`/`parent`/`reason`; in `_poll_loop`, **collect** orchestrator signals + worker-forward items under each session's lock and **drain** them after releasing the lock (see invariant below); include the orchestrator router.
- `tui_pilot/static/{index.html,app.js,style.css}` — chat-primary view, fleet-with-models, missions, autopilot toggle, advanced page (deferred to the last chunk).

---

## ⚠ Concurrency invariant (read before Chunk 4)

The harness had a self-deadlock before; the orchestrator adds many **cross-session**
operations (orchestrator → workers, workers → orchestrator), which is a classic
AB/BA deadlock setup. One rule prevents all of it:

> **Hold at most ONE session lock at a time. Never acquire a second session lock
> (or `send_text` into another session) while holding one. `_registry_lock` is
> always the innermost lock and is only taken when no session lock is held by the
> current thread.**

Mechanism — the `_poll_loop` becomes **two-phase per tick**:
1. **Collect (locked):** for each session, under `_lock_for(aid)`, run `poller.poll()`
   and gather *descriptors* of cross-session work to do — e.g. "orchestrator has
   parsed signals [..]", "worker W is blocked on signal S, not yet forwarded"
   (mark it forwarded now, under W's lock). Do NOT send into other sessions here.
2. **Drain (unlocked):** after releasing every session lock, execute the collected
   work. Each item acquires only the **one** lock it targets:
   - run an orchestration signal through the executor → its callbacks
     (`spawn`/`answer_worker`/`approve_worker`/`deny_worker`/`kill`/`narrate`) each
     take their *target* session lock (or `_registry_lock` for spawn) alone;
   - reply a new worker id to the orchestrator → `send_text` under the
     orchestrator's lock alone;
   - forward a worker's question to the orchestrator → `send_text` under the
     orchestrator's lock alone.

Tasks 7–9 below follow this collect-then-drain shape. Endpoint handlers (brake
allow/skip, answer) run outside the poll loop and likewise take one lock at a time.

---

## Chunk 1: Model tiers + model-launch

### Task 1: `models.py` — tier map + ceiling

**Files:** Create `tui_pilot/models.py`; Test `tests/test_models.py`.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_models.py
import pytest
from tui_pilot.models import model_id, within_ceiling, TIERS

def test_tier_to_model_id():
    assert model_id("haiku") == "claude-haiku-4-5"
    assert model_id("sonnet") == "claude-sonnet-4-6"
    assert model_id("opus") == "claude-opus-4-8"

def test_unknown_tier_returns_none():
    assert model_id("") is None
    assert model_id(None) is None
    assert model_id("gpt") is None

def test_tiers_are_ordered_cheap_to_capable():
    assert TIERS == ["haiku", "sonnet", "opus"]

def test_within_ceiling():
    assert within_ceiling("haiku", "sonnet") is True
    assert within_ceiling("sonnet", "sonnet") is True
    assert within_ceiling("opus", "sonnet") is False     # exceeds ceiling
    assert within_ceiling("haiku", "opus") is True

def test_within_ceiling_unknown_tier_is_allowed():
    # no model / unknown tier == server default, never a ceiling breach
    assert within_ceiling(None, "sonnet") is True
    assert within_ceiling("weird", "sonnet") is True
```

- [ ] **Step 2: Run to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_models.py -v` → FAIL (module missing).

- [ ] **Step 3: Implement `tui_pilot/models.py`**

```python
"""Model tiers for sizing a worker to its task.

Tier names are stable across the codebase; the concrete `--model` ids may need
confirming against the installed Claude Code (see spec §5)."""
from __future__ import annotations

# cheap → capable
TIERS = ["haiku", "sonnet", "opus"]

_IDS = {
    "haiku": "claude-haiku-4-5",
    "sonnet": "claude-sonnet-4-6",
    "opus": "claude-opus-4-8",
}

def model_id(tier: str | None) -> str | None:
    """Concrete --model id for a tier, or None for unknown/absent (server default)."""
    if not tier:
        return None
    return _IDS.get(tier)

def within_ceiling(tier: str | None, ceiling: str) -> bool:
    """True if `tier` is at or below `ceiling`. Unknown/None tier == default → allowed."""
    if tier not in TIERS:
        return True
    if ceiling not in TIERS:
        return True
    return TIERS.index(tier) <= TIERS.index(ceiling)
```

- [ ] **Step 4: Run to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_models.py -v` → PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add tui_pilot/models.py tests/test_models.py
git commit -m "feat: model tiers (tier->id map + ceiling)"
```

---

### Task 2: `session.py` — launch with `--model`

**Files:** Modify `tui_pilot/session.py`; Test `tests/test_session_model.py` (create).

- [ ] **Step 1: Write the failing test**

```python
# tests/test_session_model.py
from tui_pilot.session import build_cmd

def test_build_cmd_plain():
    assert build_cmd("claude", None) == "claude"

def test_build_cmd_with_model():
    assert build_cmd("claude", "claude-sonnet-4-6") == "claude --model claude-sonnet-4-6"

def test_build_cmd_preserves_existing_flags():
    assert build_cmd("claude --dangerously-skip-permissions", "claude-opus-4-8") \
        == "claude --dangerously-skip-permissions --model claude-opus-4-8"

def test_build_cmd_no_double_model():
    # if the cmd already names a model, don't append again
    assert build_cmd("claude --model x", "claude-haiku-4-5") == "claude --model x"
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_session_model.py -v` → FAIL (function missing).

- [ ] **Step 3: Implement `build_cmd`** — add a module-level helper to `tui_pilot/session.py`:

```python
def build_cmd(cmd: str, model_id: str | None) -> str:
    """Append `--model <id>` to a launch command when a model is requested.

    `--model` is an interactive-compatible flag (the REPL still runs normally),
    so it does not violate the no-headless constraint. Idempotent: skips if the
    command already names a model."""
    if not model_id or "--model" in cmd:
        return cmd
    return f"{cmd} --model {model_id}"
```

- [ ] **Step 4: Run to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_session_model.py -v` → PASS (4 tests).

- [ ] **Step 5: Run full offline suite (no regressions)**

Run: `.venv/bin/python -m pytest tests/ -q --ignore=tests/test_integration.py` → all PASS.

- [ ] **Step 6: Commit**

```bash
git add tui_pilot/session.py tests/test_session_model.py
git commit -m "feat: build_cmd appends --model for worker model selection"
```

---

## Chunk 2: Orchestration signals + executor

### Task 3: orchestration signal model + parser

**Files:** Create `tui_pilot/orchestration.py`; Test `tests/test_orchestration.py`.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_orchestration.py
import pytest
from tui_pilot.orchestration import parse_orchestration_signal, ORCH_ACTIONS, OrchestrationSignal

def test_parse_spawn():
    s = parse_orchestration_signal({"action": "spawn", "role": "developer",
        "model": "sonnet", "task": "Implement plan.md", "mission": "m1",
        "reason": "standard markup"})
    assert s.action == "spawn" and s.model == "sonnet" and s.mission == "m1"
    assert s.role == "developer" and s.reason == "standard markup"

def test_parse_answer_kill_status():
    assert parse_orchestration_signal({"action": "answer", "worker": "w1", "text": "pg"}).worker == "w1"
    assert parse_orchestration_signal({"action": "kill", "worker": "w1"}).worker == "w1"
    assert parse_orchestration_signal({"action": "status", "text": "halfway"}).text == "halfway"

def test_is_orchestration_action():
    assert ORCH_ACTIONS == {"spawn", "answer", "kill", "status"}

def test_unknown_action_raises():
    with pytest.raises(ValueError):
        parse_orchestration_signal({"action": "nuke"})
```

- [ ] **Step 2: Run to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_orchestration.py -v` → FAIL (module missing).

- [ ] **Step 3: Implement the model + parser** in `tui_pilot/orchestration.py`:

```python
"""Orchestration signals + executor.

The orchestrator is a normal harness agent with an extended action vocabulary.
It writes these JSON files to its outbox; an OrchestrationExecutor (callback-
injected, so it is testable without tmux/FastAPI) interprets them."""
from __future__ import annotations

from dataclasses import dataclass

ORCH_ACTIONS = {"spawn", "answer", "kill", "status"}

@dataclass
class OrchestrationSignal:
    id: str
    action: str
    role: str | None = None
    model: str | None = None
    task: str = ""
    cwd: str | None = None
    mode: str | None = None
    mission: str | None = None
    reason: str = ""
    worker: str | None = None
    text: str = ""

def parse_orchestration_signal(data: dict) -> OrchestrationSignal:
    action = data.get("action")
    if action not in ORCH_ACTIONS:
        raise ValueError(f"unknown orchestration action {action!r}")
    return OrchestrationSignal(
        id=data.get("id", ""), action=action,
        role=data.get("role"), model=data.get("model"), task=data.get("task", ""),
        cwd=data.get("cwd"), mode=data.get("mode"), mission=data.get("mission"),
        reason=data.get("reason", ""), worker=data.get("worker"), text=data.get("text", ""),
    )
```

- [ ] **Step 4: Run to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_orchestration.py -v` → PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add tui_pilot/orchestration.py tests/test_orchestration.py
git commit -m "feat: orchestration signal model + parser"
```

---

### Task 4: `OrchestrationExecutor` — run actions, enforce ceiling/brakes

**Files:** Modify `tui_pilot/orchestration.py`; Test `tests/test_orchestration.py`.

The executor takes a `callbacks` object and `policy` (ceiling + autopilot) and turns one signal into side effects, returning a result describing what happened (so the server can narrate / surface brakes).

- [ ] **Step 1: Append failing tests**

```python
from tui_pilot.orchestration import OrchestrationExecutor, Policy

class _Spy:
    def __init__(self): self.calls = []
    def spawn(self, **kw): self.calls.append(("spawn", kw)); return "newworker-id"
    def answer_worker(self, worker, text): self.calls.append(("answer", worker, text)); return True
    def approve_worker(self, worker): self.calls.append(("approve", worker)); return True
    def deny_worker(self, worker): self.calls.append(("deny", worker)); return True
    def kill(self, worker): self.calls.append(("kill", worker)); return True
    def narrate(self, text): self.calls.append(("narrate", text))
    def worker_state(self, worker): return self._state          # injected per test

def _exec(policy=None):
    spy = _Spy(); spy._state = "IDLE"
    return OrchestrationExecutor(spy, policy or Policy(ceiling="sonnet", autopilot=False)), spy

def test_spawn_within_ceiling_executes():
    ex, spy = _exec()
    r = ex.run(parse_orchestration_signal({"action":"spawn","role":"developer","model":"sonnet","task":"x"}))
    assert r.kind == "spawned" and r.worker == "newworker-id"
    assert spy.calls[0][0] == "spawn"
    assert spy.calls[0][1]["model"] == "sonnet"

def test_spawn_above_ceiling_supervised_is_braked():
    ex, spy = _exec(Policy(ceiling="sonnet", autopilot=False))
    r = ex.run(parse_orchestration_signal({"action":"spawn","model":"opus","task":"hard","reason":"gnarly"}))
    assert r.kind == "brake" and r.brake == "opus_spawn"
    assert spy.calls == []                                   # NOT spawned; waits for human

def test_spawn_above_ceiling_autopilot_proceeds():
    ex, spy = _exec(Policy(ceiling="sonnet", autopilot=True))
    r = ex.run(parse_orchestration_signal({"action":"spawn","model":"opus","task":"hard"}))
    assert r.kind == "spawned"
    assert spy.calls[0][1]["model"] == "opus"

def test_answer_routes_to_mailbox_when_worker_blocked():
    ex, spy = _exec(); spy._state = "AWAITING_INPUT"        # not a permission dialog
    r = ex.run(parse_orchestration_signal({"action":"answer","worker":"w1","text":"pg"}))
    assert ("answer", "w1", "pg") in spy.calls and r.kind == "answered"

def test_answer_approve_routes_to_approve_when_permission_dialog():
    ex, spy = _exec(); spy._state = "AWAITING_PERMISSION"
    ex.run(parse_orchestration_signal({"action":"answer","worker":"w1","text":"approve"}))
    assert ("approve", "w1") in spy.calls

def test_answer_deny_routes_to_deny_when_permission_dialog():
    ex, spy = _exec(); spy._state = "AWAITING_PERMISSION"
    ex.run(parse_orchestration_signal({"action":"answer","worker":"w1","text":"deny"}))
    assert ("deny", "w1") in spy.calls

def test_kill_and_status():
    ex, spy = _exec()
    ex.run(parse_orchestration_signal({"action":"kill","worker":"w1"}))
    ex.run(parse_orchestration_signal({"action":"status","text":"hi"}))
    assert ("kill","w1") in spy.calls and ("narrate","hi") in spy.calls
```

- [ ] **Step 2: Run to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_orchestration.py -v` → FAIL (executor missing).

- [ ] **Step 3: Implement `Policy`, `Result`, `OrchestrationExecutor`** (append):

```python
from dataclasses import field

@dataclass
class Policy:
    ceiling: str = "sonnet"
    autopilot: bool = False

@dataclass
class Result:
    kind: str                 # "spawned" | "answered" | "killed" | "narrated" | "brake" | "noop"
    worker: str | None = None
    brake: str | None = None  # "opus_spawn" when kind == "brake"
    detail: str = ""

# callbacks expected: spawn(**kw)->worker_id, answer_worker(worker,text)->bool,
# approve_worker(worker)->bool, deny_worker(worker)->bool, kill(worker)->bool,
# narrate(text)->None, worker_state(worker)->str
# (answer_worker resolves the worker's open-signal id internally, so the executor
#  does NOT need a separate worker_open_signal_id callback.)
from .models import within_ceiling

class OrchestrationExecutor:
    def __init__(self, callbacks, policy: Policy):
        self.cb = callbacks
        self.policy = policy

    def run(self, sig) -> Result:
        if sig.action == "spawn":
            return self._spawn(sig)
        if sig.action == "answer":
            return self._answer(sig)
        if sig.action == "kill":
            ok = self.cb.kill(sig.worker)
            return Result("killed" if ok else "noop", worker=sig.worker)
        if sig.action == "status":
            self.cb.narrate(sig.text)
            return Result("narrated", detail=sig.text)
        return Result("noop")

    def _spawn(self, sig) -> Result:
        # Opus / above-ceiling spawn is a brake in supervised mode.
        if not within_ceiling(sig.model, self.policy.ceiling) and not self.policy.autopilot:
            return Result("brake", brake="opus_spawn",
                          detail=f"requested {sig.model} (ceiling {self.policy.ceiling}): {sig.reason}")
        worker = self.cb.spawn(role=sig.role, model=sig.model, task=sig.task,
                               cwd=sig.cwd, mode=sig.mode, mission=sig.mission, reason=sig.reason)
        return Result("spawned", worker=worker)

    def _answer(self, sig) -> Result:
        # Choose resolution path by the worker's CURRENT state:
        # a permission dialog (AWAITING_PERMISSION) → approve/deny; else → mailbox answer.
        state = self.cb.worker_state(sig.worker)
        if state == "AWAITING_PERMISSION":
            txt = sig.text.strip().lower()
            if txt in ("deny", "no", "reject"):
                self.cb.deny_worker(sig.worker)
            else:
                self.cb.approve_worker(sig.worker)
            return Result("answered", worker=sig.worker)
        ok = self.cb.answer_worker(sig.worker, sig.text)
        if not ok:
            # spec §10: no matching open signal → no-op, but tell the orchestrator
            self.cb.narrate(f"answer to {sig.worker} did not land (no open question)")
        return Result("answered" if ok else "noop", worker=sig.worker)
```

(Notes: the executor's `answer_worker` callback resolves the worker's open-signal
id internally — the executor passes only `worker, text`. The executor's callbacks
are always invoked in the poll loop's **drain phase** (no session lock held by the
caller) or from an endpoint handler, per the concurrency invariant — so each
callback may safely take its own single target lock.)

- [ ] **Step 4: Run to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_orchestration.py -v` → PASS (all).

- [ ] **Step 5: Commit**

```bash
git add tui_pilot/orchestration.py tests/test_orchestration.py
git commit -m "feat: orchestration executor (spawn/answer/kill/status + ceiling/opus brake)"
```

---

## Chunk 3: Role preset + skill + meta schema

### Task 5: orchestrator role + orchestration skill asset

**Files:** Modify `roles.yaml`; Create `tui_pilot/assets/orchestrator-comms/SKILL.md`.

- [ ] **Step 1: Add the `orchestrator` role to `roles.yaml`** (append under `roles:`):

```yaml
  - id: orchestrator
    label: Orchestrator
    emoji: "🧠"
    mode: auto            # so it can write its own orchestration signals freely
    cmd: claude
    description: Chat with it; it plans, spawns workers (right model per task), and steers the fleet.
    instructions: |
      You are the ORCHESTRATOR. The human talks to you in plain language; you run
      a fleet of worker agents to accomplish their goals.

      To act, use the agent-comms skill PLUS these orchestration actions (write a
      JSON file to your outbox, one per action):
      - spawn   {role, model, task, cwd?, mode?, mission, reason} — start a worker.
                Pick `model` by task complexity: "haiku" (simple), "sonnet"
                (most work), "opus" (genuinely hard). Always give a one-line
                `reason` for the model. Default to the cheapest model that fits.
      - answer  {worker, text} — reply to a worker that is waiting on you (a
                question, or a permission prompt: answer "approve"/"deny").
      - kill    {worker} — stop a finished or stuck worker.
      - status  {text} — narrate progress to the human (no reply needed).

      Operating rules:
      - Decompose the goal, then spawn workers and coordinate them. Prefer the
        smallest capable model; reserve opus for hard problems and say why.
      - When the control center forwards you a worker's question or permission
        prompt, decide and emit an `answer`. If you genuinely can't, escalate by
        telling the human in plain text instead of guessing.
      - Keep the human informed with brief `status` notes.
      - When the whole goal is done, emit `finished` with a short report.
```

- [ ] **Step 2: Write the orchestration skill** — `tui_pilot/assets/orchestrator-comms/SKILL.md`:

```markdown
---
name: orchestrator-comms
description: Orchestrator-only — extra actions to spawn, answer, kill, and narrate workers.
---

# Orchestrating workers

You manage workers by writing JSON files to your outbox (`__OUTBOX__`), in
addition to the normal agent-comms actions. One file per action:

- spawn   `{ "id":"...", "action":"spawn", "role":"developer", "model":"haiku|sonnet|opus",
            "task":"...", "mission":"<name>", "reason":"why this model", "cwd":"…?", "mode":"…?" }`
- answer  `{ "id":"...", "action":"answer", "worker":"<worker-id>", "text":"…" }`
            (for a permission prompt, text is "approve" or "deny")
- kill    `{ "id":"...", "action":"kill", "worker":"<worker-id>" }`
- status  `{ "id":"...", "action":"status", "text":"progress note for the human" }`

The control center executes each action and types results back to you (e.g. the
new worker's id, or a worker's forwarded question). Pick the cheapest model that
fits the task; justify any `opus`.
```

- [ ] **Step 3: Commit**

```bash
git add roles.yaml tui_pilot/assets/orchestrator-comms/
git commit -m "feat: orchestrator role preset + orchestration skill"
```

---

### Task 6: extend session meta with model/mission/parent/reason

**Files:** Modify `tui_pilot/server.py`; Test `tests/test_orchestrator_server.py` (create).

- [ ] **Step 1: Write the failing test**

```python
# tests/test_orchestrator_server.py
import pytest, time
from fastapi.testclient import TestClient
from tui_pilot import server

@pytest.fixture()
def client():
    return TestClient(server.app)

def test_spawn_records_model_mission_parent_reason(client, tmp_path):
    r = client.post("/sessions", json={"name":"w","cmd":"cat","cwd":str(tmp_path),
        "model":"sonnet","mission":"m1","parent":"orch-1","reason":"standard markup"})
    assert r.status_code == 200
    info = r.json()
    aid = info["id"]
    try:
        assert info["model"] == "sonnet"
        assert info["mission"] == "m1"
        assert info["parent"] == "orch-1"
        assert info["reason"] == "standard markup"
        # cmd got the --model flag
        assert "--model claude-sonnet-4-6" in info["cmd"]
    finally:
        client.delete(f"/sessions/{aid}")
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_orchestrator_server.py -v` → FAIL (fields/flag absent).

- [ ] **Step 3: Extend `SpawnRequest`, `_spawn_agent`, `_meta`, `_info`** in `server.py`:
- Add to `SpawnRequest`: `model: str | None = None`, `mission: str | None = None`, `parent: str | None = None`, `reason: str | None = None`.
- In `_spawn_agent` signature add the same kwargs. Compute the launch cmd with the model:
  ```python
  from .models import model_id
  from .session import build_cmd
  eff_cmd = build_cmd(eff_cmd, model_id(model))
  ```
  (apply AFTER the existing bypass `--dangerously-skip-permissions` handling).
- Store `model`, `mission`, `parent`, `reason` in `_meta[aid]`.
- Add them to the dict returned by `_info(aid)`.
- `create_session` passes the new fields through to `_spawn_agent`.

- [ ] **Step 4: Run to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_orchestrator_server.py -v` → PASS.

- [ ] **Step 5: Run full offline suite**

Run: `.venv/bin/python -m pytest tests/ -q --ignore=tests/test_integration.py` → all PASS.

- [ ] **Step 6: Commit**

```bash
git add tui_pilot/server.py tests/test_orchestrator_server.py
git commit -m "feat: session meta carries model/mission/parent/reason + --model launch"
```

---

## Chunk 4: Server wiring — executor, routing, brakes, endpoints

### Task 7: dispatch orchestrator signals to the executor

**Files:** Modify `tui_pilot/server.py`, `tui_pilot/harness.py`; Test `tests/test_orchestrator_server.py`.

**Design:** the orchestrator is spawned with a flag in meta (`is_orchestrator=True`). In the poll loop, when an agent is the orchestrator, its outbox signals are parsed as orchestration signals and run through an `OrchestrationExecutor` wired with server callbacks; non-orchestrator agents keep the existing worker behavior. Worker actions remain handled by the harness poller as today.

- [ ] **Step 1: Write the failing test** (simulated orchestrator driving a `cat` worker)

```python
def test_orchestrator_spawn_signal_creates_worker(client, tmp_path):
    import json
    # an "orchestrator" backed by cat (we just feed its outbox directly)
    o = client.post("/sessions", json={"name":"orch","cmd":"cat","cwd":str(tmp_path),
                                       "is_orchestrator": True}).json()["id"]
    # drop a spawn orchestration signal in the orchestrator's outbox
    ob = server._hub_for(str(tmp_path)).agent_dir(o) / "outbox" / "s1.json"
    ob.write_text(json.dumps({"id":"s1","action":"spawn","role":"plain","cmd":"cat",
                              "model":"haiku","task":"go","mission":"m1","cwd":str(tmp_path)}))
    # wait for the poll loop to execute it
    spawned = None
    for _ in range(30):
        ss = client.get("/sessions").json()["sessions"]
        spawned = [s for s in ss if s.get("parent") == o]
        if spawned: break
        time.sleep(0.1)
    assert spawned and spawned[0]["mission"] == "m1"
    assert "--model claude-haiku-4-5" in spawned[0]["cmd"]
    for s in client.get("/sessions").json()["sessions"]:
        client.delete(f"/sessions/{s['id']}")
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_orchestrator_server.py::test_orchestrator_spawn_signal_creates_worker -v` → FAIL.

- [ ] **Step 3: Implement dispatch (collect-then-drain — see invariant)**
- `SpawnRequest`: add `is_orchestrator: bool = False`; store in `_meta`. (No model flag for the orchestrator itself unless given.)
- In `tui_pilot/orchestrator_server.py`, build the **callback object** the executor uses (each method takes exactly ONE lock, and is only called in the drain phase / an endpoint, never with another session lock held):
  - `spawn(**kw)` → `_spawn_agent(name=kw["role"] or "worker", role=kw["role"], cmd=kw.get("cmd"), model=kw["model"], task=kw["task"], cwd=kw.get("cwd") or <orch cwd>, mode=kw.get("mode"), mission=kw["mission"], parent=<orch id>, reason=kw["reason"])["id"]` (takes `_registry_lock` internally; no session lock held by caller).
  - `answer_worker(w,t)` → `with _lock_for(w): sid = _pollers[w].open_signal.id (if open); _pollers[w].answer(sid,t)` → returns False if no open signal.
  - `approve_worker(w)`/`deny_worker(w)` → `with _lock_for(w): _sessions[w].approve()/.deny()`.
  - `kill(w)` → `delete_session(w)`.
  - `narrate(t)` → append to the mission's activity log (in-memory; no session lock).
  - `worker_state(w)` → `_safe_state(_sessions[w])` (lock-free read).
- In `_poll_loop`, **collect phase** for an orchestrator agent (under its lock): scan its outbox, `parse_orchestration_signal` each, `mark_processed`, and append `(orch_id, signal)` to a `to_run` list. Do NOT execute here.
- **Drain phase** (after all session locks released): for each `(orch_id, signal)`, look up the mission's `Policy` (autopilot), run it through an `OrchestrationExecutor`. On `Result.kind=="spawned"` → `with _lock_for(orch_id): send_text(<worker id note>)`. On `Result.kind=="brake"` → record a pending brake (Task 9), don't execute.
- Routing orchestration vs worker signals: branch on `_meta[aid]["is_orchestrator"]`. For an orchestrator the loop runs the **orchestration scan INSTEAD of** the normal worker `poller.poll()` over the same outbox — never both in one tick, or the worker poller would try to `parse_signal` orchestration actions, fail the `ACTIONS` check, and wrongly quarantine them to `processed/`. Worker (non-orchestrator) poll path is unchanged.

- [ ] **Step 4: Run to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_orchestrator_server.py -v` → PASS.

- [ ] **Step 5: Commit**

```bash
git add tui_pilot/server.py tui_pilot/harness.py tests/test_orchestrator_server.py
git commit -m "feat: dispatch orchestrator signals through the executor"
```

---

### Task 8: answer-routing — forward worker questions to the orchestrator

**Files:** Modify `tui_pilot/server.py`; Test `tests/test_orchestrator_server.py`.

**Design:** when a worker (with a `parent` orchestrator) becomes `blocked` (mailbox) or `AWAITING_PERMISSION` (screen) and its mission is not paused on a brake, the control center types a structured note into the orchestrator's session ONCE per open signal (track "forwarded" so it isn't re-sent every poll). The orchestrator then answers via an orchestration `answer` signal (Task 7 path).

- [ ] **Step 1: Write the failing test** (worker blocks → orchestrator gets a forwarded note)

```python
def test_worker_question_is_forwarded_to_orchestrator_once(client, tmp_path):
    import json
    o = client.post("/sessions", json={"name":"orch","cmd":"cat","cwd":str(tmp_path),
                                       "is_orchestrator": True}).json()["id"]
    w = client.post("/sessions", json={"name":"w","cmd":"cat","cwd":str(tmp_path),
                                       "parent": o, "mission":"m1"}).json()["id"]
    # worker emits a blocking signal
    wb = server._hub_for(str(tmp_path)).agent_dir(w) / "outbox" / "q.json"
    wb.write_text(json.dumps({"id":"q","action":"ask_question","text":"PG or MySQL?"}))
    # the orchestrator's tmux session should receive a forwarded note (cat echoes it)
    got = False
    for _ in range(30):
        screen = client.get(f"/sessions/{o}/screen").text
        if "PG or MySQL?" in screen and w in screen:
            got = True; break
        time.sleep(0.1)
    assert got
    for s in client.get("/sessions").json()["sessions"]:
        client.delete(f"/sessions/{s['id']}")
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_orchestrator_server.py::test_worker_question_is_forwarded_to_orchestrator_once -v` → FAIL.

- [ ] **Step 3: Implement forwarding (collect-then-drain — see invariant)**
- Track per-worker `forwarded_signal_id` in `_meta` to forward each open signal once.
- **Collect phase** (under the worker's lock), for a worker that has a `parent`:
  - if `harness_state == "blocked"` and its open signal id != `forwarded_signal_id` → set `forwarded_signal_id` now and append a forward item `{orch, "worker {w} asks: \"{text}\" options={options}; reply answer{{worker:{w},text:...}} or escalate"}`.
  - if `worker_state == "AWAITING_PERMISSION"`: this is a **brake** (spec). In a **supervised** mission, do NOT forward — record a human brake (Task 9) instead. In an **autopilot** mission, append a forward item once: `"worker {w} hit a permission prompt: \"<dialog tail>\"; reply answer approve|deny"`.
  - Do NOT `send_text` here (worker lock is held).
- **Drain phase** (locks released): for each forward item → `with _lock_for(orch): send_text(note)`. (One lock, the orchestrator's, never nested in the worker's.)
- **Note (spec §12):** a worker left blocked/awaiting-permission while a supervised brake waits for the human simply stays blocked — there is no worker-side turn timeout (the background path uses `send_text`, not the synchronous `/prompt` timeout), so waiting indefinitely is safe.

- [ ] **Step 4: Run to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_orchestrator_server.py -v` → PASS.

- [ ] **Step 5: Commit**

```bash
git add tui_pilot/server.py tests/test_orchestrator_server.py
git commit -m "feat: forward worker questions/permission prompts to the orchestrator"
```

---

### Task 9: missions + per-mission autopilot + brakes endpoints

**Files:** Modify `tui_pilot/server.py`; Test `tests/test_orchestrator_server.py`.

- [ ] **Step 1: Write the failing tests**

```python
def test_missions_list_and_autopilot_toggle(client, tmp_path):
    o = client.post("/sessions", json={"name":"orch","cmd":"cat","cwd":str(tmp_path),
                                       "is_orchestrator": True}).json()["id"]
    client.post("/sessions", json={"name":"w","cmd":"cat","cwd":str(tmp_path),
                                   "parent": o, "mission":"m1"})
    missions = client.get("/missions").json()["missions"]
    assert any(m["mission"] == "m1" for m in missions)
    # default supervised; toggle to autopilot
    r = client.post("/missions/m1/autopilot", json={"autopilot": True})
    assert r.status_code == 200 and r.json()["autopilot"] is True
    assert any(m["mission"]=="m1" and m["autopilot"] for m in client.get("/missions").json()["missions"])
    for s in client.get("/sessions").json()["sessions"]:
        client.delete(f"/sessions/{s['id']}")

def test_opus_spawn_supervised_creates_a_brake_not_a_worker(client, tmp_path):
    import json
    o = client.post("/sessions", json={"name":"orch","cmd":"cat","cwd":str(tmp_path),
                                       "is_orchestrator": True}).json()["id"]
    ob = server._hub_for(str(tmp_path)).agent_dir(o) / "outbox" / "s.json"
    ob.write_text(json.dumps({"id":"s","action":"spawn","role":"plain","cmd":"cat",
                              "model":"opus","task":"hard","mission":"m1","reason":"gnarly"}))
    # supervised (default): a brake should appear, no opus worker spawned
    brake = None
    for _ in range(30):
        brakes = client.get("/brakes").json()["brakes"]
        if brakes: brake = brakes[0]; break
        time.sleep(0.1)
    assert brake and brake["brake"] == "opus_spawn"
    assert not [s for s in client.get("/sessions").json()["sessions"] if s.get("model")=="opus"]
    for s in client.get("/sessions").json()["sessions"]:
        client.delete(f"/sessions/{s['id']}")
```

- [ ] **Step 2: Run to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_orchestrator_server.py -v -k "mission or brake"` → FAIL.

- [ ] **Step 3: Implement missions, autopilot, brakes** (in `orchestrator_server.py`)
- A `_missions: dict[str, dict]` mapping mission id → `{autopilot: bool, activity: [..]}` created lazily when first referenced (spawn with `mission`). Default `autopilot=False` (supervised).
- The executor's `Policy.autopilot` for a given orchestration signal is read from `_missions[sig.mission].autopilot`.
- A `_brakes: dict[str, dict]` (pending), keyed by brake id. When the executor returns `Result.kind=="brake"` (Task 7 drain) OR the forward-collect finds a supervised permission dialog (Task 8), record `{id, mission, brake, detail, signal: <parsed OrchestrationSignal or worker ref>}`. Store the **parsed `OrchestrationSignal`** so `allow` can re-run it without re-parsing.
- Endpoints (an `APIRouter` in `orchestrator_server.py`, included by `server.py`):
  - `POST /orchestrator` → ensure one orchestrator session exists (spawn `role:orchestrator, is_orchestrator:True` if none); return its id.
  - `GET /missions` → list `{mission, autopilot, agents, activity_tail}`.
  - `POST /missions/{id}/autopilot` `{autopilot}` → set + return it.
  - `GET /missions/{id}` → fleet (workers with that mission) + activity.
  - `GET /brakes` → pending brakes.
  - `POST /brakes/{id}/allow` → branch on the brake's record type: an **opus-spawn** brake stores an `OrchestrationSignal` → re-run it through the executor with `Policy.autopilot=True`; a **permission** brake stores a worker ref → call `approve_worker(w)` directly. Remove the brake. Runs in the request thread (no poll lock held → one lock at a time, per the invariant).
  - `POST /brakes/{id}/skip` → drop the brake and `send_text` a note to the orchestrator.

- [ ] **Step 4: Run to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_orchestrator_server.py -v` → PASS.

- [ ] **Step 5: Full offline suite**

Run: `.venv/bin/python -m pytest tests/ -q --ignore=tests/test_integration.py` → all PASS.

- [ ] **Step 6: Commit**

```bash
git add tui_pilot/server.py tests/test_orchestrator_server.py
git commit -m "feat: missions, per-mission autopilot, brakes (allow/skip)"
```

---

## Chunk 5: UI + live verification

### Task 10: orchestrator chat UI + fleet-with-models

**Files:** Modify `tui_pilot/static/{index.html,app.js,style.css}`.

- [ ] **Step 1: Orchestrator bootstrap + chat** — add an `POST /orchestrator` convenience endpoint (ensure one orchestrator session exists; return its id) and a UI "Orchestrator" view: a chat panel bound to the orchestrator session (reuses the existing prompt → screen flow, rendered as a conversation), with a message input. Show the orchestrator's recent screen/output as the chat stream.

- [ ] **Step 2: Fleet-with-models** — in the agents list, show each worker's `model` badge + `reason` tooltip ("why this model") and group by `mission`. Add the per-mission **autopilot toggle** (calls `/missions/{id}/autopilot`). The chat/activity view MUST render the mission's `activity` log (from `GET /missions/{id}`) so the orchestrator's `status`/`narrate` notes are actually visible to you — otherwise `status` is a silent no-op.

- [ ] **Step 3: Brakes inline** — poll `GET /brakes`; render each as an inline **Allow / Skip** card (calls `/brakes/{id}/allow|skip`).

- [ ] **Step 4: Agent terminal + advanced** — keep the existing per-agent screen view reachable (click a worker), and move the manual "New agent" spawn form to an **Advanced** tab/section.

- [ ] **Step 5: Manual verification (no live claude)** — drive with `cat`:
```bash
.venv/bin/python -m uvicorn tui_pilot.server:app --port 8770 &
# create an orchestrator + a worker via cat, drop a spawn signal, confirm UI shows model badge + mission grouping; drop an opus spawn → confirm an Allow/Skip brake card appears.
```
`node --check tui_pilot/static/app.js` must pass.

- [ ] **Step 6: Commit**

```bash
git add tui_pilot/static/
git commit -m "feat: orchestrator chat UI, fleet models, missions, brakes"
```

---

### Task 11: live integration test + README

**Files:** Modify `tests/test_integration.py`, `README.md`.

- [ ] **Step 1: Add an opt-in live test** (behind `TUI_PILOT_LIVE=1`): spawn a real `orchestrator`; chat it a 2-step goal whose first worker is simple (so it should pick `haiku`/`sonnet`) and run the mission on **autopilot**; assert (a) at least one worker was spawned with a `--model`, (b) the mission reaches a finished/idle state, (c) a report is captured. Tolerate model-choice variance (assert a model flag is present, not a specific tier).

```python
@pytest.mark.skipif(not LIVE, reason="set TUI_PILOT_LIVE=1")
def test_orchestrator_runs_a_mission(tmp_path):
    from fastapi.testclient import TestClient
    from tui_pilot import server
    client = TestClient(server.app)
    o = client.post("/sessions", json={"name":"orch","role":"orchestrator",
        "cwd": str(tmp_path), "is_orchestrator": True}).json()["id"]
    # wait ready, set autopilot, then chat a goal
    ...
    # poll /missions until a worker with a --model appears and the mission settles
    ...
```
(Flesh out the polling per the harness live-test pattern; keep generous timeouts.)

- [ ] **Step 2: Run it once locally**

Run: `TUI_PILOT_LIVE=1 .venv/bin/python -m pytest tests/test_integration.py::test_orchestrator_runs_a_mission -v` → PASS (or documented manual confirmation if model phrasing varies).

- [ ] **Step 3: README** — add an "Orchestrator" section: chat to manage, model-per-task with ceiling, supervised vs autopilot + brakes, the orchestration actions, and the new endpoints.

- [ ] **Step 4: Commit**

```bash
git add tests/test_integration.py README.md
git commit -m "test: live orchestrator mission + README orchestrator docs"
```

---

## Definition of done
- All offline tests pass: `.venv/bin/python -m pytest tests/ -q --ignore=tests/test_integration.py`.
- A `spawn` orchestration signal creates a worker launched with the right `--model`, tagged with mission/parent/reason.
- A worker's question/permission prompt is forwarded to the orchestrator once; its `answer` resolves via the correct path (mailbox vs approve/deny).
- An Opus spawn (or above-ceiling) in a supervised mission produces an Allow/Skip brake instead of spawning; on autopilot it proceeds.
- The UI lets you chat the orchestrator, see the fleet with model badges + "why", toggle per-mission autopilot, and resolve brakes.
- No forbidden flags/SDK introduced (`--model` is an allowed interactive flag); `grep` clean.
- README documents the orchestrator.
