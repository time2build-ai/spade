"""Spade HTTP router — tasks, backlog, grounding, brain.

Mounted into server.py via app.include_router(spade_server.router).
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from . import brain, pipelines, projects, tasks

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


def _edge_or_404(edge_id: str) -> dict:
    e = brain.get_edge(edge_id)
    if e is None:
        raise HTTPException(404, f"no brain edge {edge_id!r}")
    return e


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
    try:
        return brain.add_edge(
            project_id=req.project_id,
            from_id=req.from_id,
            to_id=req.to_id,
            rel=req.rel,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.delete("/brain/edges/{edge_id}")
def delete_brain_edge(edge_id: str) -> dict:
    _edge_or_404(edge_id)
    brain.delete_edge(edge_id)
    return {"id": edge_id, "status": "deleted"}


# ---- pipeline request models ------------------------------------------------

class PipelineCreate(BaseModel):
    project_id: str
    task_id: str


class AdvanceRequest(BaseModel):
    report: str | None = None


# ---- pipeline spawn callback ------------------------------------------------

def _stage_prompt(run: dict, idx: int) -> str:
    """Build the prompt for stage ``idx`` of ``run``.

    Stage 0 (developer) gets the task title + description + grounded brain-node
    labels for context; later stages get a short instruction to continue the
    pipeline (the report_context carries the prior stage's work)."""
    role = pipelines.STAGES[idx]
    if idx == 0:
        task = tasks.get(run["task_id"]) or {}
        lines = [f"Implement this task: {task.get('title', run['task_id'])}"]
        if task.get("description"):
            lines.append("")
            lines.append(task["description"])
        node_labels = []
        for nid in tasks.nodes(run["task_id"]):
            node = brain.get_node(nid)
            if node:
                node_labels.append(f"- [{node['type']}] {node['label']}")
        if node_labels:
            lines.append("")
            lines.append("Grounded product-brain context:")
            lines.extend(node_labels)
        return "\n".join(lines)
    return (
        f"Continue this pipeline as the {role}. The previous stage's handoff "
        "report (above) is your input — act on it and emit a `finished` signal "
        "when done."
    )


def _pipeline_spawn(run: dict):
    """Return a ``spawn(idx, report)`` closure that spawns a real worker for the
    given pipeline run via ``server._spawn_agent`` and returns
    ``(session_id, account_id)``. Stamps the run/stage onto the session's _meta
    so the poll loop can auto-advance the pipeline on finish."""
    from . import server

    project = projects.get(run["project_id"]) or {}

    def spawn(idx: int, report: str | None):
        info = server._spawn_agent(
            name=f"{pipelines.STAGES[idx]}-{run['id']}",
            role=pipelines.STAGES[idx],
            project_id=run["project_id"],
            cwd=project.get("path"),
            task=_stage_prompt(run, idx),
            mission=run["id"],
            parent=None,
            report_context=report,
        )
        sid = info["id"]
        # Stamp the run/stage onto the session's _meta so the poll loop's
        # auto-advance branch can find and advance this pipeline on finish.
        meta = server._meta.get(sid)
        if meta is not None:
            meta["pipeline_run_id"] = run["id"]
            meta["pipeline_stage_idx"] = idx
        return (sid, info.get("account_id"))

    return spawn


# ---- pipeline helpers -------------------------------------------------------

def _run_or_404(run_id: str) -> dict:
    run = pipelines.get(run_id)
    if run is None:
        raise HTTPException(404, f"no pipeline run {run_id!r}")
    return run


# ---- pipeline endpoints -----------------------------------------------------

@router.post("/pipelines")
def create_pipeline(req: PipelineCreate) -> dict:
    if projects.get(req.project_id) is None:
        raise HTTPException(404, f"no project {req.project_id!r}")
    if tasks.get(req.task_id) is None:
        raise HTTPException(404, f"no task {req.task_id!r}")
    return pipelines.create_run(project_id=req.project_id, task_id=req.task_id)


@router.get("/pipelines")
def list_pipelines(project_id: str) -> dict:
    return {"pipelines": pipelines.list_for_project(project_id)}


@router.get("/pipelines/{run_id}")
def get_pipeline(run_id: str) -> dict:
    return _run_or_404(run_id)


@router.post("/pipelines/{run_id}/start")
def start_pipeline(run_id: str) -> dict:
    run = _run_or_404(run_id)
    pipelines.start_stage(run_id, 0, _pipeline_spawn(run))
    return _run_or_404(run_id)


@router.post("/pipelines/{run_id}/advance")
def advance_pipeline(run_id: str, req: AdvanceRequest) -> dict:
    """Manually complete the current running stage and start the next one."""
    run = _run_or_404(run_id)
    idx = run["current_stage"]
    pipelines.complete_stage(run_id, idx, report=req.report, spawn=_pipeline_spawn(run))
    return _run_or_404(run_id)
