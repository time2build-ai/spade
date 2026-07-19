"""Spade HTTP router — tasks, backlog, grounding, brain.

Mounted into server.py via app.include_router(spade_server.router).
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

import json

from . import (
    artifacts, brain, chat, doc_templates, fanout, feedback, gates, gitops,
    integrations, lifecycle, lifecycle_git, lifecycle_templates, meeting_samples,
    meetings, pipelines, project_git, projects, sprints, tasks,
)
from . import router as task_router

router = APIRouter()

# Per-project git facade the lifecycle engine calls (persistent clone + gh).
# Tests monkeypatch this module attribute with a fake so no real git/gh runs.
# Lazy: research/docs runs never touch git, so building this for any kind must
# not require a repo. It resolves config only on first real git op (code phases).
_lifecycle_git = lifecycle_git.lazy_for_project


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


class KindConfirm(BaseModel):
    kind: str
    doc_template: str | None = None


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
    # Route on creation: store the router's suggestion (advisory), NOT the
    # authoritative kind — a human (or Start) confirms it later.
    guess = task_router.classify(req.title, req.description or "")
    tasks.set_suggestion(t["id"], guess["kind"], guess["reason"])
    return _enrich(tasks.get(t["id"]))


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


@router.post("/tasks/{task_id}/kind")
def confirm_task_kind(task_id: str, req: KindConfirm) -> dict:
    """Confirm / override a task's lifecycle ``kind``.

    Rejected with 409 once ANY lifecycle run exists for the task (active OR
    terminal) — the kind is locked at Start and stays locked through
    shipped/delivered. The guard lives here (not in ``tasks.set_kind``) because
    ``lifecycle`` imports ``tasks``; calling ``lifecycle`` from the setter would
    be a circular import.
    """
    _task_or_404(task_id)
    if req.kind not in tasks.KINDS:
        raise HTTPException(400, f"invalid kind {req.kind!r}; must be one of {tasks.KINDS}")
    if req.doc_template is not None and (
        req.kind != "docs" or req.doc_template not in ("sow", "explainer")
    ):
        raise HTTPException(
            400,
            f"invalid doc_template {req.doc_template!r}; only valid for kind='docs' "
            "as one of ('sow', 'explainer')",
        )
    if lifecycle.has_run_for_task(task_id):
        raise HTTPException(409, f"task {task_id!r} has a lifecycle run; kind is locked")
    if req.kind not in lifecycle_templates.LIFECYCLE_TEMPLATES:
        raise HTTPException(400, f"kind {req.kind!r} is not yet runnable (no template registered)")
    tasks.set_kind(task_id, req.kind, doc_template=req.doc_template)
    return _enrich(tasks.get(task_id))


@router.post("/projects/{project_id}/route-untyped")
def route_untyped(project_id: str) -> dict:
    """Backfill: classify every null-``kind`` task in the project, storing the
    router's suggestion (leaves the authoritative kind untouched)."""
    if projects.get(project_id) is None:
        raise HTTPException(404, f"no project {project_id!r}")
    routed = 0
    for t in tasks.list_for_project(project_id):
        if t.get("kind") is not None:
            continue
        guess = task_router.classify(t["title"], t.get("description") or "")
        tasks.set_suggestion(t["id"], guess["kind"], guess["reason"])
        routed += 1
    return {"project_id": project_id, "routed": routed}


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


# ---- lifecycle spawn callback ----------------------------------------------

_PHASE_JSON = {
    "shaping": '{"spec_path": "...", "plan_path": "...", "summary": "..."}',
    "building": '{"tests": "green", "test_guide_path": "...", "failing": []}',
    "pr_review": '{"findings": [{"path": "...", "line": 1, "body": "..."}], '
                 '"summary": "...", "review_report_path": "..."}',
    # research phases (Chunk 4): without these the prompt appends `{}` and the
    # engine's defensive JSON parse would block every research agent.
    "scoping": '{"angles": [{"brief": "...", "mode": "repo|web"}], "summary": "..."}',
    # the per-angle investigator (its prompt is built by _fanout_prompt)
    "investigating": '{"summary": "...", "evidence": ["..."]}',
    "synthesis": '{"report": "...", '
                 '"followups": [{"title": "...", "description": "..."}], '
                 '"brain_nodes": [{"type": "feature|decision|convention|feedback|'
                 'bug|metric", "label": "...", "detail": "..."}]}',
    # docs phases (Chunk 5): outline proposes the structure; drafting emits the
    # styled BODY sections ONLY (render_shell wraps them once at render time).
    "outline": '{"outline": "...", "summary": "..."}',
    "drafting": '{"doc_html": "...", "summary": "..."}',
}


# Per-artifact cap on embedded inline content (research findings/report can be
# large deep-research outputs; N of them concatenated is otherwise unbounded).
_EMBED_MAX_CHARS = 6000


def _embed_block(content: str | None) -> str:
    """Render inline artifact ``content`` as a safely-delimited, size-capped block.

    Uses a ``<<<CONTENT>>> … <<<END>>>`` delimiter rather than triple-backticks so
    agent content that itself contains a ``` fence can't break out, and truncates
    to ``_EMBED_MAX_CHARS`` with a marker to bound context bloat."""
    text = content or ""
    if len(text) > _EMBED_MAX_CHARS:
        text = text[:_EMBED_MAX_CHARS] + "\n…[truncated]"
    return f"<<<CONTENT\n{text}\nCONTENT>>>"


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
        for a in prior:
            title = a.get("title") or ""
            if a.get("repo_path"):
                # repo-path pointer: a metadata line (resolved from git elsewhere).
                lines.append(f"- [{a['kind']}] {title} @ {a['repo_path']}")
            else:
                # inline content (research findings/report, docs): EMBED it so the
                # synthesis manager actually sees the findings, not a `@ None` list.
                # Delimited + size-capped so a ``` inside content can't break out
                # and N large findings don't blow up the context.
                lines.append(f"- [{a['kind']}] {title}:")
                lines.append(_embed_block(a.get("content")))

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
    elif phase == "scoping":
        lines += [
            "Scope this research task into a handful of independent ANGLES to "
            "investigate in parallel. Ground each angle in what already exists — "
            "check the project brain and codebase. For each angle give a short "
            "`brief` and a `mode`: `repo` (investigate the codebase) or `web` "
            "(research the open web via the deep-research skill).",
        ]
    elif phase == "synthesis":
        lines += [
            "You are the research MANAGER. The per-angle findings are embedded "
            "above. First run a VERIFY pass — cross-check the findings against each "
            "other and flag anything unsupported — then synthesize a single cited "
            "`report`. Propose any concrete `followups` (new tasks) and "
            "`brain_nodes` (durable knowledge: type one of feature/decision/"
            "convention/feedback/bug/metric) the research warrants.",
        ]
    elif phase == "outline":
        dt = (task.get("doc_template") or "explainer")
        tpl = doc_templates.TEMPLATES.get(dt, doc_templates.TEMPLATES["explainer"])
        lines += [
            f"Outline a {tpl['label']} document for this task. Propose the section "
            "structure and the key points each section will cover — the human "
            "reviews this outline before you write the full draft. The required "
            f"sections for this template are: {', '.join(tpl['sections'])}.",
        ]
    elif phase == "drafting":
        dt = (task.get("doc_template") or "explainer")
        tpl = doc_templates.TEMPLATES.get(dt, doc_templates.TEMPLATES["explainer"])
        lines += [
            f"Write the full {tpl['label']} document per the approved outline. "
            f"Include these required sections, each as one `<section>` with an "
            f"`<h2>` heading: {', '.join(tpl['sections'])}.",
            "",
            "Emit BODY sections ONLY — a sequence of `<section>` elements. Do NOT "
            "wrap them in `<html>`, `<head>`, `<body>`, or any full-document shell "
            "and do NOT add `<style>`/`<script>`: a shared house-style shell is "
            "applied once at render time.",
            "Any diagrams MUST be PRE-RENDERED to inline `<svg>` (render mermaid to "
            "static SVG yourself and embed the SVG) — the rendered doc is served in "
            "a locked, script-less sandbox, so no client-side mermaid/JS will run.",
        ]

    lines += [
        "",
        "When finished, emit a `finished` signal whose report is EXACTLY this JSON "
        f"(no prose around it):\n{_PHASE_JSON.get(phase, '{}')}",
    ]
    return "\n".join(lines)


def _fanout_prompt(run: dict, phase: str, idx: int) -> str:
    """Build the prompt for ONE fan-out angle (research investigating #idx).

    ``_phase_prompt`` can't see ``idx``, so the fan-out spawn routes here. Reads
    the angle's ``fanout_agents`` row and branches on its ``mode``: ``repo`` →
    repo tools scoped to the brief; ``web`` → invoke the ``deep-research`` skill.
    """
    task = tasks.get(run["task_id"]) or {}
    row = fanout.get_row(run["id"], phase, idx) or {}
    try:
        angle = json.loads(row.get("angle") or "{}")
    except (json.JSONDecodeError, TypeError):
        angle = {}
    if not isinstance(angle, dict):
        angle = {"brief": str(angle)}
    brief = angle.get("brief") or angle.get("angle") or row.get("angle") or ""
    mode = angle.get("mode") or row.get("mode") or "repo"

    lines = [
        f"Task {run['task_id']}: {task.get('title', run['task_id'])}",
        "",
        f"You are investigating ONE research angle (#{idx}) of this task:",
        f"  {brief}",
        "",
    ]
    if mode == "web":
        lines += [
            "Use the `deep-research` skill to research this angle on the open web: "
            "fan out searches, fetch and read sources, adversarially verify claims, "
            "and synthesize a cited finding scoped to the brief above.",
        ]
    else:
        lines += [
            "Investigate this angle IN THE REPOSITORY: use grep/read to find the "
            "relevant code, configuration, and docs, and ground your finding in "
            "concrete file references scoped to the brief above.",
        ]
    lines += [
        "",
        "When finished, emit a `finished` signal whose report is EXACTLY this JSON "
        f"(no prose around it):\n{_PHASE_JSON.get('investigating', '{}')}",
    ]
    return "\n".join(lines)


def _spawn_prompt(run: dict, phase: str) -> str:
    """Dispatch prompt building: a fan-out phase's per-idx investigator prompt vs
    the generic single-agent phase prompt. The fan-out idx is threaded on the run
    dict (``fanout_idx``) by ``lifecycle._spawn_fanout``."""
    kind = run.get("kind") or "code"
    if phase in lifecycle_templates.fanout_phases(kind) \
            and run.get("fanout_idx") is not None:
        return _fanout_prompt(run, phase, run["fanout_idx"])
    return _phase_prompt(run, phase)


def _lifecycle_spawn(run: dict):
    """Return a ``spawn(run, phase)`` closure that spawns a real lifecycle agent
    via ``server._spawn_agent`` and returns ``(session_id, account_id)``.

    The engine passes the live run to the closure on each phase, so the outer
    ``run`` argument is unused (kept for symmetry with the drainer call site).
    Stamps the run/phase onto the session's ``_meta`` so the
    poll loop's auto-advance branch can find and advance this run on finish."""
    from . import server

    def spawn(run: dict, phase: str):
        info = server._spawn_agent(
            name=f"{phase}-{run['id']}",
            role=phase,
            project_id=run["project_id"],
            cwd=run.get("worktree_path"),
            task=_spawn_prompt(run, phase),
            mission=run["id"],
            parent=None,
        )
        sid = info["id"]
        # Stamp phase first, then the TRIGGER key LAST (single-key dict writes are
        # GIL-atomic, so a poll tick that sees the trigger key also sees phase +
        # idx — closing the advance race). A fan-out agent sets the DISTINCT
        # `lifecycle_fanout_run_id` (and idx) and never the plain `lifecycle_run_id`,
        # so the single-agent collector can never claim a fan-out finish.
        meta = server._meta.get(sid)
        if meta is not None:
            meta["lifecycle_phase"] = phase
            kind = run.get("kind") or "code"
            if phase in lifecycle_templates.fanout_phases(kind):
                meta["lifecycle_fanout_idx"] = run.get("fanout_idx")
                meta["lifecycle_fanout_run_id"] = run["id"]  # trigger key last
            else:
                meta["lifecycle_run_id"] = run["id"]  # gate key written last
        return (sid, info.get("account_id"))

    return spawn


# ---- pipeline helpers -------------------------------------------------------

def _run_or_404(run_id: str) -> dict:
    run = pipelines.get(run_id)
    if run is None:
        raise HTTPException(404, f"no pipeline run {run_id!r}")
    return run


# ---- pipeline endpoints (READ-ONLY) -----------------------------------------
# The pipeline WRITE path (create/start/advance) was retired in favor of the
# lifecycle engine. These GET endpoints remain for one release so existing
# client read sites keep resolving; the tables stay read-only. See
# schema.sql's TODO(cleanup, next release).

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


# ---- lifecycle request models ----------------------------------------------


class LifecycleStart(BaseModel):
    project_id: str
    task_id: str


class GateDecision(BaseModel):
    comment: str | None = None


class ProjectGitPut(BaseModel):
    repo_ssh_url: str | None = None
    dev_branch: str | None = None
    staging_branch: str | None = None
    prod_branch: str | None = None
    worktrees_root: str | None = None


class PromoteRequest(BaseModel):
    from_env: str
    to_env: str


# ---- lifecycle helpers ------------------------------------------------------

_ENV_STAMP = {"dev": "env_dev_at", "staging": "env_staging_at", "prod": "env_prod_at"}
_ENV_BRANCH = {"dev": "dev_branch", "staging": "staging_branch", "prod": "prod_branch"}
_ENV_ORDER = ["dev", "staging", "prod"]


def _lifecycle_run_or_404(run_id: str) -> dict:
    run = lifecycle.get(run_id)
    if run is None:
        raise HTTPException(404, f"no lifecycle run {run_id!r}")
    return run


def _active_run_or_404(task_id: str) -> dict:
    run = lifecycle.active_run_for_task(task_id)
    if run is None:
        raise HTTPException(404, f"no active lifecycle run for task {task_id!r}")
    return run


def _furthest_env(run: dict) -> str | None:
    """The furthest deployment env a shipped run has reached, or None."""
    reached = None
    for env in _ENV_ORDER:
        if run.get(_ENV_STAMP[env]):
            reached = env
    return reached


# ---- lifecycle endpoints ----------------------------------------------------

@router.post("/lifecycle/start")
def lifecycle_start(req: LifecycleStart) -> dict:
    if projects.get(req.project_id) is None:
        raise HTTPException(404, f"no project {req.project_id!r}")
    task = tasks.get(req.task_id)
    if task is None:
        raise HTTPException(404, f"no task {req.task_id!r}")
    # Resolve + LOCK the kind onto the task before start_run reads it. Precedence:
    # confirmed kind → router suggestion → code default.
    if task.get("kind"):
        kind, source = task["kind"], "confirmed"
    elif task.get("kind_suggested"):
        kind, source = task["kind_suggested"], "router suggestion"
    else:
        kind, source = "code", "default"
    if kind not in tasks.KINDS:
        kind, source = "code", "default"
    # Guard on REGISTERED kinds: research/docs are valid KINDS but their templates
    # only register in Chunks 4/5. A clean 400 here beats letting template_for()
    # raise a KeyError → HTTP 500. When those templates land, this passes.
    if kind not in lifecycle_templates.LIFECYCLE_TEMPLATES:
        raise HTTPException(400, f"kind {kind!r} is not yet runnable (no template registered)")
    if not task.get("kind"):
        tasks.set_kind(req.task_id, kind, doc_template=task.get("doc_template"))
        tasks.add_comment(
            req.task_id,
            body=f"Lifecycle kind resolved to {kind!r} ({source}).",
            author="system", kind="system",
        )
    # The repo hard-requirement is KIND-CONDITIONAL: only kinds whose first phase
    # needs a workspace (code) require a configured repo; research/docs don't.
    if lifecycle_templates.needs_workspace(kind):
        cfg = project_git.get(req.project_id)
        if not cfg or not cfg.get("repo_ssh_url"):
            raise HTTPException(404, f"project {req.project_id!r} has no configured repo")
    try:
        return lifecycle.start_run(
            req.project_id, req.task_id,
            spawn=_lifecycle_spawn(None),
            git=_lifecycle_git(req.project_id),
        )
    except ValueError as e:
        raise HTTPException(409, str(e))


@router.get("/lifecycle")
def list_lifecycle(project_id: str) -> dict:
    return {"runs": lifecycle.list_for_project(project_id)}


# Declared BEFORE `/lifecycle/{run_id}` — FastAPI matches in declaration order,
# so a `{run_id}` route declared first would capture run_id="templates" and 404.
@router.get("/lifecycle/templates")
def get_lifecycle_templates() -> dict:
    """The per-kind board mapping (kind → phase → column) + gate/artifact labels,
    so the client buckets tasks without hardcoding a second copy of the registry."""
    return {
        "templates": lifecycle_templates.client_templates(),
        "gate_labels": lifecycle_templates.GATE_LABELS,
        "artifact_labels": lifecycle_templates.ARTIFACT_LABELS,
    }


@router.get("/lifecycle/{run_id}")
def get_lifecycle(run_id: str) -> dict:
    return _lifecycle_run_or_404(run_id)


@router.post("/lifecycle/{run_id}/retry")
def retry_lifecycle(run_id: str) -> dict:
    run = _lifecycle_run_or_404(run_id)
    lifecycle.retry(run_id, spawn=_lifecycle_spawn(run),
                    git=_lifecycle_git(run["project_id"]))
    return _lifecycle_run_or_404(run_id)


@router.post("/lifecycle/{run_id}/fanout/{idx}/retry")
def retry_fanout_angle(run_id: str, idx: int) -> dict:
    """Re-spawn one fan-out angle (a blocked/dead one). The fan-out phase is the
    run's current phase (the run sits there until the barrier releases)."""
    run = _lifecycle_run_or_404(run_id)
    lifecycle.retry_angle(run_id, run["phase"], idx,
                          spawn=_lifecycle_spawn(run),
                          git=_lifecycle_git(run["project_id"]))
    return _lifecycle_run_or_404(run_id)


@router.post("/lifecycle/{run_id}/fanout/{idx}/drop")
def drop_fanout_angle(run_id: str, idx: int) -> dict:
    """Give up on one fan-out angle; may release the barrier (→ synthesis)."""
    run = _lifecycle_run_or_404(run_id)
    lifecycle.drop_angle(run_id, run["phase"], idx,
                         spawn=_lifecycle_spawn(run),
                         git=_lifecycle_git(run["project_id"]))
    return _lifecycle_run_or_404(run_id)


@router.post("/tasks/{task_id}/gates/{gate}/approve")
def approve_gate(task_id: str, gate: str, req: GateDecision) -> dict:
    run = _active_run_or_404(task_id)
    lifecycle.decide_gate(run["id"], gate, "approved", comment=req.comment,
                          by="human", spawn=_lifecycle_spawn(run),
                          git=_lifecycle_git(run["project_id"]))
    return _lifecycle_run_or_404(run["id"])


@router.post("/tasks/{task_id}/gates/{gate}/request-changes")
def request_changes_gate(task_id: str, gate: str, req: GateDecision) -> dict:
    run = _active_run_or_404(task_id)
    lifecycle.decide_gate(run["id"], gate, "changes_requested", comment=req.comment,
                          by="human", spawn=_lifecycle_spawn(run),
                          git=_lifecycle_git(run["project_id"]))
    return _lifecycle_run_or_404(run["id"])


@router.get("/tasks/{task_id}/artifacts")
def list_task_artifacts(task_id: str) -> dict:
    _task_or_404(task_id)
    return {"artifacts": artifacts.for_task(task_id)}


def _read_worktree_file(worktree: str | None, repo_path: str | None) -> str | None:
    """Read a file straight from a run's worktree (committed OR not), or None if
    it's missing / resolves outside the worktree (path-traversal guard). Covers
    files an agent wrote but didn't commit — e.g. the pr_review review report."""
    import os
    if not worktree or not repo_path:
        return None
    base = os.path.realpath(worktree)
    p = os.path.realpath(os.path.join(base, repo_path))
    if not (p == base or p.startswith(base + os.sep)) or not os.path.isfile(p):
        return None
    try:
        with open(p, encoding="utf-8", errors="replace") as f:
            return f.read()
    except OSError:
        return None


@router.get("/tasks/{task_id}/artifacts/{artifact_id}/content")
def get_artifact_content(task_id: str, artifact_id: str) -> dict:
    art = artifacts.get(artifact_id)
    if art is None or art["task_id"] != task_id:
        raise HTTPException(404, f"no artifact {artifact_id!r}")
    task = _task_or_404(task_id)
    # Inline artifacts (research findings/reports, docs) store their body in
    # `content` with a null repo_path — return it directly (no git read).
    if not art.get("repo_path"):
        return {"content": art.get("content")}
    # Working-tree first: read the file from the run's worktree so an artifact the
    # agent wrote but hasn't committed (the review report) still loads. Fall back
    # to the committed content on the branch (e.g. after the worktree is gone).
    from . import lifecycle
    run = lifecycle.get(art["run_id"]) if art.get("run_id") else None
    wt_content = _read_worktree_file(run.get("worktree_path") if run else None, art["repo_path"])
    if wt_content is not None:
        return {"content": wt_content}
    if not art.get("branch"):
        raise HTTPException(404, "artifact has no pinned repo path/branch")
    try:
        content = _lifecycle_git(task["project_id"]).read_at_branch(
            art["repo_path"], art["branch"])
    except Exception as e:  # noqa: BLE001
        raise HTTPException(404, f"could not read artifact: {e}")
    return {"content": content}


# ---- shareable styled-doc route ---------------------------------------------
# Distinct top-level path (`/doc/...`) so it never collides with the `/tasks`,
# `/lifecycle`, `/brain`, etc. routes. Read-only; serves a `doc` artifact's
# BODY-only content wrapped ONCE in the shared render_shell (no double-shell).

# Belt-and-suspenders with render_shell's body sanitizer: a restrictive CSP so
# even if malicious markup slips the regex strip, the browser runs no script and
# fetches nothing external (render_shell is self-contained — inline styles + inline
# SVG only). nosniff stops content-type confusion on this shareable surface.
_DOC_HEADERS = {
    "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
    "X-Content-Type-Options": "nosniff",
}


@router.get("/doc/{artifact_id}", response_class=HTMLResponse)
def get_doc(artifact_id: str) -> HTMLResponse:
    art = artifacts.get(artifact_id)
    if art is None or art.get("kind") != "doc":
        raise HTTPException(404, f"no doc artifact {artifact_id!r}")
    title = art.get("title") or "Document"
    return HTMLResponse(
        doc_templates.render_shell(title, art.get("content") or ""),
        headers=_DOC_HEADERS,
    )


@router.get("/projects/{project_id}/git")
def get_project_git(project_id: str) -> dict:
    if projects.get(project_id) is None:
        raise HTTPException(404, f"no project {project_id!r}")
    return project_git.get(project_id) or {}


@router.put("/projects/{project_id}/git")
def put_project_git(project_id: str, req: ProjectGitPut) -> dict:
    if projects.get(project_id) is None:
        raise HTTPException(404, f"no project {project_id!r}")
    fields = {k: v for k, v in req.model_dump().items() if v is not None}
    return project_git.upsert(project_id, **fields)


class ScanBranchesReq(BaseModel):
    repo_ssh_url: str


@router.post("/projects/{project_id}/git/branches")
def scan_git_branches(project_id: str, req: ScanBranchesReq) -> dict:
    """List the remote's branches (via `git ls-remote`, no clone) so the settings
    UI can offer a dev/staging/prod picklist. 400 with the git error on failure
    (bad URL / no access) so the UI can fall back to free-text entry."""
    if projects.get(project_id) is None:
        raise HTTPException(404, f"no project {project_id!r}")
    from . import gitops
    try:
        branches = gitops.list_remote_branches(req.repo_ssh_url)
    except gitops.GitError as e:
        raise HTTPException(400, f"couldn't list branches: {str(e).strip()[:300]}")
    return {"branches": branches}


class CreateBranchesReq(BaseModel):
    repo_ssh_url: str
    branches: list[str]


@router.post("/projects/{project_id}/git/create-branches")
def create_git_branches(project_id: str, req: CreateBranchesReq) -> dict:
    """Create the given branches on an empty remote (fresh repo) so the user can
    get dev/staging/prod without leaving Spade. Pushes to their remote. 400 with
    the git error on failure."""
    if projects.get(project_id) is None:
        raise HTTPException(404, f"no project {project_id!r}")
    from . import gitops
    try:
        created = gitops.create_remote_branches(req.repo_ssh_url, req.branches)
    except gitops.GitError as e:
        raise HTTPException(400, f"couldn't create branches: {str(e).strip()[:300]}")
    return {"branches": created}


@router.get("/projects/{project_id}/gates")
def list_project_gates(project_id: str) -> dict:
    return {"gates": gates.waiting_for_project(project_id)}


@router.get("/projects/{project_id}/releases")
def list_releases(project_id: str) -> dict:
    """Tasks grouped by the furthest deployment env their run has reached."""
    lanes: dict[str, list] = {env: [] for env in _ENV_ORDER}
    for run in lifecycle.list_for_project(project_id):
        env = _furthest_env(run)
        if env is None:
            continue
        task = tasks.get(run["task_id"]) or {}
        lanes[env].append({
            "run_id": run["id"], "task_id": run["task_id"],
            "title": task.get("title"), "merge_commit": run.get("merge_commit"),
            "env_dev_at": run.get("env_dev_at"),
            "env_staging_at": run.get("env_staging_at"),
            "env_prod_at": run.get("env_prod_at"),
        })
    return {"releases": lanes}


@router.post("/projects/{project_id}/promote")
def promote_env(project_id: str, req: PromoteRequest) -> dict:
    cfg = project_git.get(project_id)
    if not cfg or not cfg.get("repo_ssh_url"):
        raise HTTPException(404, f"project {project_id!r} has no configured repo")
    if req.from_env not in _ENV_BRANCH or req.to_env not in _ENV_BRANCH:
        raise HTTPException(400, "from_env/to_env must be dev, staging, or prod")
    from_branch = cfg.get(_ENV_BRANCH[req.from_env])
    to_branch = cfg.get(_ENV_BRANCH[req.to_env])
    # Runs that sit in from_env but not yet to_env.
    from_stamp = _ENV_STAMP[req.from_env]
    to_stamp = _ENV_STAMP[req.to_env]
    grouped = [
        run for run in lifecycle.list_for_project(project_id)
        if run.get(from_stamp) and not run.get(to_stamp)
    ]
    if not grouped:
        raise HTTPException(
            409, f"no tasks in {req.from_env!r} awaiting promotion to {req.to_env!r}")
    titles = []
    for run in grouped:
        task = tasks.get(run["task_id"]) or {}
        titles.append(f"- {run['task_id']}: {task.get('title') or ''}")
    title = f"Promote {req.from_env} → {req.to_env} ({len(grouped)} task(s))"
    body = "Tasks in this release:\n" + ("\n".join(titles) if titles else "- (none)")
    try:
        pr = _lifecycle_git(project_id).promote(from_branch, to_branch, title, body)
    except gitops.GitError as e:
        raise HTTPException(409, f"promote failed: {e}")
    merged = bool(pr.get("merged"))
    for run in grouped:
        if merged:
            # The promotion PR merged, so these runs have reached to_env now —
            # stamp them directly (immediate lane move) instead of waiting for the
            # periodic ancestry watcher.
            lifecycle.stamp_env(run["id"], req.to_env)
            tasks.add_comment(
                run["task_id"],
                body=f"Promoted {req.from_env} → {req.to_env} (PR "
                     f"#{pr.get('pr_number')} merged).",
                author="system", kind="system",
            )
        else:
            tasks.add_comment(
                run["task_id"],
                body=f"Promotion PR opened {req.from_env} → {req.to_env}: "
                     f"#{pr.get('pr_number')} {pr.get('pr_url')} — merge it to finish"
                     + (f" (auto-merge failed: {pr.get('merge_error')})"
                        if pr.get("merge_error") else "") + ".",
                author="system", kind="system",
            )
    return pr
