# Agent Harness Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a harness to tui-pilot so fleet agents (scattered across any directory) can signal a central control center — ask questions, request context/help, report progress, and finish with a report/handoff — answerable by a human today and a manager agent later.

**Architecture:** A file mailbox in a central hub (`~/.tui-pilot/comms/<id>/{outbox,inbox,handoffs,processed}/`) keyed by a collision-proof agent `id`. A per-session poller (`harness.py`) scans each agent's `outbox/`, derives a harness-state, and orchestrates finish/handoff. Replies are typed back via the existing tmux `send_text()` path. Pure logic (`identity.py`, `comms.py`) is unit-tested offline; the FastAPI server is re-keyed from `name` to `id` and gains signal/answer/report endpoints; the control-center UI gains attention grouping, an answer card, a global inbox, and a report viewer.

**Tech Stack:** Python 3.12, FastAPI, tmux, pytest, vanilla JS/CSS (existing `static/` UI). No new runtime deps.

**Spec:** `docs/superpowers/specs/2026-06-14-agent-harness-design.md`

**Prerequisite:** the project is not yet a git repo. Do Task 0 first so the per-task commit steps work.

---

## File Structure

**New files:**
- `tui_pilot/identity.py` — generate collision-proof agent ids (`slug·token`); slug sanitization.
- `tui_pilot/comms.py` — hub path resolution; atomic write/read/scan of signal files; move-to-processed; report archival. Pure I/O, no tmux.
- `tui_pilot/harness.py` — `Signal` model + validation; `Answerer` interface (human default); `HarnessPoller` that scans a session's outbox, derives harness-state, and performs finish/handoff orchestration.
- `tui_pilot/assets/agent-comms-skill/SKILL.md` — the protocol skill installed into each agent's `.claude/skills/`.
- `tui_pilot/assets/report-template.md` — the handoff report skeleton.
- `tests/test_identity.py`, `tests/test_comms.py`, `tests/test_harness.py` — offline unit tests.

**Modified files:**
- `tui_pilot/session.py` — already supports `cwd`; add `install_skill()` helper to drop the comms skill into `<cwd>/.claude/skills/`.
- `tui_pilot/server.py` — re-key registry/routes from `name` → `id`; spawn assigns id + creates hub + installs skill + injects id/hub into priming; add signal/answer/report/handoff endpoints; include `harness_state` in session info; start a background poller.
- `tui_pilot/static/index.html`, `app.js`, `style.css` — attention grouping, answer card, global inbox, report viewer.
- `tests/test_roles.py` / `tests/test_server.py` — update for id-keyed routes.

---

## Chunk 1: Identity + comms foundation

### Task 0: Initialize git

**Files:** (none)

- [ ] **Step 1: Init repo and baseline commit**

```bash
cd /Users/thiagolopez/time2build/projects/tui-pilot
git init
printf '.venv/\n__pycache__/\n*.pyc\n.pytest_cache/\n.superpowers/\n' > .gitignore
git add -A && git commit -m "chore: baseline before agent harness"
```

Expected: a repo with one commit.

---

### Task 1: Agent identity (`identity.py`)

**Files:**
- Create: `tui_pilot/identity.py`
- Test: `tests/test_identity.py`

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_identity.py
import re
from tui_pilot.identity import slugify, new_agent_id

def test_slugify_kebabs_and_truncates():
    assert slugify("Dev 1") == "dev-1"
    assert slugify("My Cool Agent!!") == "my-cool-agent"
    assert len(slugify("x" * 50)) <= 16

def test_slugify_fallback_for_empty():
    assert slugify("") == "agent"
    assert slugify("###") == "agent"

def test_id_has_slug_prefix_and_token():
    aid = new_agent_id("dev-1")
    assert aid.startswith("dev-1__")
    # slug__token; split on the LAST "__" so hyphenated slugs are unambiguous
    slug, token = aid.rsplit("__", 1)
    assert slug == "dev-1"
    assert re.fullmatch(r"[0-9a-z]{4,}", token)

def test_separator_is_unambiguous_for_hyphenated_slug():
    aid = new_agent_id("my-cool-agent")
    slug, token = aid.rsplit("__", 1)
    assert slug == "my-cool-agent"   # hyphens in slug don't confuse the split

def test_ids_are_unique_under_load():
    ids = {new_agent_id("dev-1") for _ in range(5000)}
    assert len(ids) == 5000  # no collisions even with identical name
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_identity.py -v`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `identity.py`**

```python
# tui_pilot/identity.py
"""Collision-proof agent identity.

id = slug(name) + "__" + token. Uniqueness comes ONLY from the token (a
monotonic counter + time + random, base32), never from the name or cwd — so
similar names / directories can never collide.
"""
from __future__ import annotations

import itertools
import os
import re
import threading
import time

_SLUG_MAX = 16
_counter = itertools.count()
_lock = threading.Lock()

def slugify(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (name or "").strip().lower()).strip("-")
    s = s[:_SLUG_MAX].strip("-")
    return s or "agent"

def _b32(n: int) -> str:
    alphabet = "0123456789abcdefghjkmnpqrstvwxyz"  # crockford-ish
    if n == 0:
        return "0"
    out = []
    while n:
        n, r = divmod(n, 32)
        out.append(alphabet[r])
    return "".join(reversed(out))

def new_token() -> str:
    with _lock:
        c = next(_counter)
    # time (ms) ⊕ counter ⊕ os.urandom → short, monotonic-ish, unique
    t = int(time.time() * 1000)
    rnd = int.from_bytes(os.urandom(3), "big")
    return _b32((t << 24) ^ (c << 8) ^ rnd)[-7:]

def new_agent_id(name: str) -> str:
    # double-underscore separator: ASCII-safe for tmux/folders AND unambiguous
    # (rsplit on "__") even when the slug itself contains hyphens.
    return f"{slugify(name)}__{new_token()}"
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_identity.py -v`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add tui_pilot/identity.py tests/test_identity.py
git commit -m "feat: collision-proof agent identity"
```

---

### Task 2: Comms mailbox (`comms.py`)

**Files:**
- Create: `tui_pilot/comms.py`
- Test: `tests/test_comms.py`

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_comms.py
import json
from pathlib import Path
import pytest
from tui_pilot.comms import Hub

@pytest.fixture()
def hub(tmp_path):
    return Hub(root=tmp_path / "comms")

def test_paths_are_per_agent(hub):
    p = hub.agent_dir("dev-1-abc")
    assert p.name == "dev-1-abc"
    for sub in ("outbox", "inbox", "handoffs", "processed"):
        assert (p / sub).is_dir()  # created on demand

def test_scan_returns_new_outbox_signals(hub):
    aid = "dev-1-abc"
    hub.agent_dir(aid)
    (hub.agent_dir(aid) / "outbox" / "s1.json").write_text(
        json.dumps({"id": "s1", "action": "progress", "text": "hi"})
    )
    sigs = hub.scan(aid)
    assert [s["id"] for s in sigs] == ["s1"]

def test_mark_processed_is_idempotent(hub):
    aid = "dev-1-abc"
    out = hub.agent_dir(aid) / "outbox" / "s1.json"
    out.write_text(json.dumps({"id": "s1", "action": "progress"}))
    hub.mark_processed(aid, "s1")
    assert not out.exists()
    assert (hub.agent_dir(aid) / "processed" / "s1.json").exists()
    assert hub.scan(aid) == []          # gone from outbox
    hub.mark_processed(aid, "s1")       # second call: no error

def test_malformed_json_is_quarantined_not_raised(hub):
    aid = "dev-1-abc"
    (hub.agent_dir(aid) / "outbox" / "bad.json").write_text("{ not json")
    sigs = hub.scan(aid)
    assert sigs == []                   # bad file skipped
    assert (hub.agent_dir(aid) / "processed" / "bad.json").exists()

def test_archive_report_writes_handoff_copy(hub):
    aid = "dev-1-abc"
    path = hub.archive_report(aid, "# Done\nstuff", ts="20260614-0000")
    assert Path(path).read_text().startswith("# Done")
    assert "handoffs" in path
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_comms.py -v`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `comms.py`**

```python
# tui_pilot/comms.py
"""File mailbox hub. Pure filesystem I/O — no tmux, no FastAPI.

Layout:  <root>/<agent-id>/{outbox,inbox,handoffs,processed}/
Signals are JSON files in outbox/. scan() reads new ones; malformed files are
quarantined to processed/ so the poller never crashes. mark_processed() moves a
handled signal to processed/ for idempotency.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

DEFAULT_ROOT = Path.home() / ".tui-pilot" / "comms"
_SUBDIRS = ("outbox", "inbox", "handoffs", "processed")

class Hub:
    def __init__(self, root: Path | str | None = None) -> None:
        self.root = Path(root) if root else DEFAULT_ROOT

    def agent_dir(self, agent_id: str) -> Path:
        base = self.root / agent_id
        for sub in _SUBDIRS:
            (base / sub).mkdir(parents=True, exist_ok=True)
        return base

    def scan(self, agent_id: str) -> list[dict]:
        outbox = self.agent_dir(agent_id) / "outbox"
        signals: list[dict] = []
        for f in sorted(outbox.glob("*.json")):
            try:
                data = json.loads(f.read_text())
                data.setdefault("id", f.stem)
                signals.append(data)
            except (json.JSONDecodeError, OSError):
                # quarantine bad file so we don't re-read it forever
                self._quarantine(agent_id, f)
        return signals

    def mark_processed(self, agent_id: str, signal_id: str) -> None:
        base = self.agent_dir(agent_id)
        src = base / "outbox" / f"{signal_id}.json"
        if src.exists():
            dst = base / "processed" / f"{signal_id}.json"
            os.replace(src, dst)

    def write_inbox(self, agent_id: str, signal_id: str, payload: dict) -> None:
        dst = self.agent_dir(agent_id) / "inbox" / f"{signal_id}.json"
        dst.write_text(json.dumps(payload, indent=2))

    def archive_report(self, agent_id: str, report: str, ts: str) -> str:
        dst = self.agent_dir(agent_id) / "handoffs" / f"{agent_id}-{ts}.md"
        dst.write_text(report)
        return str(dst)

    def _quarantine(self, agent_id: str, f: Path) -> None:
        dst = self.agent_dir(agent_id) / "processed" / f.name
        try:
            os.replace(f, dst)
        except OSError:
            pass
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_comms.py -v`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add tui_pilot/comms.py tests/test_comms.py
git commit -m "feat: file mailbox hub (comms.py)"
```

---

## Chunk 2: Harness logic (signals, validation, orchestration)

### Task 3: Signal model + validation (`harness.py` part 1)

**Files:**
- Create: `tui_pilot/harness.py`
- Test: `tests/test_harness.py`

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_harness.py
import pytest
from tui_pilot.harness import parse_signal, ACTIONS, BLOCKING

def test_parse_valid_ask_question():
    s = parse_signal({"id": "s1", "action": "ask_question",
                      "text": "PG or MySQL?", "options": ["pg", "mysql"]})
    assert s.action == "ask_question"
    assert s.is_blocking is True
    assert s.options == ["pg", "mysql"]

def test_progress_is_non_blocking():
    assert parse_signal({"id": "s2", "action": "progress", "text": "2/5"}).is_blocking is False

def test_finished_carries_report_and_optional_next():
    s = parse_signal({"id": "s3", "action": "finished", "report": "# Done",
                      "next": {"role": "developer", "task": "Implement plan.md"}})
    assert s.report.startswith("# Done")
    assert s.next["role"] == "developer"
    assert s.is_terminal is True

def test_unknown_action_raises():
    with pytest.raises(ValueError):
        parse_signal({"id": "s4", "action": "explode"})

def test_blocking_set_matches_spec():
    assert BLOCKING == {"ask_question", "need_context", "need_help"}
    assert "finished" in ACTIONS
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_harness.py -v`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement signal model**

```python
# tui_pilot/harness.py
"""Harness: signal model + poller + finish/handoff orchestration."""
from __future__ import annotations

from dataclasses import dataclass, field

ACTIONS = {"ask_question", "need_context", "need_help", "progress", "finished"}
BLOCKING = {"ask_question", "need_context", "need_help"}

@dataclass
class Signal:
    id: str
    action: str
    text: str = ""
    options: list[str] = field(default_factory=list)
    refs: list[str] = field(default_factory=list)
    report: str = ""
    next: dict | None = None
    ts: str = ""

    @property
    def is_blocking(self) -> bool:
        return self.action in BLOCKING

    @property
    def is_terminal(self) -> bool:
        return self.action == "finished"

def parse_signal(data: dict) -> Signal:
    action = data.get("action")
    if action not in ACTIONS:
        raise ValueError(f"unknown action {action!r}")
    return Signal(
        id=data.get("id", ""),
        action=action,
        text=data.get("text", ""),
        options=list(data.get("options") or []),
        refs=list(data.get("refs") or []),
        report=data.get("report", ""),
        next=data.get("next"),
        ts=data.get("ts", ""),
    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_harness.py -v`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add tui_pilot/harness.py tests/test_harness.py
git commit -m "feat: harness signal model + validation"
```

---

### Task 4: Harness state derivation + poller

**Files:**
- Modify: `tui_pilot/harness.py`
- Test: `tests/test_harness.py`

- [ ] **Step 1: Write the failing tests** (append)

```python
from tui_pilot.harness import HarnessPoller, HarnessState
from tui_pilot.comms import Hub
import json

class _FakeSession:
    """Stand-in for TmuxSession: alive + records typed text."""
    def __init__(self, alive=True): self._alive = alive; self.sent = []
    def is_alive(self): return self._alive
    def send_text(self, t): self.sent.append(t)

def _emit(hub, aid, payload):
    (hub.agent_dir(aid) / "outbox" / f"{payload['id']}.json").write_text(json.dumps(payload))

def test_poller_surfaces_blocking_signal(tmp_path):
    hub = Hub(tmp_path); aid = "dev-1-a"; sess = _FakeSession()
    poller = HarnessPoller(aid, sess, hub)
    _emit(hub, aid, {"id": "s1", "action": "ask_question", "text": "PG?"})
    state = poller.poll()
    assert state.kind == "blocked"
    assert state.open_signal.action == "ask_question"

def test_answer_types_via_tmux_and_clears_block(tmp_path):
    hub = Hub(tmp_path); aid = "dev-1-a"; sess = _FakeSession()
    poller = HarnessPoller(aid, sess, hub)
    _emit(hub, aid, {"id": "s1", "action": "ask_question", "text": "PG?"})
    poller.poll()
    poller.answer("s1", "Postgres")
    assert sess.sent == ["Postgres"]                 # typed into agent
    assert poller.poll().kind != "blocked"           # block cleared

def test_progress_is_recorded_not_blocking(tmp_path):
    hub = Hub(tmp_path); aid = "dev-1-a"; sess = _FakeSession()
    poller = HarnessPoller(aid, sess, hub)
    _emit(hub, aid, {"id": "p1", "action": "progress", "text": "2/5"})
    state = poller.poll()
    assert state.kind != "blocked"
    assert poller.timeline[-1].text == "2/5"

def test_finished_writes_summary_and_archives_and_handoffs(tmp_path):
    hub = Hub(tmp_path); aid = "dev-1-a"; sess = _FakeSession()
    cwd = tmp_path / "proj"; cwd.mkdir()
    (cwd / "SUMMARY.md").write_text("OLD")          # must be overwritten
    spawned = []
    poller = HarnessPoller(aid, sess, hub, cwd=str(cwd),
                           on_handoff=lambda nxt, rpt: spawned.append((nxt, rpt)))
    _emit(hub, aid, {"id": "f1", "action": "finished", "report": "# Done\nok",
                     "next": {"role": "developer", "task": "Implement plan.md", "start": "auto"}})
    state = poller.poll()
    assert state.kind == "done"
    assert state.report.startswith("# Done")
    assert (cwd / "SUMMARY.md").read_text() == "# Done\nok"        # overwritten in cwd
    assert list((hub.agent_dir(aid) / "handoffs").glob("*.md"))    # archived copy
    assert spawned and spawned[0][0]["role"] == "developer"        # auto handoff fired
    assert spawned[0][1].startswith("# Done")                      # report passed to handoff

def test_finished_confirm_handoff_is_pending_not_fired(tmp_path):
    hub = Hub(tmp_path); aid = "dev-1-a"; sess = _FakeSession()
    cwd = tmp_path / "proj"; cwd.mkdir()
    spawned = []
    poller = HarnessPoller(aid, sess, hub, cwd=str(cwd),
                           on_handoff=lambda nxt, rpt: spawned.append(nxt))
    _emit(hub, aid, {"id": "f1", "action": "finished", "report": "# Done",
                     "next": {"role": "developer", "task": "x", "start": "confirm"}})
    poller.poll()
    assert spawned == []                            # not auto-fired
    assert poller.pending_handoff["role"] == "developer"
    fired = poller.confirm_handoff()                # explicit confirm spawns it
    assert fired is True and spawned and spawned[0]["role"] == "developer"

def test_dead_agent_reports_exited(tmp_path):
    hub = Hub(tmp_path); poller = HarnessPoller("d", _FakeSession(alive=False), hub, cwd="/tmp")
    assert poller.poll().kind == "exited"
```

- [ ] **Step 2: Run to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_harness.py -v`
Expected: FAIL (HarnessPoller missing).

- [ ] **Step 3: Implement poller + state** (append to `harness.py`)

```python
from dataclasses import dataclass
from typing import Callable

@dataclass
class HarnessState:
    kind: str                      # "idle" | "blocked" | "done" | "exited"
    open_signal: Signal | None = None
    report: str = ""

class HarnessPoller:
    """Per-session: scans outbox, derives state, orchestrates finish/handoff.

    on_handoff(next_dict, report) is called by the server to spawn a successor
    when a finished signal carries next.start == "auto" (or after a UI confirm).
    """
    def __init__(self, agent_id, session, hub, cwd: str | None = None,
                 on_handoff: Callable | None = None):
        self.agent_id = agent_id
        self.session = session
        self.hub = hub
        self.cwd = cwd                     # where to write SUMMARY.md
        self.on_handoff = on_handoff
        self.open_signal: Signal | None = None
        self.timeline: list[Signal] = []
        self.done_report: str = ""
        self.pending_handoff: dict | None = None

    def poll(self) -> HarnessState:
        if not self.session.is_alive():
            return HarnessState("exited")
        for data in self.hub.scan(self.agent_id):
            try:
                sig = parse_signal(data)
            except ValueError:
                self.hub.mark_processed(self.agent_id, data.get("id", ""))
                continue
            self._handle(sig)
        if self.done_report:
            return HarnessState("done", report=self.done_report)
        if self.open_signal:
            return HarnessState("blocked", open_signal=self.open_signal)
        return HarnessState("idle")

    def _handle(self, sig: Signal) -> None:
        if sig.action == "progress":
            self.timeline.append(sig)
            self.hub.mark_processed(self.agent_id, sig.id)
        elif sig.is_blocking:
            self.open_signal = sig          # at most one at a time (spec §3.5)
        elif sig.is_terminal:
            self._finish(sig)

    def _finish(self, sig: Signal) -> None:
        import time
        from pathlib import Path
        ts = time.strftime("%Y%m%d-%H%M%S")
        self.done_report = sig.report or "(no report)"
        # 1. write SUMMARY.md into the project cwd (overwrite, like plan.md)
        if self.cwd:
            (Path(self.cwd) / "SUMMARY.md").write_text(self.done_report)
        # 2. archive a copy into the hub's handoffs/
        self.hub.archive_report(self.agent_id, self.done_report, ts)
        self.hub.mark_processed(self.agent_id, sig.id)
        # 3. handoff: auto fires now; confirm waits for confirm_handoff()
        nxt = sig.next or None
        if nxt and nxt.get("start") == "auto" and self.on_handoff:
            self.on_handoff(nxt, self.done_report)
        elif nxt:
            self.pending_handoff = nxt      # waits for UI confirm

    def confirm_handoff(self) -> bool:
        """Spawn the pending (start:"confirm") successor. Returns True if fired."""
        if self.pending_handoff and self.on_handoff:
            self.on_handoff(self.pending_handoff, self.done_report)
            self.pending_handoff = None
            return True
        return False

    def answer(self, signal_id: str, text: str) -> None:
        """The pluggable 'answerer' seam: a human (v1) or a PM agent (future)
        calls this to reply. The reply is typed into the agent via tmux."""
        if self.open_signal and self.open_signal.id == signal_id:
            self.session.send_text(text)
            self.hub.write_inbox(self.agent_id, signal_id, {"answer": text})
            self.hub.mark_processed(self.agent_id, signal_id)
            self.open_signal = None
```

- [ ] **Step 4: Run to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_harness.py -v`
Expected: PASS (all harness tests).

- [ ] **Step 5: Commit**

```bash
git add tui_pilot/harness.py tests/test_harness.py
git commit -m "feat: harness poller + finish/handoff orchestration"
```

---

## Chunk 3: Protocol assets + session/server integration

### Task 5: Protocol skill + report template assets

**Files:**
- Create: `tui_pilot/assets/agent-comms-skill/SKILL.md`
- Create: `tui_pilot/assets/report-template.md`

- [ ] **Step 1: Write the skill** (`SKILL.md`)

```markdown
---
name: agent-comms
description: Use ALWAYS while running under the tui-pilot control center — to ask a question, request context, ask for help, report progress, or finish.
---

# Talking to the control center

You run under an automated control center. To communicate, **write a JSON file**
to your outbox (path + your agent id are given in your first instructions):

`<HUB>/<AGENT_ID>/outbox/<unique>.json`

Shape:
{ "id": "<unique>", "action": "...", "text": "...", "options": [...]?, "refs": [...]?,
  "report": "...md"?, "next": {"role","task","mode","start"}? }

Actions:
- ask_question  — need a decision. Add "options" for presets. THEN END YOUR TURN and wait;
  the answer arrives as your next message.
- need_context  — missing info/files/credentials. END YOUR TURN and wait.
- need_help     — stuck/blocked. Attach paths in "refs". END YOUR TURN and wait.
- progress      — status heartbeat. Do NOT wait; keep working.
- finished      — mission complete. Always include "report" (Done / Current state /
  What's next / Open questions / Artifacts). Add "next" ONLY to request a successor agent.

Rules: one blocking signal at a time; after a blocking signal, stop and wait for the
reply (you'll receive it as your next user message). Do not poll your inbox.
```

- [ ] **Step 2: Write the report template** (`report-template.md`)

```markdown
# Done
<what you accomplished>

# Current state
<where things stand now>

# What's next
<recommended next steps>

# Open questions
<unresolved decisions>

# Artifacts
<files/paths produced, absolute>
```

- [ ] **Step 3: Commit**

```bash
git add tui_pilot/assets/
git commit -m "feat: agent-comms protocol skill + report template"
```

---

### Task 6: Install skill into agent cwd (`session.py`)

**Files:**
- Modify: `tui_pilot/session.py`
- Test: `tests/test_session_skill.py` (create)

- [ ] **Step 1: Write the failing test**

```python
# tests/test_session_skill.py
from pathlib import Path
from tui_pilot.session import install_comms_skill

def test_install_copies_skill_into_cwd(tmp_path):
    install_comms_skill(tmp_path)
    skill = tmp_path / ".claude" / "skills" / "agent-comms" / "SKILL.md"
    assert skill.is_file()
    assert "ask_question" in skill.read_text()
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_session_skill.py -v`
Expected: FAIL (function missing).

- [ ] **Step 3: Implement `install_comms_skill`** (add to `session.py`)

```python
import shutil
from pathlib import Path

_ASSETS = Path(__file__).resolve().parent / "assets"

def install_comms_skill(cwd: str | Path) -> None:
    """Copy the agent-comms skill into <cwd>/.claude/skills/ so the spawned
    agent reads it on boot. Idempotent."""
    dst = Path(cwd) / ".claude" / "skills" / "agent-comms"
    dst.mkdir(parents=True, exist_ok=True)
    shutil.copy(_ASSETS / "agent-comms-skill" / "SKILL.md", dst / "SKILL.md")
```

- [ ] **Step 4: Run to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_session_skill.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tui_pilot/session.py tests/test_session_skill.py
git commit -m "feat: install comms skill into agent cwd on spawn"
```

---

### Task 7: Re-key server registry from `name` to `id`

**Files:**
- Modify: `tui_pilot/server.py`
- Test: `tests/test_server.py` (update), `tests/test_roles.py` (update)

- [ ] **Step 1: Update tests to expect id-keyed responses**

In `tests/test_server.py` and `tests/test_roles.py`, change spawn flow to read
the returned `id` and use it in subsequent routes. Example edit to the lifecycle
test:

```python
def test_full_lifecycle(client):
    r = client.post("/sessions", json={"name": "srv", "cmd": "cat", "cols": 80, "rows": 24})
    assert r.status_code == 200
    aid = r.json()["id"]                     # NEW: id is generated
    assert aid.startswith("srv__")
    listed = client.get("/sessions").json()["sessions"]
    assert any(s["id"] == aid for s in listed)
    assert client.get(f"/sessions/{aid}/state").status_code == 200
    client.post(f"/sessions/{aid}/key", json={"key": "h"})
    ...
    assert client.delete(f"/sessions/{aid}").status_code == 200
```

Also: spawning the same `name` twice should now BOTH succeed (no 409):

```python
def test_same_name_spawns_two_distinct_agents(client):
    a = client.post("/sessions", json={"name": "dup", "cmd": "cat"}).json()["id"]
    b = client.post("/sessions", json={"name": "dup", "cmd": "cat"}).json()["id"]
    assert a != b
    client.delete(f"/sessions/{a}"); client.delete(f"/sessions/{b}")
```

- [ ] **Step 2: Run to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_server.py tests/test_roles.py -v`
Expected: FAIL (routes still keyed by name; no `id` in response).

- [ ] **Step 3: Re-key the server**

In `tui_pilot/server.py`:
- `create_session`: generate `aid = new_agent_id(req.name)` (from `tui_pilot.identity`); use `aid` as the `TmuxSession` name and the `_sessions`/`_meta`/`_locks` key; store `name`, `cwd`, `id=aid` in meta; remove the duplicate-name 409 check; return `_info(aid)`.
- Replace every `{name}` path param with `{id}` and every `_get(name)` with `_get(id)`; update `_info` to include `"id"`.
- Keep `name` in meta for display.

```python
from .identity import new_agent_id
# in create_session, replacing the 409 + spawn block:
aid = new_agent_id(req.name)
sess = TmuxSession(aid, cmd, cols=req.cols, rows=req.rows, cwd=req.cwd)
sess.spawn()
_sessions[aid] = Controller(sess)
_locks[aid] = threading.Lock()
_meta[aid] = {"id": aid, "name": req.name, "cwd": req.cwd, "role": req.role,
              "label": ..., "emoji": ..., "mode": mode, "instructions": instructions,
              "task": req.task, "prep": "booting", "prep_detail": None, "order": _order}
```

- [ ] **Step 4: Run to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_server.py tests/test_roles.py -v`
Expected: PASS (incl. the two-distinct-agents test).

- [ ] **Step 5: Commit**

```bash
git add tui_pilot/server.py tests/test_server.py tests/test_roles.py
git commit -m "refactor: key sessions by generated id (fixes duplicate-name 409)"
```

---

### Task 8a: Extract a reusable `_spawn_agent()` helper

The FastAPI route `create_session` currently does spawn work inline. The handoff
closure (Task 8c) must spawn off the request thread, so first extract the spawn
logic into a plain callable both the route and the poller callback can use.

**Files:**
- Modify: `tui_pilot/server.py`
- Test: `tests/test_harness_server.py` (create)

- [ ] **Step 1: Write the failing test**

```python
# tests/test_harness_server.py
import json, time
import pytest
from fastapi.testclient import TestClient
from tui_pilot import server
from tui_pilot.comms import Hub

@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(server, "HUB", Hub(tmp_path))   # isolate the hub
    return TestClient(server.app)

def test_spawn_agent_helper_returns_distinct_ids(client):
    a = server._spawn_agent(name="x", cmd="cat")
    b = server._spawn_agent(name="x", cmd="cat")        # same name OK now
    assert a["id"] != b["id"]
    server.delete_session(a["id"]); server.delete_session(b["id"])
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_harness_server.py::test_spawn_agent_helper_returns_distinct_ids -v`
Expected: FAIL (`_spawn_agent` missing).

- [ ] **Step 3: Extract the helper**

In `tui_pilot/server.py`, add a module-level function that contains all the
spawn logic currently inside `create_session` (id generation, `TmuxSession`
creation, registry/meta/lock setup, hub dir creation, skill install, poller
creation, priming thread launch). Make `create_session` call it:

```python
def _spawn_agent(*, name, role=None, cmd=None, instructions=None, task=None,
                 mode=None, cwd=None, cols=200, rows=50, report_context=None) -> dict:
    """Spawn one agent and register it. Shared by the HTTP route and handoffs.
    report_context (a handoff report) is prepended to the mission task if given."""
    # ... resolve role/cmd/mode/instructions (existing logic) ...
    aid = new_agent_id(name)
    sess = TmuxSession(aid, cmd, cols=cols, rows=rows, cwd=cwd)
    sess.spawn()
    _sessions[aid] = Controller(sess)
    _locks[aid] = threading.Lock()
    HUB.agent_dir(aid)
    install_comms_skill(cwd or os.getcwd())
    _pollers[aid] = HarnessPoller(aid, sess, HUB, cwd=cwd or os.getcwd(),
                                  on_handoff=_make_handoff(name_hint=name, cwd=cwd))
    eff_task = task
    if report_context and task:
        eff_task = f"Context from the previous agent's handoff report:\n\n{report_context}\n\n---\nYour task: {task}"
    _meta[aid] = { ... "id": aid, "name": name, "cwd": cwd, "task": eff_task, ... }
    threading.Thread(target=_prime, args=(aid,), daemon=True).start()
    return _info(aid)

@app.post("/sessions")
def create_session(req: SpawnRequest) -> dict:
    with _registry_lock:
        return _spawn_agent(name=req.name, role=req.role, cmd=req.cmd,
                            instructions=req.instructions, task=req.task,
                            mode=req.mode, cwd=req.cwd, cols=req.cols, rows=req.rows)
```

- [ ] **Step 4: Run to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_harness_server.py::test_spawn_agent_helper_returns_distinct_ids -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tui_pilot/server.py tests/test_harness_server.py
git commit -m "refactor: extract _spawn_agent() helper for reuse by handoffs"
```

---

### Task 8b: Non-blocking mission so the lock is never held long

Spec §3.5: a mission must run turn-by-turn, not as one 1800s `prompt()` that
holds the per-session lock — otherwise `answer()` (which needs the lock to
`send_text`) contends with the still-running mission. Convert `_prime` so the
mission turn is fire-and-forget; the poller observes subsequent state.

**Files:**
- Modify: `tui_pilot/server.py`
- Test: `tests/test_harness_server.py`

- [ ] **Step 1: Write the failing test**

```python
def test_mission_does_not_hold_lock(client):
    """After priming, the per-session lock must be free so answers can be typed
    while the agent works. We assert the lock is releasable promptly."""
    aid = client.post("/sessions", json={"name": "m", "cmd": "cat",
                                         "task": "echo working"}).json()["id"]
    # give prep a moment, then the lock must be acquirable (not held by a
    # long-running mission prompt)
    time.sleep(1.0)
    lock = server._locks[aid]
    acquired = lock.acquire(timeout=2.0)
    assert acquired is True
    lock.release()
    client.delete(f"/sessions/{aid}")
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_harness_server.py::test_mission_does_not_hold_lock -v`
Expected: FAIL (current `_prime` holds the lock for the whole `prompt(task, 1800)`).

- [ ] **Step 3: Make the mission non-blocking in `_prime`**

In `_prime()`, change the task phase: instead of `ctrl.prompt(task, timeout=1800)`
(which blocks holding the lock), acquire the lock only to *send* the task, then
release it and let the agent run — the background poller (Task 8c) tracks
progress, blocking signals, and finish:

```python
# inside _prime, replacing the task block:
task = (m.get("task") or "").strip()
if task:
    m["prep"] = "working"; m["prep_detail"] = task[:80]
    with lock:
        ctrl.session.send_text(task)     # fire the mission, then release
    # do NOT wait for turn end here — the poller observes state from now on
m["prep"] = "ready"
```

(Priming instructions in step 2 of `_prime` keep using the short `ctrl.prompt(...)`
ack — those are brief and fine to block on.)

- [ ] **Step 4: Run to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_harness_server.py::test_mission_does_not_hold_lock -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tui_pilot/server.py tests/test_harness_server.py
git commit -m "fix: fire mission non-blocking so answers never contend for the lock"
```

---

### Task 8c: Hub/poller wiring, priming injection, and endpoints

**Files:**
- Modify: `tui_pilot/server.py`
- Test: `tests/test_harness_server.py`

- [ ] **Step 1: Write the failing tests**

```python
def test_signal_surfaces_and_can_be_answered(client):
    aid = client.post("/sessions", json={"name": "h", "cmd": "cat"}).json()["id"]
    out = server.HUB.agent_dir(aid) / "outbox" / "s1.json"
    out.write_text(json.dumps({"id": "s1", "action": "ask_question", "text": "PG?"}))
    sigs = []
    for _ in range(20):
        sigs = client.get(f"/sessions/{aid}/signals").json()["signals"]
        if sigs: break
        time.sleep(0.1)
    assert sigs and sigs[0]["action"] == "ask_question"
    assert client.post(f"/sessions/{aid}/answer",
                       json={"signal_id": "s1", "text": "Postgres"}).status_code == 200
    assert client.get(f"/sessions/{aid}/signals").json()["signals"] == []   # cleared
    client.delete(f"/sessions/{aid}")

def test_session_info_includes_harness_state(client):
    aid = client.post("/sessions", json={"name": "h", "cmd": "cat"}).json()["id"]
    assert "harness_state" in client.get(f"/sessions/{aid}").json()
    client.delete(f"/sessions/{aid}")

def test_finished_report_and_confirm_handoff_endpoint(client, tmp_path):
    cwd = str(tmp_path / "proj"); import os; os.makedirs(cwd)
    aid = client.post("/sessions", json={"name": "f", "cmd": "cat", "cwd": cwd}).json()["id"]
    out = server.HUB.agent_dir(aid) / "outbox" / "f1.json"
    out.write_text(json.dumps({"id": "f1", "action": "finished", "report": "# Done",
                               "next": {"role": "plain", "cmd": "cat", "task": "go",
                                        "start": "confirm"}}))
    for _ in range(20):
        if client.get(f"/sessions/{aid}").json()["harness_state"] == "done": break
        time.sleep(0.1)
    assert client.get(f"/sessions/{aid}/report").text.startswith("# Done")
    n_before = len(client.get("/sessions").json()["sessions"])
    assert client.post(f"/sessions/{aid}/handoff").status_code == 200   # confirm fires it
    n_after = len(client.get("/sessions").json()["sessions"])
    assert n_after == n_before + 1                                      # successor spawned
    for s in client.get("/sessions").json()["sessions"]:
        client.delete(f"/sessions/{s['id']}")
```

- [ ] **Step 2: Run to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_harness_server.py -v`
Expected: FAIL (no HUB / `_pollers` / routes yet).

- [ ] **Step 3: Implement wiring + endpoints**

In `tui_pilot/server.py`:
- Module-level: `import os`; `from .comms import Hub`; `from .harness import HarnessPoller`; `from .session import install_comms_skill`; `from .identity import new_agent_id`; `HUB = Hub()`; `_pollers: dict[str, HarnessPoller] = {}`.
- A background daemon thread started at import that loops over `_pollers.values()` every ~1s calling `poll()` (wrap each in try/except so one bad session can't stop the loop). This processes progress/finish even when no UI is polling.
- Priming injection: in `_prime` step 2, prepend to the instructions:
  `f"You are agent '{aid}' under a control center. To ask, get help, report progress, or finish, follow the agent-comms skill and write JSON to {HUB.agent_dir(aid)/'outbox'}. "`.
- `_info(aid)`: add `"harness_state": _pollers[aid].poll().kind if aid in _pollers else None`.
- `_make_handoff(name_hint, cwd)`: returns `lambda nxt, report: _spawn_agent(name=nxt.get("role") or name_hint, role=nxt.get("role"), cmd=nxt.get("cmd"), task=nxt.get("task"), mode=nxt.get("mode"), cwd=nxt.get("cwd") or cwd, report_context=report)`.
- Routes (all keyed by `{id}`):
  - `GET /sessions/{id}/signals` → `{"signals": [asdict(s.open_signal)] if blocked else []}`.
  - `POST /sessions/{id}/answer` `{signal_id, text}` → `_pollers[id].answer(signal_id, text)`; `{"ok": True}`.
  - `GET /sessions/{id}/report` (PlainText) → `_pollers[id].done_report` or 404.
  - `POST /sessions/{id}/handoff` → `_pollers[id].confirm_handoff()`; `{"ok": fired}`.
- `delete_session`: also `_pollers.pop(id, None)`.

- [ ] **Step 4: Run to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_harness_server.py -v`
Expected: PASS (all 5 harness-server tests, incl. confirm-handoff).

- [ ] **Step 5: Run the FULL offline suite**

Run: `.venv/bin/python -m pytest tests/ -q --ignore=tests/test_integration.py`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add tui_pilot/server.py tests/test_harness_server.py
git commit -m "feat: hub/poller wiring, priming injection, signal/answer/report/handoff endpoints"
```

---

## Chunk 4: Control-center UI + live verification

### Task 9: UI — attention grouping + answer card + report viewer

**Files:**
- Modify: `tui_pilot/static/app.js`, `index.html`, `style.css`

- [ ] **Step 1: Fleet grouping + harness-state on cards** — in `app.js` `renderAgents()`, sort/group by `harness_state` (`blocked` → top "Needs attention", then `working`, then idle), and render a 🔴 marker + the open action badge. Cards already show name + cwd (add `cwd` line if missing).

- [ ] **Step 2: Answer card** — when the focused agent's `harness_state === "blocked"`, fetch `GET /sessions/{id}/signals`, render the answer card above the screen: the `text`, option buttons (each posts `/answer` with that option), and a free-text box + Send (posts `/answer` with the typed text). On success, refresh.

- [ ] **Step 3: Global Inbox** (spec §6) — add an "Inbox" toggle/tab above the fleet list that, when active, queries every session's `harness_state` from the existing `GET /sessions` poll and renders a flat list of all agents whose state is `blocked`, each as the same answer card (reusing the Step 2 component, parameterized by agent id). This lets you triage/answer across the whole fleet without switching focus. No new endpoint — it reuses `/sessions` + per-agent `/signals` + `/answer`.

- [ ] **Step 4: Report viewer** — when `harness_state === "done"`, fetch `GET /sessions/{id}/report` and show it in the right panel with "Archive & kill" (DELETE) and, if a pending handoff exists, "Spawn successor ▶" (POST `/handoff`). (Park-not-kill is the default: a DONE agent stays in the list until you click Archive & kill; an auto-kill *setting* is deferred per spec §10 — note it in the README "future" list, do not build it now.)

- [ ] **Step 5: Progress timeline** — show non-blocking progress notes as a quiet list in the activity log (already present; just label them).

- [ ] **Step 6: Manual verification (no live claude needed)** — drive it with a `cat` session and a hand-written signal file:

Run:
```bash
.venv/bin/python -m uvicorn tui_pilot.server:app --port 8765 &
# spawn a cat agent in the UI, then:
AID=$(curl -s -X POST localhost:8765/sessions -d '{"name":"ui","cmd":"cat"}' -H 'content-type: application/json' | .venv/bin/python -c 'import sys,json;print(json.load(sys.stdin)["id"])')
echo '{"id":"s1","action":"ask_question","text":"PG or MySQL?","options":["pg","mysql"]}' > ~/.tui-pilot/comms/$AID/outbox/s1.json
```
Expected: the agent floats to "Needs attention" with a 🔴; focusing it (and the Global Inbox) shows the answer card with pg/mysql buttons.

- [ ] **Step 7: Commit**

```bash
git add tui_pilot/static/
git commit -m "feat: control-center UI — attention, answer card, report viewer"
```

---

### Task 10: Live integration test

**Files:**
- Modify: `tests/test_integration.py`

- [ ] **Step 1: Add an opt-in live test** (behind `TUI_PILOT_LIVE=1`, via TestClient against a real `claude`)

```python
import os, time, json, pytest
from fastapi.testclient import TestClient
from tui_pilot import server

LIVE = os.environ.get("TUI_PILOT_LIVE") == "1"

@pytest.mark.skipif(not LIVE, reason="set TUI_PILOT_LIVE=1")
def test_agent_emits_question_then_finishes(tmp_path):
    cwd = str(tmp_path)
    client = TestClient(server.app)
    # A mission that forces exactly one ask_question then a finish.
    aid = client.post("/sessions", json={
        "name": "live", "role": "developer", "mode": "auto", "cwd": cwd,
        "task": ("First, using the agent-comms skill, emit ONE ask_question "
                 "signal asking 'pg or sqlite?' and wait. After I answer, write "
                 "hello.txt with the answer, then emit a finished signal with a "
                 "short report."),
    }).json()["id"]

    # 1. a blocking signal appears
    sig = None
    for _ in range(120):
        sigs = client.get(f"/sessions/{aid}/signals").json()["signals"]
        if sigs: sig = sigs[0]; break
        time.sleep(1)
    assert sig and sig["action"] == "ask_question"

    # 2. answer via the control center (typed into the agent via tmux)
    assert client.post(f"/sessions/{aid}/answer",
                       json={"signal_id": sig["id"], "text": "pg"}).status_code == 200

    # 3. the agent finishes with a captured report
    done = False
    for _ in range(120):
        if client.get(f"/sessions/{aid}").json()["harness_state"] == "done":
            done = True; break
        time.sleep(1)
    assert done
    assert client.get(f"/sessions/{aid}/report").status_code == 200
    assert (tmp_path / "SUMMARY.md").exists()
    client.delete(f"/sessions/{aid}")
```

Note: the model's exact phrasing varies; if it asks the question in prose rather
than via the skill, that's a priming/skill-tuning finding — capture a fixture and
strengthen the role instructions rather than loosening the test.

- [ ] **Step 2: Run it once locally**

Run: `TUI_PILOT_LIVE=1 .venv/bin/python -m pytest tests/test_integration.py -v`
Expected: PASS (or documented manual confirmation if the model's phrasing varies).

- [ ] **Step 3: Update README** — document the harness: hub layout, the protocol skill, the action vocabulary, and the control-center attention/answer flow.

- [ ] **Step 4: Commit**

```bash
git add tests/test_integration.py README.md
git commit -m "test: live harness round-trip + docs"
```

---

## Definition of done
- All offline tests pass: `.venv/bin/python -m pytest tests/ -q --ignore=tests/test_integration.py`.
- Spawning two agents with the same `name` yields two distinct ids (no 409).
- A signal file dropped in an agent's `outbox/` surfaces in the UI's "Needs attention" group; answering types the reply into the agent via tmux and clears the block.
- A `finished` signal captures the report (overwrites `SUMMARY.md`, copies to `handoffs/`); a `next` with `start:"auto"` spawns a successor, `start:"confirm"` shows a Spawn button.
- No forbidden flags/SDK introduced (`grep` clean); autonomy still keystroke-only.
- README documents the harness.
