"""Spade HTTP router — tasks, backlog, grounding, brain.

Mounted into server.py via app.include_router(spade_server.router).
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from . import (
    artifacts, brain, chat, feedback, gates, integrations, lifecycle,
    lifecycle_git, meeting_samples, meetings, pipelines, project_git,
    projects, sprints, tasks,
)

router = APIRouter()

# Per-project git facade the lifecycle engine calls (persistent clone + gh).
# Tests monkeypatch this module attribute with a fake so no real git/gh runs.
_lifecycle_git = lifecycle_git.for_project


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


class CommentCreate(BaseModel):
    body: str
    author: str | None = "you"
    kind: str = "note"


class LinkCreate(BaseModel):
    to_task: str
    rel: str


# ---- helpers ----------------------------------------------------------------

def _task_or_404(task_id: str) -> dict:
    t = tasks.get(task_id)
    if t is None:
        raise HTTPException(404, f"no task {task_id!r}")
    return t


def _enrich(task: dict) -> dict:
    """Add grounded nodes + task links to a task dict."""
    task = dict(task)
    task["nodes"] = tasks.nodes(task["id"])
    task["links"] = tasks.links(task["id"])
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
        tasks.move(task_id, req.status, force=True)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return _enrich(tasks.get(task_id))


@router.put("/tasks/{task_id}/nodes")
def set_task_nodes(task_id: str, req: NodesRequest) -> dict:
    _task_or_404(task_id)
    tasks.set_nodes(task_id, req.node_ids)
    return _enrich(tasks.get(task_id))


@router.get("/tasks/{task_id}/comments")
def list_task_comments(task_id: str) -> dict:
    _task_or_404(task_id)
    return {"comments": tasks.comments(task_id)}


@router.post("/tasks/{task_id}/comments")
def add_task_comment(task_id: str, req: CommentCreate) -> dict:
    _task_or_404(task_id)
    body = req.body.strip()
    if not body:
        raise HTTPException(400, "comment body must not be empty")
    return tasks.add_comment(task_id, body=body, author=req.author, kind=req.kind)


@router.post("/tasks/{task_id}/links")
def add_task_link(task_id: str, req: LinkCreate) -> dict:
    _task_or_404(task_id)
    _task_or_404(req.to_task)
    if req.rel not in tasks.LINK_RELS:
        raise HTTPException(400, f"invalid rel {req.rel!r}; must be one of {tasks.LINK_RELS}")
    if req.to_task == task_id:
        raise HTTPException(400, "a task cannot link to itself")
    tasks.add_link(task_id, req.to_task, req.rel)
    return _enrich(tasks.get(task_id))


@router.delete("/tasks/{task_id}/links/{link_id}")
def delete_task_link(task_id: str, link_id: str) -> dict:
    if tasks.link_get(link_id) is None:
        raise HTTPException(404, f"no link {link_id!r}")
    tasks.remove_link(link_id)
    return {"id": link_id, "status": "deleted"}


# ---- brain request models ---------------------------------------------------

class NodeCreate(BaseModel):
    project_id: str
    type: str
    label: str
    detail: str | None = None
    x: float | None = None
    y: float | None = None
    status: str | None = None
    owner: str | None = None
    source: str | None = None


class NodePatch(BaseModel):
    type: str | None = None
    label: str | None = None
    detail: str | None = None
    x: float | None = None
    y: float | None = None
    status: str | None = None
    owner: str | None = None
    source: str | None = None


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
            status=req.status,
            owner=req.owner,
            source=req.source,
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


@router.get("/brain/export")
def export_brain(project_id: str) -> dict:
    """Real MCP-style manifest derived from the project's brain graph."""
    return brain.export_manifest(project_id)


@router.get("/brain/gaps")
def brain_gaps(project_id: str) -> dict:
    """Real gap findings derived from the brain graph."""
    return {"gaps": brain.find_gaps(project_id)}


@router.get("/gate/conflict")
def gate_conflict(project_id: str) -> dict:
    """A real gate conflict (existing vs proposed decision) derived from the
    brain, or {conflict: null} when the graph has no proposed/active pair."""
    return {"conflict": brain.find_conflict(project_id)}


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
        # Write pipeline_run_id LAST: the collector gates on pipeline_run_id then
        # reads pipeline_stage_idx (defaulting to 0). Single-key dict writes are
        # GIL-atomic, so writing the gate key last guarantees a tick that sees
        # the run id also sees the correct stage_idx — closing the advance race.
        meta = server._meta.get(sid)
        if meta is not None:
            meta["pipeline_stage_idx"] = idx
            meta["pipeline_run_id"] = run["id"]  # gate key written last
        return (sid, info.get("account_id"))

    return spawn


# ---- lifecycle spawn callback ----------------------------------------------

_PHASE_JSON = {
    "shaping": '{"spec_path": "...", "plan_path": "...", "summary": "..."}',
    "building": '{"tests": "green", "test_guide_path": "...", "failing": []}',
    "pr_review": '{"findings": [{"path": "...", "line": 1, "body": "..."}], '
                 '"summary": "...", "review_report_path": "..."}',
}


def _phase_prompt(run: dict, phase: str) -> str:
    """Build the prompt for a lifecycle ``phase`` agent.

    Invokes the relevant superpowers skills by name, replays any prior artifacts
    and the latest changes-requested comment (``run['resume_comment']``, set by
    the engine before spawn), and instructs the agent to end with a ``finished``
    handoff whose report is the exact JSON payload the engine parses for the
    phase.
    """
    task = tasks.get(run["task_id"]) or {}
    lines: list[str] = [f"Task {run['task_id']}: {task.get('title', run['task_id'])}"]
    if task.get("description"):
        lines += ["", task["description"]]

    prior = artifacts.for_task(run["task_id"])
    if prior:
        lines += ["", "Prior artifacts pinned to this task:"]
        lines += [f"- [{a['kind']}] {a.get('title') or ''} @ {a.get('repo_path') or '?'}"
                  for a in prior]

    resume = run.get("resume_comment")
    if resume:
        lines += ["", f"Changes requested — address this feedback:\n{resume}"]

    lines += [""]
    if phase == "shaping":
        lines += [
            "Use the superpowers:brainstorming skill to explore the problem, then "
            "the superpowers:writing-plans skill to produce a spec and an "
            "implementation plan committed to this worktree.",
        ]
    elif phase == "building":
        lines += [
            "Use the superpowers:executing-plans skill and "
            "superpowers:test-driven-development to implement the approved plan in "
            "this worktree. Commit your work and make sure the test suite is green.",
        ]
    elif phase == "pr_review":
        lines += [
            "Use the superpowers:requesting-code-review skill (plus the project's "
            "PR review conventions) to review the open PR for this branch and "
            "collect actionable findings.",
        ]

    lines += [
        "",
        "When finished, emit a `finished` signal whose report is EXACTLY this JSON "
        f"(no prose around it):\n{_PHASE_JSON.get(phase, '{}')}",
    ]
    return "\n".join(lines)


def _lifecycle_spawn(run: dict):
    """Return a ``spawn(run, phase)`` closure that spawns a real lifecycle agent
    via ``server._spawn_agent`` and returns ``(session_id, account_id)``.

    The engine passes the live run to the closure on each phase, so the outer
    ``run`` argument is unused (kept for parity with ``_pipeline_spawn`` and the
    drainer call site). Stamps the run/phase onto the session's ``_meta`` so the
    poll loop's auto-advance branch can find and advance this run on finish."""
    from . import server

    def spawn(run: dict, phase: str):
        info = server._spawn_agent(
            name=f"{phase}-{run['id']}",
            role=phase,
            project_id=run["project_id"],
            cwd=run["worktree_path"],
            task=_phase_prompt(run, phase),
            mission=run["id"],
            parent=None,
        )
        sid = info["id"]
        # Stamp phase then run_id LAST (matches the pipeline gate-key ordering):
        # single-key dict writes are GIL-atomic, so a tick that sees the run id
        # also sees the correct phase — closing the advance race.
        meta = server._meta.get(sid)
        if meta is not None:
            meta["lifecycle_phase"] = phase
            meta["lifecycle_run_id"] = run["id"]  # gate key written last
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


# ---- sprints --------------------------------------------------------------


class SprintCreate(BaseModel):
    project_id: str
    number: int
    day_label: str | None = None
    state: str = "active"
    started_at: str | None = None


@router.get("/sprints")
def list_sprints(project_id: str) -> dict:
    return {"sprints": sprints.list_for_project(project_id)}


@router.post("/sprints")
def create_sprint(req: SprintCreate) -> dict:
    if projects.get(req.project_id) is None:
        raise HTTPException(404, f"no project {req.project_id!r}")
    return sprints.create(
        project_id=req.project_id, number=req.number,
        day_label=req.day_label, state=req.state, started_at=req.started_at,
    )


# ---- meetings -------------------------------------------------------------


class MeetingCreate(BaseModel):
    project_id: str
    title: str
    date: str | None = None
    summary: str | None = None
    attendees: list[str] | None = None
    transcript: str | None = None
    source: str | None = None


class MeetingIngest(BaseModel):
    project_id: str
    # Either a canned sample id (see GET /meetings/samples) or an explicit
    # transcript + title. Sample fields fill any gaps left by the explicit ones.
    sample: str | None = None
    title: str | None = None
    date: str | None = None
    summary: str | None = None
    attendees: list[str] | None = None
    transcript: str | None = None
    source: str | None = None


@router.get("/meetings")
def list_meetings(project_id: str) -> dict:
    return {"meetings": meetings.list_for_project(project_id)}


@router.get("/meetings/samples")
def list_meeting_samples() -> dict:
    """Catalog of canned meeting transcripts the UI can ingest in the demo."""
    return {"samples": meeting_samples.listing()}


@router.post("/meetings")
def create_meeting(req: MeetingCreate) -> dict:
    if projects.get(req.project_id) is None:
        raise HTTPException(404, f"no project {req.project_id!r}")
    return meetings.create(
        project_id=req.project_id, title=req.title, date=req.date,
        summary=req.summary, attendees=req.attendees,
        transcript=req.transcript, source=req.source,
    )


@router.post("/meetings/ingest")
def ingest_meeting(req: MeetingIngest) -> dict:
    """Ingest a meeting transcript and spin its action items into backlog tasks.

    Returns {"meeting", "tasks"} — the recorded meeting and the tasks created from
    it (each grounded back to the meeting)."""
    if projects.get(req.project_id) is None:
        raise HTTPException(404, f"no project {req.project_id!r}")
    try:
        return meetings.ingest(
            req.project_id, sample=req.sample, title=req.title, date=req.date,
            summary=req.summary, attendees=req.attendees,
            transcript=req.transcript, source=req.source,
        )
    except ValueError as e:
        raise HTTPException(422, str(e))


# ---- feedback clusters ----------------------------------------------------


class FeedbackCreate(BaseModel):
    project_id: str
    label: str
    count: int = 0
    sources: list[dict] | None = None


@router.get("/feedback")
def list_feedback(project_id: str) -> dict:
    return {"clusters": feedback.list_for_project(project_id)}


@router.post("/feedback")
def create_feedback(req: FeedbackCreate) -> dict:
    if projects.get(req.project_id) is None:
        raise HTTPException(404, f"no project {req.project_id!r}")
    return feedback.create(
        project_id=req.project_id, label=req.label,
        count=req.count, sources=req.sources,
    )


# ---- integrations ---------------------------------------------------------


class IntegrationCreate(BaseModel):
    project_id: str
    name: str
    category: str | None = None
    status: str = "off"
    usage: str | None = None
    connected: bool = False


class IntegrationPatch(BaseModel):
    connected: bool


@router.get("/integrations")
def list_integrations(project_id: str) -> dict:
    return {"integrations": integrations.list_for_project(project_id)}


@router.post("/integrations")
def create_integration(req: IntegrationCreate) -> dict:
    if projects.get(req.project_id) is None:
        raise HTTPException(404, f"no project {req.project_id!r}")
    return integrations.create(
        project_id=req.project_id, name=req.name, category=req.category,
        status=req.status, usage=req.usage, connected=req.connected,
    )


@router.patch("/integrations/{id}")
def patch_integration(id: str, req: IntegrationPatch) -> dict:
    row = integrations.set_connected(id, req.connected)
    if row is None:
        raise HTTPException(404, f"no integration {id!r}")
    return row


# ---- chat threads + messages ----------------------------------------------


class ThreadCreate(BaseModel):
    project_id: str
    title: str | None = None
    pinned: bool = False


class MessageCreate(BaseModel):
    role: str
    text: str
    who: str | None = None
    payload: dict | None = None


@router.get("/chat/threads")
def list_chat_threads(project_id: str) -> dict:
    return {"threads": chat.list_threads(project_id)}


@router.post("/chat/threads")
def create_chat_thread(req: ThreadCreate) -> dict:
    if projects.get(req.project_id) is None:
        raise HTTPException(404, f"no project {req.project_id!r}")
    return chat.create_thread(req.project_id, title=req.title, pinned=req.pinned)


@router.get("/chat/threads/{thread_id}/messages")
def list_chat_messages(thread_id: str) -> dict:
    if chat.get_thread(thread_id) is None:
        raise HTTPException(404, f"no thread {thread_id!r}")
    return {"messages": chat.list_messages(thread_id)}


@router.post("/chat/threads/{thread_id}/messages")
def create_chat_message(thread_id: str, req: MessageCreate) -> dict:
    if chat.get_thread(thread_id) is None:
        raise HTTPException(404, f"no thread {thread_id!r}")
    return chat.add_message(thread_id, role=req.role, text=req.text,
                            who=req.who, payload=req.payload)


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
    # Idempotent on a finished run: a shipped/paused run is not advanced again
    # (so we never re-run complete_stage or re-call tasks.move).
    if run["status"] in ("shipped", "paused"):
        return run
    idx = run["current_stage"]
    pipelines.complete_stage(run_id, idx, report=req.report, spawn=_pipeline_spawn(run))
    return _run_or_404(run_id)
