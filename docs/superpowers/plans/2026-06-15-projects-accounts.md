# Projects, Accounts & SQLite Persistence — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add project-scoped cloud-account binding (account = a managed `CLAUDE_CONFIG_DIR`), with SQLite persistence for accounts, projects, account pools, roles, sessions, and missions, plus reattach-on-restart.

**Architecture:** A new `db.py` owns one SQLite file at `$TUI_PILOT_HOME/tui-pilot.db`. `accounts.py` and `projects.py` are thin domain modules over it. `session.py` gains env injection so spawns can set `CLAUDE_CONFIG_DIR` via `tmux -e`. `server.py` resolves an account at spawn (explicit → project round-robin → default), persists the session, reconciles live tmux on boot, and serves roles from the DB. The orchestrator stays one global, project-aware coordinator. The frontend gains a nav rail + project bar + Accounts/Projects/Agents pages.

**Tech Stack:** Python 3, stdlib `sqlite3`, FastAPI, pytest, tmux, vanilla JS frontend.

**Reference:** Spec at `docs/superpowers/specs/2026-06-15-projects-accounts-design.md`.

**Conventions:**
- Tests live in `tests/test_<module>.py`, plain `pytest` functions, `from tui_pilot.X import Y`.
- Isolate the DB in tests by setting env `TUI_PILOT_HOME` to a `tmp_path` and calling `db.reset()` (a fixture in `conftest.py`, added in Chunk 1).
- Run a single test: `.venv/bin/python -m pytest tests/test_db.py::test_name -v`
- Run all: `.venv/bin/python -m pytest -q`

---

## Chunk 1: SQLite foundation (`db.py`)

**Files:**
- Create: `tui_pilot/db.py`
- Create: `tui_pilot/schema.sql`
- Test: `tests/test_db.py`
- Modify: `tests/conftest.py` (add `tui_pilot_home` autouse fixture)

### Task 1.1: Home + DB path resolution

- [ ] **Step 1: Write the failing test** — `tests/test_db.py`

```python
import os
from pathlib import Path
from tui_pilot import db

def test_home_defaults_to_dot_tui_pilot(monkeypatch):
    monkeypatch.delenv("TUI_PILOT_HOME", raising=False)
    assert db.home() == Path.home() / ".tui-pilot"

def test_home_honors_env(monkeypatch, tmp_path):
    monkeypatch.setenv("TUI_PILOT_HOME", str(tmp_path))
    assert db.home() == tmp_path
    assert db.db_path() == tmp_path / "tui-pilot.db"
```

- [ ] **Step 2: Run, expect fail** — `.venv/bin/python -m pytest tests/test_db.py -v` → FAIL (`No module named tui_pilot.db`).

- [ ] **Step 3: Minimal implementation** — `tui_pilot/db.py`

```python
"""SQLite persistence: one DB file under $TUI_PILOT_HOME (default ~/.tui-pilot)."""
from __future__ import annotations
import os
import sqlite3
import threading
from pathlib import Path

def home() -> Path:
    return Path(os.environ.get("TUI_PILOT_HOME", str(Path.home() / ".tui-pilot")))

def db_path() -> Path:
    return home() / "tui-pilot.db"
```

- [ ] **Step 4: Run, expect pass.**

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(db): home + db_path resolution"`

### Task 1.2: Connection, schema init, reset

- [ ] **Step 1: Write the failing test** (append to `tests/test_db.py`)

```python
def test_connect_creates_schema(monkeypatch, tmp_path):
    monkeypatch.setenv("TUI_PILOT_HOME", str(tmp_path))
    db.reset()
    conn = db.get_conn()
    tables = {r["name"] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"accounts", "projects", "project_accounts",
            "roles", "sessions", "missions", "app_state"} <= tables

def test_foreign_keys_enabled(monkeypatch, tmp_path):
    monkeypatch.setenv("TUI_PILOT_HOME", str(tmp_path))
    db.reset()
    assert db.get_conn().execute("PRAGMA foreign_keys").fetchone()[0] == 1
```

- [ ] **Step 2: Run, expect fail.**

- [ ] **Step 3: Create `tui_pilot/schema.sql`** with the exact tables from spec §4:

```sql
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY, label TEXT, color TEXT,
  provider TEXT DEFAULT 'claude-code', config_dir TEXT,
  is_default INTEGER DEFAULT 0, created_at TEXT
);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, name TEXT, path TEXT,
  account_strategy TEXT DEFAULT 'single', rr_cursor INTEGER DEFAULT 0,
  model_ceiling TEXT, autopilot INTEGER DEFAULT 0, created_at TEXT
);
CREATE TABLE IF NOT EXISTS project_accounts (
  project_id TEXT, account_id TEXT, position INTEGER,
  PRIMARY KEY (project_id, account_id),
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY, label TEXT, emoji TEXT, mode TEXT,
  cmd TEXT DEFAULT 'claude',
  default_model TEXT, description TEXT, instructions TEXT,
  is_system INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, project_id TEXT, account_id TEXT,
  name TEXT, role TEXT, model TEXT, mode TEXT, cwd TEXT,
  mission_id TEXT, parent TEXT, reason TEXT, status TEXT,
  is_orchestrator INTEGER DEFAULT 0, sort_order INTEGER DEFAULT 0,
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS missions (
  id TEXT PRIMARY KEY, project_id TEXT, goal TEXT,
  autopilot INTEGER DEFAULT 0, status TEXT, created_at TEXT
);
CREATE TABLE IF NOT EXISTS app_state (
  id INTEGER PRIMARY KEY CHECK (id = 1), current_project_id TEXT
);
INSERT OR IGNORE INTO app_state (id, current_project_id) VALUES (1, NULL);
```

- [ ] **Step 3b: Implement connection management + a single execution lock** (append to `tui_pilot/db.py`)

> **Thread-safety (blocking design decision):** one `sqlite3.Connection` is shared between the daemon poll-loop thread and FastAPI request handlers. A `sqlite3.Connection` is NOT safe for concurrent use even with `check_same_thread=False`. Therefore **every** query (read and write) goes through `db.query()` / `db.execute()` / `db.tx()`, which serialize on a single module-level re-entrant lock `_exec_lock`. This is the project-wide DB serialization the spec §5 calls for; `accounts.py`/`projects.py`/`sessions_store.py` MUST use these helpers and never touch the raw connection. The lock is re-entrant so a `with db.tx() as cx:` block may call other helpers.

```python
import contextlib

_conn: sqlite3.Connection | None = None
_init_lock = threading.Lock()       # guards lazy connect only
_exec_lock = threading.RLock()      # serializes ALL query execution
_SCHEMA = Path(__file__).resolve().parent / "schema.sql"

def get_conn() -> sqlite3.Connection:
    global _conn
    with _init_lock:
        if _conn is None:
            db_path().parent.mkdir(parents=True, exist_ok=True)
            _conn = sqlite3.connect(str(db_path()), check_same_thread=False)
            _conn.row_factory = sqlite3.Row
            _conn.execute("PRAGMA foreign_keys=ON")
            _conn.execute("PRAGMA journal_mode=WAL")
            _conn.executescript(_SCHEMA.read_text())
            _conn.commit()
        return _conn

@contextlib.contextmanager
def tx():
    """Serialized transaction: yields the connection under _exec_lock, commits
    on success, rolls back on error. Re-entrant (RLock) so nested helper calls
    are safe within one logical transaction."""
    cx = get_conn()
    with _exec_lock:
        try:
            yield cx
            cx.commit()
        except Exception:
            cx.rollback()
            raise

def query(sql: str, params: tuple = ()) -> list[sqlite3.Row]:
    with _exec_lock:
        return get_conn().execute(sql, params).fetchall()

def execute(sql: str, params: tuple = ()) -> None:
    with tx() as cx:
        cx.execute(sql, params)

def reset() -> None:
    """Close the singleton so the next get_conn() reopens at the current path.
    Test-only helper to isolate per-test databases."""
    global _conn
    with _init_lock, _exec_lock:
        if _conn is not None:
            _conn.close()
        _conn = None
```

- [ ] **Step 4: Run, expect pass.** (Note: tests may read via `db.query(...)` instead of `db.get_conn().execute(...)`; both work, but prefer `db.query` in new tests.)

- [ ] **Step 5: Add the autouse fixture** to `tests/conftest.py`:

```python
import pytest

@pytest.fixture(autouse=True)
def tui_pilot_home(monkeypatch, tmp_path):
    """Every test gets its own empty SQLite DB under a temp home."""
    monkeypatch.setenv("TUI_PILOT_HOME", str(tmp_path / "home"))
    from tui_pilot import db
    db.reset()
    yield
    db.reset()
```

- [ ] **Step 6: Run the whole suite** — `.venv/bin/python -m pytest -q`. Expected: existing tests still pass (the fixture only redirects the new DB). Commit: `git add -A && git commit -m "feat(db): schema + connection singleton + test isolation fixture"`

---

## Chunk 2: Accounts module (`accounts.py`) + env injection

**Files:**
- Create: `tui_pilot/accounts.py`
- Modify: `tui_pilot/session.py` (`TmuxSession.spawn` env support)
- Test: `tests/test_accounts.py`, extend `tests/test_session_model.py`

### Task 2.1: Account CRUD + single-default invariant

- [ ] **Step 1: Failing test** — `tests/test_accounts.py`

```python
from tui_pilot import accounts

def test_create_and_get():
    a = accounts.create(id="t2b", label="Time2Build", config_dir="/x/t2b", color="#34d399")
    assert a["label"] == "Time2Build"
    assert accounts.get("t2b")["config_dir"] == "/x/t2b"
    assert [r["id"] for r in accounts.list_all()] == ["t2b"]

def test_single_default_invariant():
    accounts.create(id="a", label="A", config_dir="/a")
    accounts.create(id="b", label="B", config_dir="/b")
    accounts.set_default("a")
    accounts.set_default("b")
    defaults = [r["id"] for r in accounts.list_all() if r["is_default"]]
    assert defaults == ["b"]
    assert accounts.default_account()["id"] == "b"

def test_default_account_none_when_empty():
    assert accounts.default_account() is None
```

- [ ] **Step 2: Run, expect fail.**

- [ ] **Step 3: Implement** `tui_pilot/accounts.py` (CRUD over `db.get_conn()`; `created_at` via `datetime.now(timezone.utc).isoformat()` — note: scripts use real time here, this is production code, allowed). `set_default(id)` runs `UPDATE accounts SET is_default=0; UPDATE accounts SET is_default=1 WHERE id=?` in one transaction. `default_account()` returns the row with `is_default=1` or `None`.

- [ ] **Step 4: Run, expect pass.**

- [ ] **Step 5: Commit** — `git commit -am "feat(accounts): CRUD + single-default invariant"`

### Task 2.2: Discover managed + importable dirs, auth status

- [ ] **Step 1: Failing test**

> Note: the autouse `tui_pilot_home` fixture already points `TUI_PILOT_HOME` at a temp home and resets the DB — tests below rely on it and do NOT re-`setenv`. Use `accounts.provider_dir()` / `db.home()` to locate the managed tree under that temp home.

```python
from pathlib import Path
from tui_pilot import accounts, db

def test_scan_managed_lists_provider_dirs():
    base = accounts.provider_dir()  # = db.home()/agents/claude-code
    (base / "inforge").mkdir(parents=True)
    (base / "founder").mkdir(parents=True)
    assert set(accounts.scan_managed()) == {"inforge", "founder"}

def test_scan_importable_finds_dot_claude_dirs(monkeypatch, tmp_path):
    monkeypatch.setattr(accounts, "_user_home", lambda: tmp_path)
    (tmp_path / ".claude-t2b").mkdir()
    (tmp_path / ".claude-inforge").mkdir()
    (tmp_path / ".claude").mkdir()  # base config — also importable
    found = set(accounts.scan_importable())
    assert str(tmp_path / ".claude-t2b") in found
    assert str(tmp_path / ".claude-inforge") in found

def test_auth_status(tmp_path):
    d = tmp_path / "acct"; d.mkdir()
    assert accounts.auth_status(str(d)) == "not_logged_in"
    (d / ".credentials.json").write_text("{}")
    assert accounts.auth_status(str(d)) == "authed"
```

- [ ] **Step 2: Run, expect fail.**

- [ ] **Step 3: Implement** in `accounts.py`:
  - `provider_dir(provider="claude-code")` → `db.home() / "agents" / provider`.
  - `scan_managed(provider="claude-code")` → child dir names (empty list if absent).
  - `_user_home()` → `Path.home()` (wrapped so tests can patch).
  - `scan_importable()` → `[str(p) for p in _user_home().glob(".claude*") if p.is_dir()]`.
  - `auth_status(config_dir)` → `"authed"` if any of `{".credentials.json"}` exists in the dir else `"not_logged_in"`. (Spec §3 flags the exact filename as resolved here; `.credentials.json` is the Claude Code default — confirm against an authed `~/.claude-*` dir during implementation and adjust the set if needed.)

- [ ] **Step 4: Confirm the credential filename** — `.venv/bin/python -c "import os; print(sorted(os.listdir(os.path.expanduser('~/.claude-t2b'))))"`. If the credential file differs, update the set in `auth_status` and the test, then re-run.

- [ ] **Step 5: Run, expect pass. Commit** — `git commit -am "feat(accounts): scan managed/importable + auth status"`

### Task 2.3: `import_existing` and `create` (mkdir managed dir)

- [ ] **Step 1: Failing test**

```python
def test_create_managed_makes_dir():
    a = accounts.create_managed(id="inforge", label="Inforge", color="#60a5fa")
    assert Path(a["config_dir"]) == accounts.provider_dir() / "inforge"
    assert Path(a["config_dir"]).is_dir()

def test_import_existing_registers_without_moving(tmp_path):
    src = tmp_path / ".claude-t2b"; src.mkdir()
    a = accounts.import_existing(id="t2b", label="Time2Build", config_dir=str(src))
    assert a["config_dir"] == str(src)
```

- [ ] **Step 2–4:** Implement `create_managed` (mkdir `provider_dir()/id`, then `create(...)` with that path) and `import_existing` (just `create(...)` with the given path). Run, expect pass.

- [ ] **Step 5: Commit** — `git commit -am "feat(accounts): create_managed + import_existing"`

### Task 2.4: `TmuxSession.spawn` env injection

- [ ] **Step 1: Failing test** — extend `tests/test_session_model.py` (mock subprocess so no real tmux). Inspect the existing test file first to reuse its mocking style. Minimal version:

```python
from tui_pilot.session import TmuxSession

def test_spawn_injects_env(monkeypatch):
    calls = []
    sess = TmuxSession("aid", "claude", cwd="/tmp", env={"CLAUDE_CONFIG_DIR": "/cfg"})
    monkeypatch.setattr(sess, "is_alive", lambda: False)
    monkeypatch.setattr(sess, "_run", lambda *a, **k: calls.append(a) or None)
    sess.spawn()
    args = calls[0]
    assert "-e" in args and "CLAUDE_CONFIG_DIR=/cfg" in args
```

- [ ] **Step 2: Run, expect fail** (ctor rejects `env`).

- [ ] **Step 3: Implement** — add `env: dict[str, str] | None = None` param to `TmuxSession.__init__` (store `self.env = env or {}`), and in `spawn()` insert `for k, v in self.env.items(): args += ["-e", f"{k}={v}"]` after the `-y` rows arg and before the optional `-c` cwd. (Verified mechanism: tmux 3.6a `new-session -e KEY=val`.)

- [ ] **Step 4: Run, expect pass.**

- [ ] **Step 5: Commit** — `git commit -am "feat(session): optional env injection via tmux -e"`

---

## Chunk 3: Projects module (`projects.py`)

**Files:**
- Create: `tui_pilot/projects.py`
- Test: `tests/test_projects.py`

### Task 3.1: Project CRUD + ordered pool

- [ ] **Step 1: Failing test** — `tests/test_projects.py`

```python
from tui_pilot import projects, accounts

def _mk_accounts():
    accounts.create(id="t2b", label="T2B", config_dir="/t2b")
    accounts.create(id="inf", label="Inforge", config_dir="/inf")

def test_create_project_and_pool_order():
    _mk_accounts()
    p = projects.create(id="acme", name="Acme", path="/work/acme",
                        account_strategy="round_robin")
    projects.set_pool("acme", ["t2b", "inf"])
    assert projects.pool("acme") == ["t2b", "inf"]
    projects.set_pool("acme", ["inf", "t2b"])
    assert projects.pool("acme") == ["inf", "t2b"]
```

- [ ] **Step 2–4:** Implement `create`, `get`, `list_all`, `update`, `delete`; `set_pool(project_id, account_ids)` deletes existing `project_accounts` rows for the project and re-inserts with `position = index`; `pool(project_id)` selects ordered by `position`. Run, expect pass.

- [ ] **Step 5: Commit** — `git commit -am "feat(projects): CRUD + ordered account pool"`

### Task 3.2: Round-robin `next_account` + cursor persistence

- [ ] **Step 1: Failing test**

```python
def test_round_robin_cycles_and_persists():
    _mk_accounts()
    projects.create(id="acme", name="Acme", path="/w", account_strategy="round_robin")
    projects.set_pool("acme", ["t2b", "inf"])
    picks = [projects.next_account("acme") for _ in range(3)]
    assert picks == ["t2b", "inf", "t2b"]
    assert projects.get("acme")["rr_cursor"] == 3

def test_single_strategy_always_first():
    _mk_accounts()
    projects.create(id="s", name="S", path="/w", account_strategy="single")
    projects.set_pool("s", ["t2b"])
    assert [projects.next_account("s") for _ in range(2)] == ["t2b", "t2b"]

def test_next_account_skips_orphans_and_empty_pool_returns_none():
    projects.create(id="e", name="E", path="/w")
    assert projects.next_account("e") is None
```

- [ ] **Step 2–4:** Implement `next_account(project_id)`:
  - wrap the whole read-modify-write in a single `with db.tx() as cx:` block so the cursor read and the `rr_cursor = cursor + 1` write are atomic against concurrent callers (the poll-loop DRAIN and a direct `POST /sessions` can both reach here);
  - read pool (ordered account ids); drop any id not present in `accounts` (defensive);
  - if empty → return `None`;
  - read `rr_cursor`, pick `pool[cursor % len(pool)]`, write `rr_cursor = cursor + 1`;
  - `single` strategy: same code path works because the pool has one entry. Run, expect pass.

> **Concurrency (reconciles spec §4):** the spec suggested advancing the cursor "under the registry lock," but in the real `_spawn_agent` the account must be resolved *before* the tmux spawn (to set `env` and auth-guard), which is structurally *before* the `with _registry_lock:` block. Rather than hold `_registry_lock` across a subprocess spawn, we make the cursor advance atomic at the DB layer: the `with db.tx()` block serializes the read-modify-write on `_exec_lock`, so two concurrent spawns are guaranteed distinct cursor values and therefore distinct accounts. This is an equivalent-or-stronger guarantee than the spec's wording and avoids lengthening registry-lock hold time. (Document this choice in a code comment so a future reader doesn't "fix" it back to the registry lock.)

- [ ] **Step 5: Commit** — `git commit -am "feat(projects): round-robin next_account + cursor"`

### Task 3.3: Current-project app state

- [ ] **Step 1: Failing test**

```python
def test_current_project_get_set():
    projects.create(id="acme", name="Acme", path="/w")
    assert projects.current_project_id() is None
    projects.set_current_project("acme")
    assert projects.current_project_id() == "acme"
```

- [ ] **Step 2–4:** Implement `current_project_id()` (`SELECT current_project_id FROM app_state WHERE id=1`) and `set_current_project(pid)` (`UPDATE app_state SET current_project_id=? WHERE id=1`). Run, expect pass.

- [ ] **Step 5: Commit** — `git commit -am "feat(projects): current-project app state"`

---

## Chunk 4: Server integration

**Files:**
- Modify: `tui_pilot/server.py` (roles-from-DB, account resolution + persist in `_spawn_agent`, startup reconcile, new endpoints)
- Create: `tui_pilot/roles_seed.py` (seed roles.yaml → DB on first run)
- Test: `tests/test_roles.py` (extend), `tests/test_server.py` (extend), `tests/test_harness_server.py` (reconcile)

### Task 4.1: Seed roles from YAML into DB, serve roles from DB

- [ ] **Step 1: Failing test** — `tests/test_roles.py` (read the existing file first to match its style)

```python
from tui_pilot import roles_seed, db

def test_seed_roles_populates_db_from_yaml():
    roles_seed.seed_if_empty()
    rows = db.get_conn().execute("SELECT id FROM roles").fetchall()
    ids = {r["id"] for r in rows}
    assert {"planner", "developer", "reviewer", "plain", "orchestrator"} <= ids

def test_seed_is_idempotent():
    roles_seed.seed_if_empty(); roles_seed.seed_if_empty()
    n = db.get_conn().execute("SELECT count(*) c FROM roles").fetchone()["c"]
    assert n == 5
```

- [ ] **Step 2: Run, expect fail.**

- [ ] **Step 3: Implement** `tui_pilot/roles_seed.py`: `seed_if_empty()` → if `roles` table empty, load `roles.yaml` directly with `yaml.safe_load` and insert each row including `cmd` (default `"claude"` when the yaml omits it), `default_model` (null unless the yaml adds one), and `is_system=1` for `orchestrator`. Provide `load_roles_from_db() -> dict[str, dict]` returning the same shape `server.ROLES` consumes today (`{id: {id, label, emoji, mode, cmd, instructions, description}}`) — every key `_spawn_agent` reads (`cmd`, `mode`, `label`, `emoji`, `instructions`) is a real column, so no synthetic defaults are needed.

- [ ] **Step 4: Run, expect pass.**

- [ ] **Step 5: Wire server** — in `server.py`, after imports call `roles_seed.seed_if_empty()` at module load, and set `ROLES = roles_seed.load_roles_from_db()`. Keep `load_roles()` for the seed source. Run full suite `.venv/bin/python -m pytest -q` — every key `_spawn_agent` reads (`cmd`, `mode`, `label`, `emoji`, `instructions`) is a real roles column (Step 3), so no synthetic defaults are needed; just fix any role-shape mismatches the tests surface. Commit: `git commit -am "feat(server): seed roles into SQLite and serve from DB"`

### Task 4.2: Resolve + persist account in `_spawn_agent`

- [ ] **Step 1: Failing test** — `tests/test_server.py` (extend; this file already constructs the app/registry — read it first for the spawn test harness and reuse it). Test the **resolution helper** in isolation to avoid real tmux:

```python
def test_resolve_account_prefers_explicit_then_project_then_default(monkeypatch):
    from tui_pilot import accounts, projects, server
    accounts.create(id="t2b", label="T2B", config_dir="/t2b")
    accounts.create(id="inf", label="Inf", config_dir="/inf")
    accounts.set_default("t2b")
    projects.create(id="p", name="P", path="/w", account_strategy="round_robin")
    projects.set_pool("p", ["inf"])
    assert server._resolve_account(account_id="t2b", project_id="p")["id"] == "t2b"
    assert server._resolve_account(account_id=None, project_id="p")["id"] == "inf"
    assert server._resolve_account(account_id=None, project_id=None)["id"] == "t2b"
```

- [ ] **Step 2: Run, expect fail.**

- [ ] **Step 3: Implement** `server._resolve_account(account_id, project_id)`:
  - if `account_id`: return `accounts.get(account_id)`;
  - elif `project_id`: `aid = projects.next_account(project_id)`; return `accounts.get(aid)` if `aid` else `accounts.default_account()`;
  - else: `accounts.default_account()` (may be `None`).

- [ ] **Step 4: Run, expect pass.**

- [ ] **Step 5: Wire into `_spawn_agent`** — add params `account_id: str | None = None`, `project_id: str | None = None`. After `eff_cmd`/`eff_mode` resolution:
  - `acct = _resolve_account(account_id, project_id)`;
  - `env = {"CLAUDE_CONFIG_DIR": acct["config_dir"]} if acct else {}`;
  - pass `env=env` to `TmuxSession(...)`;
  - **auth guard:** if `acct` and `accounts.auth_status(acct["config_dir"]) == "not_logged_in"`, raise `HTTPException(400, f"account {acct['id']} is not logged in")` BEFORE spawning. Note `_spawn_agent` is also called from automated paths (poll-loop `_make_handoff`, orchestrator DRAIN) which already catch exceptions — there the 400 surfaces as a narrate/`prep_detail` note, not an HTTP response; only the direct `POST /sessions` path returns it to a client.
  - **`_meta` keys go INSIDE the existing `_meta[aid] = {...}` dict literal** (server.py lines 506–524, inside the `with _registry_lock:` block) — add `"account_id": acct and acct["id"]` and `"project_id": project_id` to that literal, never mutate `_meta[aid]` after the block;
  - persist the session row inside the same `with _registry_lock:` block, right after the `_meta[aid] = {...}` assignment: `sessions_store.insert(id=aid, project_id=project_id, account_id=(acct and acct["id"]), name=name, role=role, model=model, mode=eff_mode, cwd=eff_cwd, mission_id=mission, parent=parent, reason=reason, is_orchestrator=is_orchestrator, sort_order=_order, status="live", created_at=...)`.
  - Create `tui_pilot/sessions_store.py` (small store module, mirrors accounts/projects style) with `insert(**cols)`, `set_status(id, status)`, `all()`, `all_live()`, `get(id)` — all using `db.execute`/`db.query`.

- [ ] **Step 6:** Thread `account_id`/`project_id` through `SpawnRequest` (add optional fields) and `create_session`. Run full suite. Commit: `git commit -am "feat(server): resolve+persist account at spawn, auth guard"`

- [ ] **Step 7: Add the empty-pool fallback test** (server layer, spec §6) — append to `tests/test_server.py`:

```python
def test_resolve_account_empty_pool_falls_back_to_default():
    from tui_pilot import accounts, projects, server
    accounts.create(id="t2b", label="T2B", config_dir="/t2b"); accounts.set_default("t2b")
    projects.create(id="p", name="P", path="/w")  # no pool set
    assert server._resolve_account(account_id=None, project_id="p")["id"] == "t2b"

def test_resolve_account_none_when_no_accounts_at_all():
    from tui_pilot import server
    assert server._resolve_account(account_id=None, project_id=None) is None  # ambient CLAUDE_CONFIG_DIR
```

Run, expect pass. (The `None` case is the deliberate spec §9 "preserve today's flow" behavior — `env={}`, spawn on the ambient config — not a bug.) Commit if not already covered by Step 6's commit.

### Task 4.3: Startup reconcile (reattach live tmux)

- [ ] **Step 1: Failing test** — `tests/test_harness_server.py` or `tests/test_server.py`. Test the pure reconcile function with an injected "is this tmux alive?" predicate:

```python
def test_reconcile_marks_dead_and_keeps_live():
    from tui_pilot import sessions_store, server
    sessions_store.insert(id="a", status="live", cwd="/w", name="a")
    sessions_store.insert(id="b", status="live", cwd="/w", name="b")
    alive = {"a"}
    kept = server._reconcile_sessions(is_alive=lambda sid: sid in alive)
    assert kept == ["a"]
    statuses = {r["id"]: r["status"] for r in sessions_store.all()}
    assert statuses == {"a": "live", "b": "exited"}
```

- [ ] **Step 2: Run, expect fail.**

- [ ] **Step 3: Implement** `server._reconcile_sessions(is_alive=None)`:
  - default `is_alive = lambda sid: TmuxSession(sid, "").is_alive()`.
  - for each `row` in `sessions_store.all_live()`:
    - if `is_alive(row["id"])`: re-adopt faithfully —
      - `sess = TmuxSession(row["id"], "claude", cwd=row["cwd"])` (env irrelevant post-spawn; tmux already holds `CLAUDE_CONFIG_DIR`),
      - `_sessions[id] = Controller(sess)`, `_locks[id] = threading.Lock()`,
      - rebuild the poller with the SAME wiring as `_spawn_agent` (server.py lines 525–528): `hub = _hub_for(row["cwd"])`; `_pollers[id] = HarnessPoller(id, sess, hub, cwd=row["cwd"], on_handoff=_make_handoff(predecessor_aid=id, name_hint=row["name"], cwd=row["cwd"]))`,
      - restore `_meta[id]` by merging the DB row with the role definition: pull `label`/`emoji`/`instructions` from `ROLES.get(row["role"])` (fallbacks as in `_spawn_agent`), and set `id, name, cwd, role, mode, model, mission, parent, reason, account_id, project_id, is_orchestrator` from the row, `order=row["sort_order"]`, `prep="ready"` (a reattached agent is already past booting/priming),
      - append `id` to `kept`;
    - else: `sessions_store.set_status(row["id"], "exited")`.
  - return `kept`. Reconcile must run inside `with _registry_lock:` (structural mutation), and be wrapped in try/except so one bad row can't abort startup.
  - Call `_reconcile_sessions()` once at server startup (module load, after roles seed). Restart `_order` from `max(sort_order)+1` so new spawns sort after reattached ones.

- [ ] **Step 4: Run, expect pass.** Add `sessions_store.all()` / `all_live()` / `set_status` / `get` as needed. Note the test injects `is_alive` so it never touches real tmux; the poller/`_meta` rebuild for the live branch is exercised by an integration check in Final verification.

- [ ] **Step 5: Commit** — `git commit -am "feat(server): reconcile live tmux sessions on startup"`

### Task 4.4: Accounts + Projects HTTP endpoints

- [ ] **Step 1: Failing test** — `tests/test_server.py` using FastAPI `TestClient`:

```python
from fastapi.testclient import TestClient

def test_accounts_and_projects_endpoints():
    from tui_pilot.server import app
    c = TestClient(app)
    r = c.post("/accounts", json={"id": "t2b", "label": "T2B", "config_dir": "/t2b"})
    assert r.status_code == 200
    assert any(a["id"] == "t2b" for a in c.get("/accounts").json()["accounts"])
    c.post("/projects", json={"id": "acme", "name": "Acme", "path": "/w",
                              "account_strategy": "single"})
    c.put("/projects/acme/accounts", json={"account_ids": ["t2b"]})
    assert c.get("/projects/acme").json()["pool"] == ["t2b"]
    c.put("/current-project", json={"project_id": "acme"})
    assert c.get("/current-project").json()["project_id"] == "acme"
```

- [ ] **Step 2: Run, expect fail.**

- [ ] **Step 3: Implement endpoints** in a **new `tui_pilot/registry_server.py`** router module, included in `server.py` exactly like `orchestrator_server.router` (`app.include_router(registry_server.router)`). This is required, not optional: `server.py` is already ~810 lines and must not absorb this surface. Handlers reach back into `server` via `from . import server` (same lazy pattern `orchestrator_server` uses). Endpoints:
  - `GET/POST /accounts`, `PATCH/DELETE /accounts/{id}`, `POST /accounts/{id}/default`, `POST /accounts/scan` (returns managed + importable candidates), `POST /accounts/import` (body: id/label/config_dir/color → `accounts.import_existing`), `POST /accounts/{id}/login`.
  - `GET/POST /projects`, `PATCH/DELETE /projects/{id}`, `GET /projects/{id}` (includes `pool`), `PUT /projects/{id}/accounts`.
  - `GET/PUT /current-project`.
  - `GET/POST /roles`, `PATCH/DELETE /roles/{id}` (CRUD over the roles table; call `server.refresh_roles()` — a new one-liner that re-runs `ROLES = roles_seed.load_roles_from_db()` — after any write).
  Use Pydantic request models mirroring the columns.

- [ ] **Step 3b: Login endpoint — concrete behavior.** `POST /accounts/{id}/login` opens an interactive `claude` session pointed at the account's config dir so the user can complete `/login` in the Fleet screen. It is a **bare** session — NOT a harness agent: no comms-skill install, no poller, no priming. Implement a minimal `server._spawn_login_session(account)`:
  - `acct = accounts.get(id)`; `aid = new_agent_id(f"login-{id}")`;
  - `sess = TmuxSession(aid, "claude", cwd=acct["config_dir"], env={"CLAUDE_CONFIG_DIR": acct["config_dir"]})`; `sess.spawn()`;
  - register only `_sessions[aid]`/`_locks[aid]`/minimal `_meta[aid]` (`role="login"`, `prep="ready"`, `label=f"login · {acct['label']}"`) under `_registry_lock`; do NOT add a poller or persist to `sessions_store` (ephemeral);
  - return `{"id": aid}`. The UI focuses that session; the user types `/login` and completes auth; `auth_status` flips to `authed` on next `GET /accounts`. Test: assert the endpoint returns an id and a `_meta` entry with `role == "login"` (mock `TmuxSession.spawn` so no real tmux).

- [ ] **Step 4: Run, expect pass.** Commit: `git commit -am "feat(server): accounts/projects/roles/current-project endpoints"`

---

## Chunk 5: Orchestration — project policy + missions persistence

**Files:**
- Modify: `tui_pilot/orchestrator_server.py` (`_policy_for` reads project; `spawn` callback passes project/account; missions table)
- Modify: `tui_pilot/orchestration.py` (only if signal needs an `account` pin field)
- Test: `tests/test_orchestration.py`, `tests/test_orchestrator_server.py` (extend)

### Task 5.1: Policy from current project

- [ ] **Step 1: Failing test** — `tests/test_orchestrator_server.py`

```python
def test_policy_reads_current_project_ceiling_and_autopilot():
    from tui_pilot import projects, orchestrator_server as osrv
    projects.create(id="p", name="P", path="/w", model_ceiling="opus", autopilot=1)
    projects.set_current_project("p")
    pol = osrv._policy_for(mission=None)
    assert pol.ceiling == "opus" and pol.autopilot is True
```

- [ ] **Step 2–4:** Update `_policy_for` to read the current project's `model_ceiling` (default `"sonnet"` if null/no project) and `autopilot`; keep mission-level autopilot override (mission autopilot OR project autopilot). Run, expect pass. Keep existing default-sonnet test green.

- [ ] **Step 5: Commit** — `git commit -am "feat(orch): executor policy from current project defaults"`

### Task 5.2: Orchestrator spawn uses current project's pool

- [ ] **Step 1: Failing test** — assert the `_Callbacks.spawn` forwards `project_id` (current project) into `_spawn_agent` so account resolution happens. Use a fake server object capturing kwargs:

```python
def test_orchestrator_spawn_passes_current_project(monkeypatch):
    from tui_pilot import projects, orchestrator_server as osrv
    projects.create(id="p", name="P", path="/w"); projects.set_current_project("p")
    captured = {}
    class FakeServer:
        def _spawn_agent(self, **kw): captured.update(kw); return {"id": "w1"}
    cb = osrv._callbacks_for(FakeServer(), "orch-1", mission="m")
    cb.spawn(role="developer", model="sonnet", task="do")
    assert captured["project_id"] == "p"
```

- [ ] **Step 2–4:** In `_Callbacks.spawn`, add `project_id=projects.current_project_id()` (and pass through an optional `account` pin from the signal if present — add `account` to `OrchestrationSignal` + parser as an optional field, default `None`, mapped to `_spawn_agent(account_id=...)`). Add `from . import projects` at the top of `orchestrator_server.py` — `projects` depends only on `db` (no `server`/`orchestrator_server` import), so there is no cycle. Run, expect pass.

- [ ] **Step 5: Commit** — `git commit -am "feat(orch): spawn into current project's account pool"`

### Task 5.3: Persist missions to the missions table

- [ ] **Step 1: Failing test** — creating/registering a mission writes a row with `project_id`; `set_autopilot` persists.

```python
def test_mission_persisted_with_project(monkeypatch):
    from tui_pilot import projects, db, orchestrator_server as osrv
    projects.create(id="p", name="P", path="/w"); projects.set_current_project("p")
    osrv._mission("build-x")
    row = db.get_conn().execute("SELECT project_id FROM missions WHERE id='build-x'").fetchone()
    assert row["project_id"] == "p"
```

- [ ] **Step 2–4:** Back `_mission` with the missions table (lazy `INSERT OR IGNORE` carrying `project_id=current_project_id()`), keep the in-memory `activity` tail as a runtime cache but persist `autopilot`/`status`. Minimal change: write-through to DB while keeping `_missions` dict for activity. Run, expect pass.

- [ ] **Step 5: Commit** — `git commit -am "feat(orch): persist missions with project linkage"`

---

## Chunk 6: Frontend (nav rail, project bar, management pages)

**Files:**
- Modify: `tui_pilot/static/index.html`, `tui_pilot/static/app.js`, `tui_pilot/static/style.css`

> Frontend has no JS test harness in this repo; verify each task by running the server and loading the UI. Run: `.venv/bin/python -m uvicorn tui_pilot.server:app --port 8765` then open `http://localhost:8765`.

### Task 6.1: Nav rail + project bar shell

- [ ] **Step 1:** Add an icon nav rail (Fleet · Projects · Accounts · Agents · Settings) and a top project bar showing the current project name + account color-dots, per the approved mockup (`shell.html` in `.superpowers/brainstorm/`). Wire `GET /current-project` + `GET /projects/{id}` to populate the bar; a project switcher dropdown calls `PUT /current-project`.
- [ ] **Step 2:** Each rail icon toggles a top-level view (`Fleet` = existing workspace). Keep the existing 3-column workspace as the Fleet view.
- [ ] **Step 3: Verify** in browser: rail switches views; project bar shows current project + dots. Commit: `git commit -am "feat(ui): nav rail + project bar shell"`

### Task 6.2: Accounts page

- [ ] **Step 1:** Build the Accounts view from `managed-accounts.html`: cards (swatch/label/provider/auth status/live count/default ⭐). Wire `GET /accounts`, `POST /accounts/scan`, `POST /accounts/import`, `POST /accounts` (new), `POST /accounts/{id}/login` (open the returned login session in the Fleet screen), `POST /accounts/{id}/default`.
- [ ] **Step 2: Verify** in browser: scan lists `~/.claude-*`; import registers one; login opens a session. Commit: `git commit -am "feat(ui): accounts page"`

### Task 6.3: Projects page + editor

- [ ] **Step 1:** Build Projects list + editor from `project-editor.html`: name, dir, strategy toggle, ordered draggable account pool (drag to reorder → `PUT /projects/{id}/accounts`), optional defaults (model ceiling, autopilot). "Next worker →" preview computed client-side from the pool order + strategy.
- [ ] **Step 2: Verify** in browser: create a project, set a 2-account round-robin pool, reorder it. Commit: `git commit -am "feat(ui): projects page + editor"`

### Task 6.4: Agents editor + account dots on workers

- [ ] **Step 1:** Build the Agents view from `agents-editor.html` (emoji/label/mode/default model/description/instructions; "account inherited from project" note; no account field). Wire roles CRUD endpoints.
- [ ] **Step 2:** In the Fleet view, render each worker's account color-dot (from `_info` `account_id` → account color); spawns from the workspace pass the current `project_id`.
- [ ] **Step 3: Verify** in browser end-to-end: select a project with a 2-account pool, spawn 3 workers via the orchestrator, confirm dots cycle account A, B, A. Commit: `git commit -am "feat(ui): agents editor + worker account dots"`

---

## Final verification

- [ ] Run the full suite: `.venv/bin/python -m pytest -q` — all green.
- [ ] Manual end-to-end (per spec §7 integration): create project with `[t2b, inf]` round-robin → spawn 3 workers → assert `sessions` rows carry account ids `t2b, inf, t2b`.
- [ ] Restart the server with a live agent running → confirm it is re-adopted (reconcile) and a dead one shows `exited`.
- [ ] **DB integrity on boot (spec §6 "fail loud"):** confirm `get_conn()` does not silently swallow a corrupt/unreadable DB — a `sqlite3.DatabaseError` at connect/executescript must propagate (fail loud with the DB path in the message), never recreate-and-lose. Add a one-line wrap that re-raises with `db_path()` in the message if you want a clearer error; do not catch-and-continue.
- [ ] Update `README.md` with the projects/accounts model and the managed-dir layout.
- [ ] Use superpowers:requesting-code-review before merging.
