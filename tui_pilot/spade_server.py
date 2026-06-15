"""Spade HTTP router — tasks, backlog, grounding, brain.

Mounted into server.py via app.include_router(spade_server.router).
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from . import brain, tasks

router = APIRouter()


# ---- request models -------------------------------------------------------

class TaskCreate(BaseModel):
    project_id: str
    title: str
    feature: str | None = None
    priority: int = 2
    description: str | None = None
    origin_quote: str | None = None
    origin_source: str | None = None


class TaskPatch(BaseModel):
    title: str | None = None
    feature: str | None = None
    priority: int | None = None
    description: str | None = None
    origin_quote: str | None = None
    origin_source: str | None = None


class MoveRequest(BaseModel):
    status: str


class NodesRequest(BaseModel):
    node_ids: list[str]


# ---- helpers ----------------------------------------------------------------

def _task_or_404(task_id: str) -> dict:
    t = tasks.get(task_id)
    if t is None:
        raise HTTPException(404, f"no task {task_id!r}")
    return t


def _enrich(task: dict) -> dict:
    """Add grounded nodes list to a task dict."""
    task = dict(task)
    task["nodes"] = tasks.nodes(task["id"])
    return task


# ---- endpoints --------------------------------------------------------------

@router.get("/tasks")
def list_tasks(project_id: str) -> dict:
    task_list = tasks.list_for_project(project_id)
    return {"tasks": [_enrich(t) for t in task_list]}


@router.post("/tasks")
def create_task(req: TaskCreate) -> dict:
    t = tasks.create(
        project_id=req.project_id,
        title=req.title,
        feature=req.feature,
        priority=req.priority,
        description=req.description,
        origin_quote=req.origin_quote,
        origin_source=req.origin_source,
    )
    return _enrich(t)


@router.get("/tasks/{task_id}")
def get_task(task_id: str) -> dict:
    return _enrich(_task_or_404(task_id))


@router.patch("/tasks/{task_id}")
def patch_task(task_id: str, req: TaskPatch) -> dict:
    _task_or_404(task_id)
    # MVP: drops None-valued fields via model_dump() so omitted fields = no change;
    # explicit-null clearing of a column is NOT supported.
    fields = {k: v for k, v in req.model_dump().items() if v is not None}
    if fields:
        tasks.update(task_id, **fields)
    return _enrich(tasks.get(task_id))


@router.delete("/tasks/{task_id}")
def delete_task(task_id: str) -> dict:
    _task_or_404(task_id)
    tasks.delete(task_id)
    return {"id": task_id, "status": "deleted"}


@router.post("/tasks/{task_id}/move")
def move_task(task_id: str, req: MoveRequest) -> dict:
    _task_or_404(task_id)
    try:
        tasks.move(task_id, req.status)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return _enrich(tasks.get(task_id))


@router.put("/tasks/{task_id}/nodes")
def set_task_nodes(task_id: str, req: NodesRequest) -> dict:
    _task_or_404(task_id)
    tasks.set_nodes(task_id, req.node_ids)
    return _enrich(tasks.get(task_id))


# ---- brain request models ---------------------------------------------------

class NodeCreate(BaseModel):
    project_id: str
    type: str
    label: str
    detail: str | None = None
    x: float | None = None
    y: float | None = None


class NodePatch(BaseModel):
    type: str | None = None
    label: str | None = None
    detail: str | None = None
    x: float | None = None
    y: float | None = None


class EdgeCreate(BaseModel):
    project_id: str
    from_id: str
    to_id: str
    rel: str | None = None


# ---- brain helpers ----------------------------------------------------------

def _node_or_404(node_id: str) -> dict:
    n = brain.get_node(node_id)
    if n is None:
        raise HTTPException(404, f"no brain node {node_id!r}")
    return n


# ---- brain endpoints --------------------------------------------------------

@router.get("/brain/nodes")
def list_brain_nodes(project_id: str) -> dict:
    return {"nodes": brain.list_nodes(project_id)}


@router.post("/brain/nodes")
def create_brain_node(req: NodeCreate) -> dict:
    try:
        return brain.create_node(
            project_id=req.project_id,
            type=req.type,
            label=req.label,
            detail=req.detail,
            x=req.x,
            y=req.y,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.patch("/brain/nodes/{node_id}")
def patch_brain_node(node_id: str, req: NodePatch) -> dict:
    _node_or_404(node_id)
    fields = {k: v for k, v in req.model_dump().items() if v is not None}
    if fields:
        try:
            brain.update_node(node_id, **fields)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
    return brain.get_node(node_id)


@router.delete("/brain/nodes/{node_id}")
def delete_brain_node(node_id: str) -> dict:
    _node_or_404(node_id)
    brain.delete_node(node_id)
    return {"id": node_id, "status": "deleted"}


@router.get("/brain/edges")
def list_brain_edges(project_id: str) -> dict:
    return {"edges": brain.list_edges(project_id)}


@router.post("/brain/edges")
def create_brain_edge(req: EdgeCreate) -> dict:
    return brain.add_edge(
        project_id=req.project_id,
        from_id=req.from_id,
        to_id=req.to_id,
        rel=req.rel,
    )


@router.delete("/brain/edges/{edge_id}")
def delete_brain_edge(edge_id: str) -> dict:
    db_edge = None
    from tui_pilot import db as _db
    rows = _db.query("SELECT * FROM brain_edges WHERE id = ?", (edge_id,))
    if not rows:
        raise HTTPException(404, f"no brain edge {edge_id!r}")
    brain.delete_edge(edge_id)
    return {"id": edge_id, "status": "deleted"}
