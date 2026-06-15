# Projects, Accounts & SQLite Persistence — Design

**Date:** 2026-06-15
**Status:** Approved (brainstorm)
**Builds on:** [agent-harness](2026-06-14-agent-harness-design.md), [orchestrator](2026-06-14-orchestrator-design.md)

## 1. Problem

tui-pilot can spawn a fleet of `claude` agents (roles × model tiers) and steer them
with a conversational orchestrator. But it has **no notion of which cloud account an
agent runs under**, and no persistence: roles live in `roles.yaml`, sessions/missions
live in in-memory dicts, and there is no concept of a *project*.

The user runs multiple Claude accounts, switched today via shell aliases
(`c-t2b` = `CLAUDE_CONFIG_DIR=~/.claude-t2b claude`, plus `c-inforge`, `c-founder`).
The goal is a **product-building platform**: define reusable agents once, define
projects (the products being built), bind each project to one or more accounts, and
let the fleet spawn into the right account automatically.

### Rejected framing

Baking the account into the agent type ("Inforge Developer", "T2B Developer") was
explicitly rejected: it duplicates the same agent brain once per account and does not
scale with accounts × roles. **Accounts belong to projects; agents are
account-agnostic.**

## 2. Core model (locked decisions)

| Decision | Choice |
|---|---|
| Account binding | **The project owns the account(s).** Agents are account-agnostic and inherit their account from the project they are spawned into. |
| Persistence | **SQLite** at `~/.tui-pilot/tui-pilot.db`, full scope: accounts, projects, project↔account bindings, roles, sessions, missions. |
| Restart behavior | On boot, **reconcile DB sessions with live tmux** — re-adopt agents whose tmux session still exists, mark the rest exited. |
| Orchestrator | **One global, project-aware** orchestrator. It acts in the currently-selected project and spawns into that project's account pool. It itself runs on the **default account**. |
| Pool strategy | **Round-robin per spawn.** Each new worker takes the next account in the project's ordered pool; the cursor advances every spawn. (`single` is the degenerate one-account pool.) |
| Account storage | tui-pilot-**managed** config dirs under `~/.tui-pilot/agents/<provider>/<account>/`, namespaced by provider (`claude-code`). Accounts are created + authenticated from the app. Existing `~/.claude-*` dirs can be **imported** to skip re-login. |
| Shell / IA | **Icon nav rail** (Fleet · Projects · Accounts · Agents · Settings) + a top **project bar** showing the current project and its account color-dots. Workers display the color-dot of the account they run on. |

## 3. Account mechanics

An **account** is a wrapper over a `CLAUDE_CONFIG_DIR`. To launch an agent on an
account, the spawn injects that directory into the tmux session environment:

```
tmux new-session -d -s <aid> -e CLAUDE_CONFIG_DIR=<config_dir> -x.. -y.. <cmd>
```

Verified: tmux 3.6a's `-e KEY=val` sets the session environment, which the `claude`
process inherits. This keeps the *displayed* launch command clean (no env prefix in
the cmd string the screen/UI shows).

**Managed layout on disk:**

```
~/.tui-pilot/
├─ comms/  workspaces/         # existing harness dirs
├─ tui-pilot.db                # sqlite
└─ agents/
   └─ claude-code/             # provider namespace
      ├─ time2build/           # = a CLAUDE_CONFIG_DIR
      ├─ inforge/
      └─ founder/
```

**Auth status:** an account dir is `authed` if it contains a valid Claude credential
(presence of the credentials file the provider writes, e.g. `.credentials.json` /
`*.json` under the config dir — exact filename resolved during implementation).
Otherwise `not logged in`. Creating an account makes the dir and launches a one-time
interactive `claude` login tmux session in it; the user completes login once.

**Import:** scan `~/.claude-*` directories; for each, offer to register it as an
account pointing at that existing (already-authed) dir — no re-login needed. Managed
and imported accounts coexist; `config_dir` is just stored per account.

**Default account:** exactly one account is flagged default. It is what the global
orchestrator runs on and the fallback for any spawn with no project context.

## 4. Data model (SQLite)

```sql
accounts(
  id TEXT PRIMARY KEY,            -- slug, e.g. "inforge"
  label TEXT, color TEXT,
  provider TEXT DEFAULT 'claude-code',
  config_dir TEXT,               -- absolute path
  is_default INTEGER DEFAULT 0,  -- exactly one row = 1
  created_at TEXT
)

projects(
  id TEXT PRIMARY KEY,
  name TEXT, path TEXT,
  account_strategy TEXT DEFAULT 'single',  -- 'single' | 'round_robin'
  rr_cursor INTEGER DEFAULT 0,
  model_ceiling TEXT, autopilot INTEGER DEFAULT 0,
  created_at TEXT
)

project_accounts(                 -- ordered M:N pool
  project_id TEXT, account_id TEXT,
  position INTEGER,
  PRIMARY KEY(project_id, account_id)
)

roles(                            -- migrated from roles.yaml
  id TEXT PRIMARY KEY,
  label TEXT, emoji TEXT, mode TEXT,
  default_model TEXT, description TEXT, instructions TEXT,
  is_system INTEGER DEFAULT 0     -- orchestrator etc.
)

sessions(                         -- formerly in-memory _meta
  id TEXT PRIMARY KEY,            -- = tmux session name (aid)
  project_id TEXT, account_id TEXT,
  name TEXT, role TEXT, model TEXT, mode TEXT,
  cwd TEXT, mission_id TEXT, parent TEXT, reason TEXT,
  status TEXT, created_at TEXT
)

missions(
  id TEXT PRIMARY KEY,
  project_id TEXT, goal TEXT,
  autopilot INTEGER, status TEXT, created_at TEXT
)
```

**Round-robin:** `next_account(project)` reads the ordered pool, returns
`pool[rr_cursor % len(pool)]`, increments and persists `rr_cursor`. A `single`
strategy project has a one-entry pool and always returns it. Concurrency: the cursor
advance happens under the same registry lock that guards spawn, so two concurrent
spawns can't read the same cursor.

## 5. Components

### Backend (new modules)
- **`db.py`** — sqlite3 connection (stdlib), schema creation + lightweight
  migrations, typed CRUD helpers for each table. One DB file, WAL mode, thread-safe
  access guarded by the existing registry lock.
- **`accounts.py`** — account CRUD; `scan_managed()` (list `agents/claude-code/*`);
  `scan_importable()` (`~/.claude-*`); `auth_status(account)`; `create(label, …)`
  (mkdir + login session); `config_dir(account_id)`; `default_account()`.
- **`projects.py`** — project CRUD; pool management (add/remove/reorder accounts);
  `next_account(project)` round-robin; `current_project()` getter/setter (single-row
  app state, persisted).

### Backend (changed)
- **`session.py`** — `TmuxSession.spawn()` gains an optional `env: dict[str,str]`
  injected as `-e KEY=val` flags. (Keeps `cmd` unchanged for display.)
- **`server.py`** —
  - `_spawn_agent()` resolves the account (explicit `account_id` → else project pool
    via `next_account` → else default account), passes `config_dir` as
    `env={"CLAUDE_CONFIG_DIR": …}`, and **persists** the session row.
  - **Startup reconcile:** load `sessions` from DB, `tmux has-session` each; live →
    rebuild `Controller`/poller, dead → mark `status=exited`.
  - Roles loaded from DB (seeded from `roles.yaml` on first run) instead of the YAML
    module global.
  - New endpoints: `GET/POST/PATCH/DELETE /accounts`, `/accounts/scan`,
    `/accounts/import`, `/accounts/{id}/login`; `GET/POST/PATCH/DELETE /projects`,
    `/projects/{id}/accounts` (pool); `GET/PUT /current-project`; roles CRUD.
- **`orchestration.py`** — the `spawn` executor resolves account from the current
  project (round-robin) unless the orchestrator pinned one; records `account_id` +
  `reason` on the session.

### Frontend
- **Nav rail + project bar** in `index.html` (Fleet · Projects · Accounts · Agents ·
  Settings); project bar shows current project + account dots + strategy.
- **Accounts page** — cards (swatch, label, provider tag, auth status, live count,
  default ⭐); re-scan, add, import, log-in actions.
- **Projects page + editor** — name, dir, strategy toggle, ordered draggable account
  pool with "next worker →" preview, optional defaults (model ceiling, autopilot).
- **Agents page** — list + editor (emoji, label, mode, default model, description,
  instructions); explicit "account inherited from project" note; **no account field**.
- **Fleet view** — each worker shows its account color-dot; spawns scoped to the
  current project.

## 6. Error handling

- **Spawn on un-authed account** → blocked with a clear message + a "Log in" action;
  never launch a worker that will hit an auth wall.
- **Empty/missing pool** → fall back to the default account; surface a warning on the
  project.
- **Missing config dir** (deleted under us) → mark account `not logged in`, block.
- **DB migration / corruption** → fail loud on boot with the DB path; never silently
  recreate and lose projects.
- **Reconcile race** — a tmux session that dies mid-reconcile is treated as dead
  (idempotent; the poller would catch it next tick anyway).

## 7. Testing

- `db.py`: schema create, CRUD round-trips, migration from empty, single-default
  invariant.
- `projects.py`: `next_account` round-robin sequence + wraparound; cursor persistence;
  single-strategy; concurrent-spawn cursor safety.
- `accounts.py`: scan managed/importable, auth-status detection, default resolution.
- `session.py`: `-e` env injection appears in the spawn args; cmd string unchanged.
- `server.py`: spawn resolves+persists account; startup reconcile (live re-adopted,
  dead marked exited); roles served from DB seeded from YAML.
- Endpoints: account/project/pool CRUD; current-project get/set.
- Integration: create project with 2-account pool → spawn 3 workers → accounts
  cycle T2B, Inforge, T2B and each session row carries the right `account_id`.

## 8. Out of scope (v1)

- **Per-role account rules** (e.g. "Reviewers always on Founder") — pools are
  per-project only for now.
- **Per-account usage/cost tracking** — live-agent count only; spend tracking later.
- **Non-`claude-code` providers** — the `provider` column reserves the namespace, but
  only `claude-code` is implemented.
- **Reattaching the orchestrator across restarts beyond the generic session
  reconcile** — same path as any session.

## 9. Migration / backward compatibility

- First boot creates the DB and **seeds roles from `roles.yaml`**; the YAML becomes a
  seed source, not the runtime source.
- Pre-existing in-flight tmux sessions (none persisted before) simply aren't in the DB
  on first upgrade — acceptable; new sessions are persisted henceforth.
- A spawn with no project selected uses the default account, preserving today's
  "just spawn an agent" flow.
