"""Spade HTTP router — tasks, backlog, grounding.

Mounted into server.py via app.include_router(spade_server.router).
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from . import tasks

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
