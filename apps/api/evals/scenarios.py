"""Workflow evaluation scenarios — each drives a real product workflow.

Grouped by the lifecycle the user cares about: creating projects, getting info,
planning, executing, inputs, system, and the orchestrator decision core ("chat").
HTTP-level where the route is offline-safe; module-level (with a fake spawn) for
the pipeline execution state machine, which otherwise spawns live agents.
"""

from __future__ import annotations

from evals.harness import Ctx


def _client():
    from fastapi.testclient import TestClient
    from tui_pilot import server
    return TestClient(server.app)


def _project(client, pid="acme", **kw):
    body = {"id": pid, "name": kw.get("name", "Acme"), "path": kw.get("path", "/tmp/acme")}
    body.update({k: v for k, v in kw.items() if k in ("account_strategy", "model_ceiling", "autopilot")})
    r = client.post("/projects", json=body)
    return r


# ─────────────────────────────  PROJECTS  ─────────────────────────────

def project_lifecycle(ctx: Ctx):
    c = _client()
    r = _project(c, name="Acme Storefront", path="/tmp/acme")
    ctx.check(r.status_code == 200, "POST /projects creates a project", r.text)
    ctx.eq(r.json()["name"], "Acme Storefront", "created project echoes its name")

    g = c.get("/projects/acme")
    ctx.check(g.status_code == 200, "GET /projects/{id} returns the project")
    ctx.check("pool" in g.json(), "project detail includes its account pool")

    lst = c.get("/projects").json()["projects"]
    ctx.check(any(p["id"] == "acme" for p in lst), "GET /projects lists the new project")

    p = c.patch("/projects/acme", json={"autopilot": 1, "account_strategy": "round_robin", "model_ceiling": "opus"})
    ctx.eq(p.json()["autopilot"], 1, "PATCH persists autopilot")
    ctx.eq(c.get("/projects/acme").json()["account_strategy"], "round_robin", "strategy persisted")

    c.put("/current-project", json={"project_id": "acme"})
    ctx.eq(c.get("/current-project").json().get("project_id"), "acme", "current-project set + read back")

    d = c.delete("/projects/acme")
    ctx.check(d.status_code == 200, "DELETE /projects/{id} succeeds")
    ctx.eq(c.get("/projects/acme").status_code, 404, "deleted project is gone (404)")


# ─────────────────────────────  ACCOUNTS  ─────────────────────────────

def accounts_and_pool(ctx: Ctx):
    c = _client()
    a1 = c.post("/accounts", json={"id": "rm", "label": "rmurphy", "config_dir": "/x/rm",
                                   "role": "Developer", "model": "claude-opus-4", "plan": "Max"})
    ctx.eq(a1.json()["role"], "Developer", "account created with real role/model/plan")
    c.post("/accounts", json={"id": "lab", "label": "lab", "config_dir": "/x/lab"})

    pa = c.patch("/accounts/rm", json={"role": "Reviewer", "plan": "Team"})
    ctx.eq(pa.json()["role"], "Reviewer", "PATCH account updates role")

    c.post("/accounts/rm/default")
    rows = {a["id"]: a for a in c.get("/accounts").json()["accounts"]}
    ctx.eq(rows["rm"]["is_default"], 1, "set-default marks the account default")
    ctx.check("active_sessions" in rows["rm"], "GET /accounts exposes derived active_sessions")

    _project(c)
    c.put("/projects/acme/accounts", json={"account_ids": ["rm", "lab"]})
    pool = c.get("/projects/acme").json()["pool"]
    ctx.eq(pool, ["rm", "lab"], "project pool stored in order")


def round_robin_dispatch(ctx: Ctx):
    from tui_pilot import accounts, projects
    accounts.create(id="a", label="A", config_dir="/a")
    accounts.create(id="b", label="B", config_dir="/b")
    projects.create(id="p", name="P", path="/w", account_strategy="round_robin")
    projects.set_pool("p", ["a", "b"])
    picks = [projects.next_account("p") for _ in range(4)]
    ctx.eq(picks, ["a", "b", "a", "b"], "round-robin cycles accounts a,b,a,b")


# ─────────────────────────  PLANNING — BRAIN  ─────────────────────────

def brain_all_node_types(ctx: Ctx):
    c = _client()
    _project(c)
    for t in ["feature", "decision", "convention", "feedback", "bug", "metric"]:
        r = c.post("/brain/nodes", json={"project_id": "acme", "type": t, "label": f"{t} node"})
        ctx.check(r.status_code == 200, f"create brain node type={t}")
    bad = c.post("/brain/nodes", json={"project_id": "acme", "type": "bogus", "label": "x"})
    ctx.eq(bad.status_code, 400, "invalid node type rejected (400)")
    nodes = c.get("/brain/nodes", params={"project_id": "acme"}).json()["nodes"]
    ctx.eq(len(nodes), 6, "all 6 node types listed")


def brain_edges_and_relations(ctx: Ctx):
    c = _client()
    _project(c)
    f = c.post("/brain/nodes", json={"project_id": "acme", "type": "feature", "label": "Checkout"}).json()
    d = c.post("/brain/nodes", json={"project_id": "acme", "type": "decision", "label": "Use Stripe"}).json()
    e = c.post("/brain/edges", json={"project_id": "acme", "from_id": f["id"], "to_id": d["id"], "rel": "decided_by"})
    ctx.check(e.status_code == 200, "create an edge between two nodes")
    edges = c.get("/brain/edges", params={"project_id": "acme"}).json()["edges"]
    ctx.eq(len(edges), 1, "edge is listed for the project")


def decision_status_workflow(ctx: Ctx):
    c = _client()
    _project(c)
    d = c.post("/brain/nodes", json={"project_id": "acme", "type": "decision", "label": "Adopt X",
                                     "status": "proposed", "owner": "Robert"}).json()
    ctx.eq(d["status"], "proposed", "decision recorded with status=proposed (record-decision)")
    ctx.eq(d["owner"], "Robert", "decision records its owner")
    up = c.patch(f"/brain/nodes/{d['id']}", json={"status": "active"}).json()
    ctx.eq(up["status"], "active", "decision lifecycle: proposed → active via PATCH")


def node_provenance(ctx: Ctx):
    from tui_pilot import brain, projects
    projects.create(id="acme", name="Acme", path="/w")
    n = brain.create_node(project_id="acme", type="feature", label="Search", source="Sprint Planning")
    ctx.eq(n["source"], "Sprint Planning", "node stores real provenance source")
    ctx.check(n["updated_at"] is not None, "node has an updated_at on create")
    first = n["updated_at"]
    brain.update_node(n["id"], label="Search v2")
    ctx.check(brain.get_node(n["id"])["updated_at"] >= first, "editing a node bumps updated_at")


def brain_mcp_export(ctx: Ctx):
    c = _client()
    _project(c)
    c.post("/brain/nodes", json={"project_id": "acme", "type": "feature", "label": "Checkout"})
    c.post("/brain/nodes", json={"project_id": "acme", "type": "decision", "label": "Use Stripe"})
    m = c.get("/brain/export", params={"project_id": "acme"}).json()
    ctx.eq(m["node_count"], 2, "MCP export reflects the real node count")
    ctx.eq(m["by_type"], {"feature": 1, "decision": 1}, "MCP export per-type counts are real")
    ctx.check(all(r["uri"].startswith("spade://") for r in m["resources"]), "export resources are MCP URIs")


def brain_gap_analysis(ctx: Ctx):
    c = _client()
    _project(c)
    f = c.post("/brain/nodes", json={"project_id": "acme", "type": "feature", "label": "Lonely"}).json()
    c.post("/brain/nodes", json={"project_id": "acme", "type": "decision", "label": "Proposed?", "status": "proposed"})
    gaps = c.get("/brain/gaps", params={"project_id": "acme"}).json()["gaps"]
    kinds = {g["kind"] for g in gaps}
    ctx.check("orphan" in kinds, "gap analysis flags orphan nodes")
    ctx.check("undecided-feature" in kinds, "gap analysis flags features with no decision")
    ctx.check("unresolved-decision" in kinds, "gap analysis flags unresolved (proposed) decisions")


def gate_conflict_from_brain(ctx: Ctx):
    c = _client()
    _project(c)
    ctx.check(c.get("/gate/conflict", params={"project_id": "acme"}).json()["conflict"] is None,
              "no conflict when there are no decisions")
    c.post("/brain/nodes", json={"project_id": "acme", "type": "decision", "label": "Collaborative filtering", "status": "active"})
    c.post("/brain/nodes", json={"project_id": "acme", "type": "decision", "label": "Content-based", "status": "proposed"})
    conf = c.get("/gate/conflict", params={"project_id": "acme"}).json()["conflict"]
    ctx.check(conf is not None, "a proposed+active pair yields a real gate conflict")
    ctx.eq(conf["existing"]["label"], "Collaborative filtering", "conflict existing = the active decision")
    ctx.eq(conf["proposed"]["label"], "Content-based", "conflict proposed = the proposed decision")


# ─────────────────────────  PLANNING — TASKS  ─────────────────────────

def task_lifecycle(ctx: Ctx):
    c = _client()
    _project(c)
    t = c.post("/tasks", json={"project_id": "acme", "title": "Optimize checkout", "feature": "Checkout", "priority": 1}).json()
    tid = t["id"]
    ctx.check(tid.startswith("SPD-") or bool(tid), "task created with an id")
    ctx.eq(c.patch(f"/tasks/{tid}", json={"priority": 0}).json()["priority"], 0, "PATCH updates task priority")
    mv = c.post(f"/tasks/{tid}/move", json={"status": "in_progress"})
    ctx.eq(mv.json()["status"], "in_progress", "task moves through statuses")
    bad = c.post(f"/tasks/{tid}/move", json={"status": "nonsense"})
    ctx.eq(bad.status_code, 400, "invalid task status rejected (400)")


def task_links_to_brain(ctx: Ctx):
    c = _client()
    _project(c)
    n = c.post("/brain/nodes", json={"project_id": "acme", "type": "feature", "label": "Checkout"}).json()
    t = c.post("/tasks", json={"project_id": "acme", "title": "Work on checkout"}).json()
    c.put(f"/tasks/{t['id']}/nodes", json={"node_ids": [n["id"]]})
    got = c.get(f"/tasks/{t['id']}").json()
    ctx.check(any(x == n["id"] or (isinstance(x, dict) and x.get("id") == n["id"]) for x in got.get("nodes", [])),
              "task is linked to a brain node")


def task_comments_and_links(ctx: Ctx):
    c = _client()
    _project(c)
    a = c.post("/tasks", json={"project_id": "acme", "title": "A"}).json()
    b = c.post("/tasks", json={"project_id": "acme", "title": "B"}).json()
    c.post(f"/tasks/{a['id']}/comments", json={"body": "Investigated root cause", "kind": "note"})
    comments = c.get(f"/tasks/{a['id']}/comments").json()
    ctx.check(len(comments.get("comments", comments)) >= 1, "task comment added + listed")
    lk = c.post(f"/tasks/{a['id']}/links", json={"to_task": b["id"], "rel": "blocks"})
    ctx.check(lk.status_code == 200, "task-to-task link created")


# ───────────────────────  EXECUTION — PIPELINES  ───────────────────────

def pipeline_execution_state_machine(ctx: Ctx):
    """Full execution workflow with a deterministic fake spawn (the HTTP start/
    advance spawn live agents; the state machine itself is pure)."""
    from tui_pilot import pipelines, projects, tasks
    projects.create(id="acme", name="Acme", path="/w")
    tid = tasks.create(project_id="acme", title="Ship feature")["id"]

    run = pipelines.create_run(project_id="acme", task_id=tid)
    ctx.eq(len(run["stages"]), 4, "pipeline run creates 4 ordered stages")
    ctx.eq(pipelines.get(run["id"])["progress"], 0, "fresh run progress = 0%")

    spawned = []
    def fake_spawn(idx, report):
        spawned.append(idx)
        return (f"sess-{idx}", "acct-1")

    rid = run["id"]
    pipelines.start_stage(rid, 0, fake_spawn)
    ctx.eq(pipelines.get(rid)["stages"][0]["state"], "running", "stage 0 starts → running")

    # Advance through all four stages → shipped.
    for idx in range(4):
        pipelines.complete_stage(rid, idx, report=f"stage {idx} done", spawn=fake_spawn)
    final = pipelines.get(rid)
    ctx.eq(final["status"], "shipped", "advancing all stages ships the run")
    ctx.eq(final["progress"], 100, "shipped run progress = 100%")
    ctx.eq(spawned, [0, 1, 2, 3], "each stage spawned a worker in order")


def pipeline_progress_is_derived(ctx: Ctx):
    from tui_pilot import pipelines, projects, tasks
    projects.create(id="acme", name="Acme", path="/w")
    tid = tasks.create(project_id="acme", title="X")["id"]
    rid = pipelines.create_run(project_id="acme", task_id=tid)["id"]
    pipelines._set_stage(rid, 0, state="done")
    pipelines._set_stage(rid, 1, state="running")
    ctx.eq(pipelines.get(rid)["progress"], 38, "progress derived from stage states (1 done + half running)")


# ───────────────────────────  INPUTS DOMAINS  ──────────────────────────

def sprints_with_derived_counts(ctx: Ctx):
    c = _client()
    _project(c)
    c.post("/sprints", json={"project_id": "acme", "number": 25, "day_label": "day 10/10", "state": "done"})
    c.post("/sprints", json={"project_id": "acme", "number": 26, "day_label": "day 2/10"})
    rows = c.get("/sprints", params={"project_id": "acme"}).json()["sprints"]
    ctx.eq([s["number"] for s in rows], [26, 25], "sprints listed newest-number first")
    # Counts come from real pipeline runs.
    from tui_pilot import pipelines, tasks
    tid = tasks.create(project_id="acme", title="X")["id"]
    pipelines.create_run(project_id="acme", task_id=tid)  # queued
    cur = [s for s in c.get("/sprints", params={"project_id": "acme"}).json()["sprints"] if s["number"] == 26][0]
    ctx.eq(cur["queued"], 1, "sprint counts derive from real pipeline runs")


def meetings_ingest(ctx: Ctx):
    c = _client()
    _project(c)
    r = c.post("/meetings", json={"project_id": "acme", "title": "Sprint Planning", "date": "2026-03-25",
                                  "summary": "Prioritised checkout.", "attendees": ["Priya", "Akira"]})
    ctx.eq(r.json()["attendees"], ["Priya", "Akira"], "meeting attendees roundtrip (JSON)")
    rows = c.get("/meetings", params={"project_id": "acme"}).json()["meetings"]
    ctx.eq(len(rows), 1, "meeting listed for the project")


def feedback_clusters(ctx: Ctx):
    c = _client()
    _project(c)
    c.post("/feedback", json={"project_id": "acme", "label": "Checkout slow", "count": 12,
                              "sources": [{"name": "Intercom", "n": 7, "color": "blue"}]})
    rows = c.get("/feedback", params={"project_id": "acme"}).json()["clusters"]
    ctx.eq(rows[0]["label"], "Checkout slow", "feedback cluster created + listed")
    ctx.eq(rows[0]["sources"][0]["n"], 7, "cluster source breakdown roundtrips (JSON)")


def integrations_toggle(ctx: Ctx):
    c = _client()
    _project(c)
    i = c.post("/integrations", json={"project_id": "acme", "name": "GitHub", "category": "Source"}).json()
    ctx.eq(i["connected"], 0, "integration starts disconnected")
    on = c.patch(f"/integrations/{i['id']}", json={"connected": True}).json()
    ctx.eq(on["connected"], 1, "connect toggle persists")
    ctx.eq(on["status"], "connected", "connecting flips status → connected")


def chat_persistence(ctx: Ctx):
    c = _client()
    _project(c)
    t = c.post("/chat/threads", json={"project_id": "acme", "title": "Why is conv down?"}).json()
    c.post(f"/chat/threads/{t['id']}/messages", json={"role": "user", "text": "why?", "who": "R"})
    c.post(f"/chat/threads/{t['id']}/messages", json={"role": "assistant", "text": "signals",
            "payload": {"plan": {"title": "Investigate", "steps": ["a", "b"]}, "cites": ["fb-1"]}})
    msgs = c.get(f"/chat/threads/{t['id']}/messages").json()["messages"]
    ctx.eq(len(msgs), 2, "chat messages persist in a thread")
    ctx.eq(msgs[1]["payload"]["plan"]["steps"], ["a", "b"], "structured tool-output (plan) roundtrips")


# ───────────────────────────────  SYSTEM  ──────────────────────────────

def settings_kv(ctx: Ctx):
    c = _client()
    ctx.check("force_bypass" in c.get("/settings").json(), "GET /settings returns config")
    c.put("/settings", json={"force_bypass": True})
    ctx.eq(c.get("/settings").json()["force_bypass"], True, "PUT /settings persists a flag")


def roles_crud(ctx: Ctx):
    c = _client()
    r = c.post("/roles", json={"id": "qa", "label": "QA", "mode": "normal"})
    ctx.check(r.status_code == 200, "create a custom role")
    ctx.check(any(x["id"] == "qa" for x in c.get("/roles").json()["roles"]), "custom role listed")
    c.patch("/roles/qa", json={"label": "Quality"})
    c.delete("/roles/qa")
    ctx.check(not any(x["id"] == "qa" for x in c.get("/roles").json()["roles"]), "role deleted")


# ─────────────────  ORCHESTRATOR DECISION CORE ("chat")  ────────────────

def _executor(policy=None):
    from tui_pilot.orchestration import OrchestrationExecutor, Policy

    class Spy:
        def __init__(self): self.calls = []; self._state = "IDLE"
        def spawn(self, **kw): self.calls.append(("spawn", kw)); return "newworker-id"
        def answer_worker(self, worker, text): self.calls.append(("answer", worker, text)); return True
        def approve_worker(self, worker): self.calls.append(("approve", worker)); return True
        def deny_worker(self, worker): self.calls.append(("deny", worker)); return True
        def kill(self, worker): self.calls.append(("kill", worker)); return True
        def narrate(self, text): self.calls.append(("narrate", text))
        def worker_state(self, worker): return self._state

    spy = Spy()
    return OrchestrationExecutor(spy, policy or Policy(ceiling="sonnet", autopilot=False)), spy


def orchestrator_plans_and_spawns(ctx: Ctx):
    """The orchestrator's decision core: planning a spawn within the model ceiling
    executes (this is what the 'chat' resolves a 'spawn a developer' intent to)."""
    from tui_pilot.orchestration import parse_orchestration_signal
    ex, spy = _executor()
    r = ex.run(parse_orchestration_signal({"action": "spawn", "role": "developer", "model": "sonnet", "task": "build checkout"}))
    ctx.eq(r.kind, "spawned", "within-ceiling spawn executes (planning → execution)")
    ctx.eq(spy.calls[0][0], "spawn", "executor invokes the spawn callback")
    ctx.eq(spy.calls[0][1]["model"], "sonnet", "the requested model is threaded to spawn")


def orchestrator_gates_costly_spawn(ctx: Ctx):
    from tui_pilot.orchestration import parse_orchestration_signal, Policy
    ex, spy = _executor(Policy(ceiling="sonnet", autopilot=False))
    r = ex.run(parse_orchestration_signal({"action": "spawn", "model": "opus", "task": "hard", "reason": "gnarly"}))
    ctx.eq(r.kind, "brake", "above-ceiling spawn is gated (brake) in supervised mode")
    ctx.eq(spy.calls, [], "a gated spawn does NOT execute until a human allows it")

    ex2, spy2 = _executor(Policy(ceiling="sonnet", autopilot=True))
    r2 = ex2.run(parse_orchestration_signal({"action": "spawn", "model": "opus", "task": "hard"}))
    ctx.eq(r2.kind, "spawned", "autopilot proceeds past the ceiling without a human gate")


def orchestrator_answer_and_kill(ctx: Ctx):
    from tui_pilot.orchestration import parse_orchestration_signal
    ex, spy = _executor()
    ex.run(parse_orchestration_signal({"action": "answer", "worker": "w1", "text": "yes proceed"}))
    ctx.check(any(c[0] == "answer" for c in spy.calls), "orchestrator can answer a worker's prompt")
    ex.run(parse_orchestration_signal({"action": "kill", "worker": "w1"}))
    ctx.check(any(c[0] == "kill" for c in spy.calls), "orchestrator can kill a worker")


# ────────────────────────  END-TO-END SCENARIO  ────────────────────────

def day_in_the_life(ctx: Ctx):
    """One stitched workflow: stand up a project, plan it in the brain, create &
    link a task, run it through the pipeline, and see the sprint reflect it."""
    from tui_pilot import pipelines
    c = _client()
    # 1. Stand up the project + account pool.
    _project(c, name="Acme", path="/tmp/acme", account_strategy="round_robin")
    c.post("/accounts", json={"id": "rm", "label": "rm", "config_dir": "/x"})
    c.put("/projects/acme/accounts", json={"account_ids": ["rm"]})
    ctx.eq(c.get("/projects/acme").json()["pool"], ["rm"], "1. project stood up with an account pool")

    # 2. Plan: a feature + an active decision, linked.
    feat = c.post("/brain/nodes", json={"project_id": "acme", "type": "feature", "label": "Mobile checkout"}).json()
    dec = c.post("/brain/nodes", json={"project_id": "acme", "type": "decision", "label": "Lazy-load images",
                                       "status": "active", "owner": "Akira"}).json()
    c.post("/brain/edges", json={"project_id": "acme", "from_id": feat["id"], "to_id": dec["id"]})
    ctx.eq(len(c.get("/brain/nodes", params={"project_id": "acme"}).json()["nodes"]), 2, "2. planned the feature + decision in the brain")

    # 3. Create the work and link it to the feature.
    task = c.post("/tasks", json={"project_id": "acme", "title": "Optimize mobile checkout", "feature": "Checkout"}).json()
    c.put(f"/tasks/{task['id']}/nodes", json={"node_ids": [feat["id"]]})
    ctx.check(c.get(f"/tasks/{task['id']}").status_code == 200, "3. created a task linked to the feature")

    # 4. Start a sprint, run the task through the pipeline → shipped.
    c.post("/sprints", json={"project_id": "acme", "number": 26, "day_label": "day 1/10"})
    rid = pipelines.create_run(project_id="acme", task_id=task["id"])["id"]
    def fake_spawn(idx, report): return (f"s{idx}", "rm")
    pipelines.start_stage(rid, 0, fake_spawn)
    for idx in range(4):
        pipelines.complete_stage(rid, idx, report="ok", spawn=fake_spawn)
    ctx.eq(pipelines.get(rid)["status"], "shipped", "4. executed the task through the pipeline → shipped")

    # 5. The sprint's derived counts reflect the shipped run.
    cur = [s for s in c.get("/sprints", params={"project_id": "acme"}).json()["sprints"] if s["number"] == 26][0]
    ctx.eq(cur["shipped"], 1, "5. the sprint reflects the shipped pipeline run")

    # 6. The brain stays queryable (export + gaps) after the work.
    ctx.eq(c.get("/brain/export", params={"project_id": "acme"}).json()["node_count"], 2, "6. brain export reflects the final graph")


# ════════════════════════  EXTRA: ERROR / EDGE CASES  ════════════════════════

# --- Projects ---------------------------------------------------------------

def project_404s_and_env(ctx: Ctx):
    c = _client()
    ctx.eq(c.get("/projects/ghost").status_code, 404, "GET unknown project → 404")
    ctx.eq(c.patch("/projects/ghost", json={"autopilot": 1}).status_code, 404, "PATCH unknown project → 404")
    ctx.eq(c.delete("/projects/ghost").status_code, 404, "DELETE unknown project → 404")
    ctx.check("home" in c.get("/env").json(), "GET /env exposes the host home dir")


def project_path_expansion(ctx: Ctx):
    c = _client()
    r = c.post("/projects", json={"id": "x", "name": "X", "path": "~/spade-eval-proj"})
    ctx.check(not r.json()["path"].startswith("~"), "leading ~ in project path is expanded")


# --- Accounts ---------------------------------------------------------------

def account_404s(ctx: Ctx):
    c = _client()
    ctx.eq(c.patch("/accounts/ghost", json={"role": "Dev"}).status_code, 404, "PATCH unknown account → 404")
    ctx.eq(c.delete("/accounts/ghost").status_code, 404, "DELETE unknown account → 404")


def account_auth_status(ctx: Ctx, tmp=None):
    import json
    import tempfile
    from pathlib import Path
    from tui_pilot import accounts
    d = Path(tempfile.mkdtemp())
    ctx.eq(accounts.auth_status(str(d)), "not_logged_in", "empty config dir → not_logged_in")
    (d / ".credentials.json").write_text(json.dumps({"token": "abc"}))
    ctx.eq(accounts.auth_status(str(d)), "authed", "non-empty credentials → authed")


def account_import_and_managed(ctx: Ctx):
    import tempfile
    from pathlib import Path
    from tui_pilot import accounts
    src = Path(tempfile.mkdtemp()) / ".claude-x"; src.mkdir()
    a = accounts.import_existing(id="t2b", label="T2B", config_dir=str(src))
    ctx.eq(a["config_dir"], str(src), "import_existing registers without moving the dir")
    m = accounts.create_managed(id="mng", label="Managed")
    ctx.check(Path(m["config_dir"]).is_dir(), "create_managed makes the account dir")


# --- Brain ------------------------------------------------------------------

def brain_delete_cascades_edges(ctx: Ctx):
    c = _client()
    _project(c)
    f = c.post("/brain/nodes", json={"project_id": "acme", "type": "feature", "label": "F"}).json()
    d = c.post("/brain/nodes", json={"project_id": "acme", "type": "decision", "label": "D"}).json()
    c.post("/brain/edges", json={"project_id": "acme", "from_id": f["id"], "to_id": d["id"]})
    c.delete(f"/brain/nodes/{f['id']}")
    ctx.eq(len(c.get("/brain/edges", params={"project_id": "acme"}).json()["edges"]), 0,
           "deleting a node cascades its edges away")


def brain_export_empty(ctx: Ctx):
    c = _client()
    _project(c)
    m = c.get("/brain/export", params={"project_id": "acme"}).json()
    ctx.eq(m["node_count"], 0, "export of an empty brain → 0 nodes")
    ctx.eq(m["resources"], [], "export of an empty brain → no resources")


def brain_no_gaps_when_connected(ctx: Ctx):
    c = _client()
    _project(c)
    f = c.post("/brain/nodes", json={"project_id": "acme", "type": "feature", "label": "F"}).json()
    d = c.post("/brain/nodes", json={"project_id": "acme", "type": "decision", "label": "D", "status": "active"}).json()
    c.post("/brain/edges", json={"project_id": "acme", "from_id": f["id"], "to_id": d["id"]})
    gaps = c.get("/brain/gaps", params={"project_id": "acme"}).json()["gaps"]
    ids_kinds = {(g["id"], g["kind"]) for g in gaps}
    ctx.check((f["id"], "orphan") not in ids_kinds, "a connected feature is not an orphan")
    ctx.check((f["id"], "undecided-feature") not in ids_kinds, "a feature with a linked decision is not undecided")


def gate_conflict_prefers_linked(ctx: Ctx):
    from tui_pilot import brain, projects
    projects.create(id="acme", name="Acme", path="/w")
    a1 = brain.create_node(project_id="acme", type="decision", label="Unrelated active", status="active")
    a2 = brain.create_node(project_id="acme", type="decision", label="Linked active", status="active")
    prop = brain.create_node(project_id="acme", type="decision", label="Proposal", status="proposed")
    brain.add_edge(project_id="acme", from_id=prop["id"], to_id=a2["id"])
    conf = brain.find_conflict("acme")
    ctx.eq(conf["existing"]["id"], a2["id"], "conflict prefers the active decision linked to the proposal")


# --- Tasks ------------------------------------------------------------------

def task_404s_and_delete(ctx: Ctx):
    c = _client()
    _project(c)
    ctx.eq(c.get("/tasks/SPD-999").status_code, 404, "GET unknown task → 404")
    ctx.eq(c.post("/tasks/SPD-999/move", json={"status": "ready"}).status_code, 404, "move unknown task → 404")
    t = c.post("/tasks", json={"project_id": "acme", "title": "Temp"}).json()
    ctx.eq(c.delete(f"/tasks/{t['id']}").status_code, 200, "DELETE task succeeds")
    ctx.eq(c.get(f"/tasks/{t['id']}").status_code, 404, "deleted task is gone (404)")


def task_all_statuses(ctx: Ctx):
    c = _client()
    _project(c)
    t = c.post("/tasks", json={"project_id": "acme", "title": "Flow"}).json()
    for s in ["ready", "in_progress", "review", "shipped", "blocked"]:
        ctx.eq(c.post(f"/tasks/{t['id']}/move", json={"status": s}).json()["status"], s, f"task moves → {s}")


def task_link_validation(ctx: Ctx):
    c = _client()
    _project(c)
    a = c.post("/tasks", json={"project_id": "acme", "title": "A"}).json()
    b = c.post("/tasks", json={"project_id": "acme", "title": "B"}).json()
    ctx.eq(c.post(f"/tasks/{a['id']}/links", json={"to_task": b['id'], "rel": "bogus"}).status_code, 400,
           "invalid link rel → 400")
    ctx.eq(c.post(f"/tasks/{a['id']}/links", json={"to_task": a['id'], "rel": "blocks"}).status_code, 400,
           "self-link is rejected → 400")


# --- Pipeline ---------------------------------------------------------------

def pipeline_failure_pauses(ctx: Ctx):
    from tui_pilot import pipelines, projects, tasks
    projects.create(id="acme", name="Acme", path="/w")
    tid = tasks.create(project_id="acme", title="X")["id"]
    rid = pipelines.create_run(project_id="acme", task_id=tid)["id"]

    def boom(idx, report):
        raise RuntimeError("spawn failed")

    pipelines.start_stage(rid, 0, boom)  # swallowed → stage failed, run paused
    run = pipelines.get(rid)
    ctx.eq(run["stages"][0]["state"], "failed", "a spawn failure marks the stage failed")
    ctx.eq(run["status"], "paused", "a failed stage pauses the run (needs a human)")


def pipeline_reentry_and_lookup(ctx: Ctx):
    from tui_pilot import pipelines, projects, tasks
    projects.create(id="acme", name="Acme", path="/w")
    t1 = tasks.create(project_id="acme", title="One")["id"]
    t2 = tasks.create(project_id="acme", title="Two")["id"]
    r1 = pipelines.create_run(project_id="acme", task_id=t1)["id"]
    pipelines.create_run(project_id="acme", task_id=t2)
    rows = pipelines.list_for_project("acme")
    ctx.eq(rows[0]["task_id"], t2, "pipeline runs listed newest first")

    def spawn(idx, report): return (f"sess-{idx}", "acct")
    pipelines.start_stage(r1, 0, spawn)
    lk = pipelines.stage_by_session("sess-0")
    ctx.eq(lk["pipeline_run_id"], r1, "a session resolves back to its pipeline stage")
    # Re-entry: completing an already-done stage doesn't double-advance.
    pipelines.complete_stage(r1, 0, report="ok", spawn=spawn)
    before = pipelines.get(r1)["current_stage"]
    pipelines.complete_stage(r1, 0, report="ok", spawn=spawn)
    ctx.eq(pipelines.get(r1)["current_stage"], before, "completing a done stage is idempotent (re-entry safe)")


# --- Inputs -----------------------------------------------------------------

def sprints_current_and_empty(ctx: Ctx):
    from tui_pilot import sprints, projects
    projects.create(id="acme", name="Acme", path="/w")
    ctx.check(sprints.current("acme") is None, "no current sprint when none exist")
    sprints.create(project_id="acme", number=24, state="done")
    sprints.create(project_id="acme", number=25, state="active")
    ctx.eq(sprints.current("acme")["number"], 25, "current = the active sprint with the highest number")


def integrations_disconnect_and_404(ctx: Ctx):
    c = _client()
    _project(c)
    i = c.post("/integrations", json={"project_id": "acme", "name": "Slack", "category": "Comms"}).json()
    c.patch(f"/integrations/{i['id']}", json={"connected": True})
    off = c.patch(f"/integrations/{i['id']}", json={"connected": False}).json()
    ctx.eq(off["status"], "off", "disconnecting flips status back to off")
    ctx.eq(c.patch("/integrations/ghost", json={"connected": True}).status_code, 404, "PATCH unknown integration → 404")


def chat_thread_ordering(ctx: Ctx):
    from tui_pilot import chat, projects
    projects.create(id="acme", name="Acme", path="/w")
    t1 = chat.create_thread("acme", title="first")
    chat.create_thread("acme", title="pinned", pinned=True)
    rows = chat.list_threads("acme")
    ctx.eq(rows[0]["title"], "pinned", "pinned threads sort first")
    # A new message bumps its thread's updated_at so it floats up among recents.
    chat.add_message(t1["id"], role="user", text="hi")
    ctx.check(chat.get_thread(t1["id"])["updated_at"] >= t1["updated_at"], "a new message bumps the thread's updated_at")


# --- System -----------------------------------------------------------------

def roles_404_and_idempotent(ctx: Ctx):
    c = _client()
    ctx.eq(c.patch("/roles/ghost", json={"label": "X"}).status_code, 404, "PATCH unknown role → 404")
    ctx.eq(c.delete("/roles/ghost").status_code, 404, "DELETE unknown role → 404")
    c.post("/roles", json={"id": "qa", "label": "QA"})
    c.post("/roles", json={"id": "qa", "label": "QA v2"})  # upsert same id
    qa = [r for r in c.get("/roles").json()["roles"] if r["id"] == "qa"]
    ctx.eq(len(qa), 1, "upserting the same role id does not duplicate it")


# --- Orchestrator -----------------------------------------------------------

def orchestrator_parse_variants(ctx: Ctx):
    from tui_pilot.orchestration import parse_orchestration_signal
    s1 = parse_orchestration_signal({"action": "spawn", "role": "plain", "cmd": "cat", "task": "x"})
    ctx.eq(s1.cmd, "cat", "a custom cmd is parsed onto the spawn signal")
    s2 = parse_orchestration_signal({"action": "spawn", "role": "developer", "model": "sonnet", "task": "x", "account": "acct-x"})
    ctx.eq(s2.account, "acct-x", "an account pin is parsed onto the spawn signal")
    # Unknown actions are rejected up front (strict validation) rather than acted on.
    raised = False
    try:
        parse_orchestration_signal({"action": "wat"})
    except ValueError:
        raised = True
    ctx.check(raised, "an unknown orchestration action is rejected at parse time")
    s3 = parse_orchestration_signal({"action": "status", "text": "status update"})
    ctx.eq(s3.action, "status", "a status signal parses (orchestrator can post status)")


def mission_autopilot_toggle(ctx: Ctx):
    c = _client()
    _project(c)
    c.put("/current-project", json={"project_id": "acme"})
    r = c.post("/missions/checkout/autopilot", json={"autopilot": True})
    ctx.eq(r.json()["autopilot"], True, "POST mission autopilot returns the new flag")
    found = [m for m in c.get("/missions").json()["missions"] if m["mission"] == "checkout"]
    ctx.check(found and found[0]["autopilot"] is True, "GET /missions reflects the autopilot flag")


def brakes_empty_and_404(ctx: Ctx):
    c = _client()
    ctx.eq(c.get("/brakes").json()["brakes"], [], "no brakes pending on a fresh fleet")
    ctx.eq(c.post("/brakes/ghost/allow").status_code, 404, "allow unknown brake → 404")
    ctx.eq(c.post("/brakes/ghost/skip").status_code, 404, "skip unknown brake → 404")


# --- Cross-cutting ----------------------------------------------------------

def multi_project_isolation(ctx: Ctx):
    c = _client()
    _project(c, pid="a", name="A", path="/tmp/a")
    _project(c, pid="b", name="B", path="/tmp/b")
    c.post("/brain/nodes", json={"project_id": "a", "type": "feature", "label": "A-feat"})
    c.post("/tasks", json={"project_id": "a", "title": "A-task"})
    c.post("/sprints", json={"project_id": "a", "number": 1})
    ctx.eq(len(c.get("/brain/nodes", params={"project_id": "b"}).json()["nodes"]), 0, "brain nodes are scoped per project")
    ctx.eq(len(c.get("/tasks", params={"project_id": "b"}).json()["tasks"]), 0, "tasks are scoped per project")
    ctx.eq(len(c.get("/sprints", params={"project_id": "b"}).json()["sprints"]), 0, "sprints are scoped per project")
    ctx.eq(len(c.get("/brain/nodes", params={"project_id": "a"}).json()["nodes"]), 1, "project A still sees its own data")


def planning_gap_to_resolution(ctx: Ctx):
    """A real planning loop: an orphan feature is flagged as a gap, then recording
    + linking a decision clears it."""
    c = _client()
    _project(c)
    f = c.post("/brain/nodes", json={"project_id": "acme", "type": "feature", "label": "Checkout"}).json()
    g1 = c.get("/brain/gaps", params={"project_id": "acme"}).json()["gaps"]
    ctx.check(any(x["id"] == f["id"] and x["kind"] == "undecided-feature" for x in g1),
              "an undecided feature is surfaced as a gap")
    d = c.post("/brain/nodes", json={"project_id": "acme", "type": "decision", "label": "Lazy-load", "status": "active"}).json()
    c.post("/brain/edges", json={"project_id": "acme", "from_id": f["id"], "to_id": d["id"]})
    g2 = c.get("/brain/gaps", params={"project_id": "acme"}).json()["gaps"]
    ctx.check(not any(x["id"] == f["id"] and x["kind"] == "undecided-feature" for x in g2),
              "recording + linking a decision clears the gap")


ALL = [
    ("Projects", "create → get info → update → current → delete", project_lifecycle),
    ("Projects", "404s on unknown project + env", project_404s_and_env),
    ("Projects", "project path ~ expansion", project_path_expansion),
    ("Accounts", "create/patch/default + project pool", accounts_and_pool),
    ("Accounts", "round-robin dispatch cycles the pool", round_robin_dispatch),
    ("Accounts", "404s on unknown account", account_404s),
    ("Accounts", "auth status (content-aware)", account_auth_status),
    ("Accounts", "import existing + managed dir", account_import_and_managed),
    ("Planning · Brain", "all 6 node types + invalid rejected", brain_all_node_types),
    ("Planning · Brain", "edges + relations", brain_edges_and_relations),
    ("Planning · Brain", "decision lifecycle proposed→active", decision_status_workflow),
    ("Planning · Brain", "node provenance (source + updated_at bump)", node_provenance),
    ("Planning · Brain", "MCP export reflects the real graph", brain_mcp_export),
    ("Planning · Brain", "MCP export of an empty brain", brain_export_empty),
    ("Planning · Brain", "gap analysis (orphan/undecided/unresolved)", brain_gap_analysis),
    ("Planning · Brain", "no gaps when fully connected", brain_no_gaps_when_connected),
    ("Planning · Brain", "gate conflict derived from decisions", gate_conflict_from_brain),
    ("Planning · Brain", "conflict prefers the linked active decision", gate_conflict_prefers_linked),
    ("Planning · Brain", "node delete cascades its edges", brain_delete_cascades_edges),
    ("Planning · Tasks", "task lifecycle (create/patch/move)", task_lifecycle),
    ("Planning · Tasks", "task linked to brain nodes", task_links_to_brain),
    ("Planning · Tasks", "task comments + task-to-task links", task_comments_and_links),
    ("Planning · Tasks", "404s + delete", task_404s_and_delete),
    ("Planning · Tasks", "moves through every status", task_all_statuses),
    ("Planning · Tasks", "link validation (rel + self-link)", task_link_validation),
    ("Execution · Pipeline", "full stage machine create→start→ship", pipeline_execution_state_machine),
    ("Execution · Pipeline", "progress derived from stage states", pipeline_progress_is_derived),
    ("Execution · Pipeline", "spawn failure pauses the run", pipeline_failure_pauses),
    ("Execution · Pipeline", "re-entry safe + session lookup", pipeline_reentry_and_lookup),
    ("Inputs", "sprints with counts derived from runs", sprints_with_derived_counts),
    ("Inputs", "current sprint + empty", sprints_current_and_empty),
    ("Inputs", "meetings ingest", meetings_ingest),
    ("Inputs", "feedback clusters", feedback_clusters),
    ("Inputs", "integrations connect toggle", integrations_toggle),
    ("Inputs", "integrations disconnect + 404", integrations_disconnect_and_404),
    ("Inputs", "chat thread + message persistence", chat_persistence),
    ("Inputs", "chat thread ordering + bump", chat_thread_ordering),
    ("System", "settings key/value", settings_kv),
    ("System", "roles CRUD", roles_crud),
    ("System", "roles 404 + idempotent upsert", roles_404_and_idempotent),
    ("Orchestrator · chat", "plans & spawns within ceiling", orchestrator_plans_and_spawns),
    ("Orchestrator · chat", "gates costly spawns (human-in-loop)", orchestrator_gates_costly_spawn),
    ("Orchestrator · chat", "answer + kill a worker", orchestrator_answer_and_kill),
    ("Orchestrator · chat", "signal parsing + safe no-op", orchestrator_parse_variants),
    ("Orchestrator · chat", "mission autopilot toggle", mission_autopilot_toggle),
    ("Orchestrator · chat", "no brakes pending + 404s", brakes_empty_and_404),
    ("End-to-end", "day in the life (plan → execute → sprint)", day_in_the_life),
    ("End-to-end", "multi-project data isolation", multi_project_isolation),
    ("End-to-end", "planning gap → resolution loop", planning_gap_to_resolution),
]
