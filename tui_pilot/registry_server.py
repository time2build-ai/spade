"""Registry HTTP router — accounts, projects, roles, current-project.

A separate router module (mirrors :mod:`tui_pilot.orchestrator_server`) included
into the app in :mod:`tui_pilot.server`. Handlers reach back into ``server``
lazily (``from . import server``) to avoid a load-time import cycle and to call
``server.refresh_roles()`` after a role write.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from . import accounts, db, projects
from .identity import new_agent_id
from .session import TmuxSession

router = APIRouter()


# ---- request models -------------------------------------------------------


class AccountCreate(BaseModel):
    id: str
    label: str
    config_dir: str
    color: str | None = None
    provider: str = "claude-code"


class AccountPatch(BaseModel):
    label: str | None = None
    color: str | None = None
    config_dir: str | None = None


class AccountImport(BaseModel):
    id: str
    label: str
    config_dir: str
    color: str | None = None
    provider: str = "claude-code"


class ProjectCreate(BaseModel):
    id: str
    name: str
    path: str
    account_strategy: str = "single"
    model_ceiling: str | None = None
    autopilot: int = 0


class ProjectPatch(BaseModel):
    name: str | None = None
    path: str | None = None
    account_strategy: str | None = None
    model_ceiling: str | None = None
    autopilot: int | None = None


class PoolRequest(BaseModel):
    account_ids: list[str]


class CurrentProjectRequest(BaseModel):
    project_id: str | None = None


class RoleUpsert(BaseModel):
    id: str
    label: str | None = None
    emoji: str | None = None
    mode: str = "normal"
    cmd: str = "claude"
    default_model: str | None = None
    description: str | None = None
    instructions: str | None = None
    is_system: int = 0


class RolePatch(BaseModel):
    label: str | None = None
    emoji: str | None = None
    mode: str | None = None
    cmd: str | None = None
    default_model: str | None = None
    description: str | None = None
    instructions: str | None = None
    is_system: int | None = None


# ---- accounts -------------------------------------------------------------


@router.get("/accounts")
def list_accounts() -> dict:
    return {"accounts": accounts.list_all()}


@router.post("/accounts")
def create_account(req: AccountCreate) -> dict:
    return accounts.create(
        id=req.id, label=req.label, config_dir=req.config_dir,
        color=req.color, provider=req.provider,
    )


@router.patch("/accounts/{id}")
def patch_account(id: str, req: AccountPatch) -> dict:
    if accounts.get(id) is None:
        raise HTTPException(404, f"no account {id!r}")
    fields = {k: v for k, v in req.model_dump().items() if v is not None}
    if fields:
        set_clause = ", ".join(f"{c} = ?" for c in fields)
        db.execute(
            f"UPDATE accounts SET {set_clause} WHERE id = ?",
            tuple(fields.values()) + (id,),
        )
    return accounts.get(id)


@router.delete("/accounts/{id}")
def delete_account(id: str) -> dict:
    if accounts.get(id) is None:
        raise HTTPException(404, f"no account {id!r}")
    db.execute("DELETE FROM accounts WHERE id = ?", (id,))
    return {"id": id, "status": "deleted"}


@router.post("/accounts/{id}/default")
def set_account_default(id: str) -> dict:
    try:
        accounts.set_default(id)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
    return {"id": id, "is_default": True}


@router.post("/accounts/scan")
def scan_accounts() -> dict:
    """Return rich candidate objects for NEW (unregistered) account dirs.

    The frontend renders each candidate as an object with id/label/config_dir/
    provider, so we enrich the bare names/paths from the discovery helpers and
    skip any whose config_dir already maps to a registered account.
    """
    from pathlib import Path

    registered_dirs = {a.get("config_dir") for a in accounts.list_all()}

    managed = []
    pdir = accounts.provider_dir()
    for n in accounts.scan_managed():
        cdir = str(pdir / n)
        if cdir in registered_dirs:
            continue
        managed.append({
            "id": n,
            "label": n,
            "config_dir": cdir,
            "provider": "claude-code",
            "kind": "managed",
        })

    importable = []
    for p in accounts.scan_importable():
        if p in registered_dirs:
            continue
        name = Path(p).name
        cid = name.replace(".claude-", "").replace(".claude", "base") or "import"
        importable.append({
            "id": cid,
            "label": name,
            "config_dir": p,
            "provider": "claude-code",
            "kind": "importable",
        })

    return {"managed": managed, "importable": importable}


@router.post("/accounts/import")
def import_account(req: AccountImport) -> dict:
    return accounts.import_existing(
        id=req.id, label=req.label, config_dir=req.config_dir,
        color=req.color, provider=req.provider,
    )


@router.post("/accounts/{id}/login")
def login_account(id: str) -> dict:
    """Open a bare interactive `claude` session pinned to the account's config
    dir so the human can complete the OAuth login. Minimal registration only —
    no poller, no comms skill, no persistence."""
    import threading

    from . import server

    acct = accounts.get(id)
    if acct is None:
        raise HTTPException(404, f"no account {id!r}")
    aid = new_agent_id(f"login-{id}")
    sess = TmuxSession(
        aid, "claude", cwd=acct["config_dir"],
        env={"CLAUDE_CONFIG_DIR": acct["config_dir"]},
    )
    sess.spawn()
    with server._registry_lock:
        server._sessions[aid] = server.Controller(sess)
        server._locks[aid] = threading.Lock()
        # Populate every key _info() / GET /sessions reads with safe defaults so
        # a bare login session serializes cleanly when listed.
        server._meta[aid] = {
            "id": aid,
            "name": aid,
            "cwd": acct["config_dir"],
            "role": "login",
            "label": f"login · {acct['label']}",
            "emoji": "🔑",
            "mode": "normal",
            "prep": "ready",
            "prep_detail": None,
            "task": None,
            "order": 0,
            "model": None,
            "mission": None,
            "parent": None,
            "reason": None,
            "instructions": "",
            "is_orchestrator": False,
            "account_id": acct["id"],
            "project_id": None,
        }
    return {"id": aid}


# ---- projects -------------------------------------------------------------


@router.get("/projects")
def list_projects() -> dict:
    return {"projects": projects.list_all()}


@router.post("/projects")
def create_project(req: ProjectCreate) -> dict:
    return projects.create(
        id=req.id, name=req.name, path=req.path,
        account_strategy=req.account_strategy,
        model_ceiling=req.model_ceiling, autopilot=req.autopilot,
    )


@router.get("/projects/{id}")
def get_project(id: str) -> dict:
    proj = projects.get(id)
    if proj is None:
        raise HTTPException(404, f"no project {id!r}")
    proj["pool"] = projects.pool(id)
    return proj


@router.patch("/projects/{id}")
def patch_project(id: str, req: ProjectPatch) -> dict:
    if projects.get(id) is None:
        raise HTTPException(404, f"no project {id!r}")
    # Apply only fields the client actually sent (exclude_unset), so an
    # explicit `model_ceiling: null` clears the column while omitted fields
    # are left untouched.
    fields = req.model_dump(exclude_unset=True)
    projects.update(id, **fields)
    return projects.get(id)


@router.delete("/projects/{id}")
def delete_project(id: str) -> dict:
    if projects.get(id) is None:
        raise HTTPException(404, f"no project {id!r}")
    projects.delete(id)
    return {"id": id, "status": "deleted"}


@router.put("/projects/{id}/accounts")
def set_project_pool(id: str, req: PoolRequest) -> dict:
    if projects.get(id) is None:
        raise HTTPException(404, f"no project {id!r}")
    projects.set_pool(id, req.account_ids)
    return {"id": id, "pool": projects.pool(id)}


# ---- current project ------------------------------------------------------


@router.get("/current-project")
def get_current_project() -> dict:
    return {"project_id": projects.current_project_id()}


@router.put("/current-project")
def set_current_project(req: CurrentProjectRequest) -> dict:
    if req.project_id is not None and projects.get(req.project_id) is None:
        raise HTTPException(404, f"no project {req.project_id!r}")
    projects.set_current_project(req.project_id)
    return {"project_id": projects.current_project_id()}


# ---- roles ----------------------------------------------------------------


# NOTE: GET /roles is served by server.py (already DB-backed). This router owns
# the write side (POST/PATCH/DELETE), refreshing server.ROLES after each write.


@router.post("/roles")
def upsert_role(req: RoleUpsert) -> dict:
    from . import server

    db.execute(
        "INSERT OR REPLACE INTO roles "
        "(id, label, emoji, mode, cmd, default_model, description, "
        " instructions, is_system) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            req.id, req.label, req.emoji, req.mode, req.cmd, req.default_model,
            req.description, req.instructions, req.is_system,
        ),
    )
    server.refresh_roles()
    rows = db.query("SELECT * FROM roles WHERE id = ?", (req.id,))
    return dict(rows[0])


@router.patch("/roles/{id}")
def patch_role(id: str, req: RolePatch) -> dict:
    from . import server

    rows = db.query("SELECT * FROM roles WHERE id = ?", (id,))
    if not rows:
        raise HTTPException(404, f"no role {id!r}")
    fields = {k: v for k, v in req.model_dump().items() if v is not None}
    if fields:
        set_clause = ", ".join(f"{c} = ?" for c in fields)
        db.execute(
            f"UPDATE roles SET {set_clause} WHERE id = ?",
            tuple(fields.values()) + (id,),
        )
    server.refresh_roles()
    return dict(db.query("SELECT * FROM roles WHERE id = ?", (id,))[0])


@router.delete("/roles/{id}")
def delete_role(id: str) -> dict:
    from . import server

    if not db.query("SELECT id FROM roles WHERE id = ?", (id,)):
        raise HTTPException(404, f"no role {id!r}")
    db.execute("DELETE FROM roles WHERE id = ?", (id,))
    server.refresh_roles()
    return {"id": id, "status": "deleted"}
