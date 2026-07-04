"""Chunk 7.1: end-to-end per-kind integration.

Drives a research run and a docs run all the way from ``ready`` to ``delivered``
with FAKE agents (a recording spawn + FakeGit; deep-research/tmux never run), then
asserts the JOURNEY through the real HTTP surface — the run serialization
(``fanout_count``), the artifacts list, the project gate board, and the shareable
``/doc/{id}`` route. This ties Chunks 4–6 together on top of the wired endpoints.
"""

import json

from fastapi.testclient import TestClient

from tui_pilot import artifacts, lifecycle, projects, tasks


class Rec:
    """Recording spawn: threads fanout_idx via the run dict like _lifecycle_spawn."""

    def __init__(self):
        self.calls = []

    def __call__(self, run, phase):
        idx = run.get("fanout_idx")
        self.calls.append((phase, idx))
        sid = f"sess-{phase}" + (f"-{idx}" if idx is not None else "")
        return (sid, "acct")

    def count(self, phase):
        return sum(1 for p, _ in self.calls if p == phase)


class FakeGit:
    def prepare_workspace(self, cfg, task_id, slug, kind="feat"):
        return {}


def test_research_ready_to_delivered_end_to_end():
    from tui_pilot.server import app

    projects.create(id="acme", name="Acme", path="/w")
    tid = tasks.create(project_id="acme", title="Research auth options")["id"]
    tasks.set_kind(tid, "research")
    c = TestClient(app)
    rec = Rec()

    # start → scoping, no workspace cloned
    run = lifecycle.start_run("acme", tid, spawn=rec, git=FakeGit())
    rid = run["id"]
    assert c.get(f"/lifecycle/{rid}").json()["phase"] == "scoping"

    # scoping proposes 3 angles → scope gate opens (visible on the gate board)
    angles = [
        {"brief": "existing auth code", "mode": "repo"},
        {"brief": "OAuth best practices", "mode": "web"},
        {"brief": "session storage tradeoffs", "mode": "web"},
    ]
    lifecycle.advance(rid, phase="scoping",
                      report=json.dumps({"angles": angles, "summary": "3 angles"}),
                      spawn=rec, git=FakeGit())
    board = c.get("/projects/acme/gates").json()["gates"]
    assert any(g["gate"] == "scope" and g["task_id"] == tid for g in board)

    # scope approve → fan out one investigator per angle; run reports fanout_count
    lifecycle.decide_gate(rid, "scope", "approved", spawn=rec, git=FakeGit())
    assert c.get(f"/lifecycle/{rid}").json()["phase"] == "investigating"
    assert c.get(f"/lifecycle/{rid}").json()["fanout_count"] == 3

    # each investigator finishes → 3 finding artifacts, barrier releases to synthesis
    for i, brief in enumerate(["A", "B", "C"]):
        lifecycle.advance_fanout(rid, "investigating", i,
                                 report=json.dumps({"summary": brief}),
                                 spawn=rec, git=FakeGit())
    assert c.get(f"/lifecycle/{rid}").json()["phase"] == "synthesis"
    arts = c.get(f"/tasks/{tid}/artifacts").json()["artifacts"]
    assert sum(1 for a in arts if a["kind"] == "finding") == 3
    assert any(a["kind"] == "plan" for a in arts)

    # synthesis finishes with report + followups → review gate
    synth = {
        "report": "# Auth research\nUse PKCE.",
        "followups": [{"title": "Adopt PKCE"}, {"title": "Audit token storage"}],
        "brain_nodes": [{"type": "decision", "label": "Use PKCE"}],
    }
    tasks_before = len(tasks.list_for_project("acme"))
    lifecycle.advance(rid, phase="synthesis", report=json.dumps(synth),
                      spawn=rec, git=FakeGit())
    board = c.get("/projects/acme/gates").json()["gates"]
    assert any(g["gate"] == "review" and g["task_id"] == tid for g in board)
    reports = [a for a in c.get(f"/tasks/{tid}/artifacts").json()["artifacts"]
               if a["kind"] == "report"]
    assert len(reports) == 1
    # report content is readable inline via the content endpoint (no git read)
    rc = c.get(f"/tasks/{tid}/artifacts/{reports[0]['id']}/content")
    assert rc.status_code == 200 and "Use PKCE" in rc.json()["content"]

    # review approve → delivered (terminal), followups created
    lifecycle.decide_gate(rid, "review", "approved", spawn=rec, git=FakeGit())
    got = c.get(f"/lifecycle/{rid}").json()
    assert got["phase"] == "delivered" and got["active"] == 0
    assert c.get(f"/tasks/{tid}").json()["status"] == "delivered"
    assert len(tasks.list_for_project("acme")) == tasks_before + 2


def test_docs_ready_to_delivered_end_to_end():
    from tui_pilot.server import app

    projects.create(id="acme", name="Acme", path="/w")
    tid = tasks.create(project_id="acme", title="Write the client SOW")["id"]
    tasks.set_kind(tid, "docs", doc_template="sow")
    c = TestClient(app)
    rec = Rec()

    # start → outline, no workspace
    run = lifecycle.start_run("acme", tid, spawn=rec, git=FakeGit())
    rid = run["id"]
    assert c.get(f"/lifecycle/{rid}").json()["phase"] == "outline"

    # outline finish → outline gate
    lifecycle.advance(rid, phase="outline",
                      report=json.dumps({"outline": "1. Scope\n2. Deliverables"}),
                      spawn=rec, git=FakeGit())
    board = c.get("/projects/acme/gates").json()["gates"]
    assert any(g["gate"] == "outline" and g["task_id"] == tid for g in board)

    # approve outline → drafting
    lifecycle.decide_gate(rid, "outline", "approved", spawn=rec, git=FakeGit())
    assert c.get(f"/lifecycle/{rid}").json()["phase"] == "drafting"

    # drafting finish → body-only doc artifact + review gate
    body = ("<section><h2>Scope</h2><p>The work.</p></section>"
            "<section><h2>Deliverables</h2><p>The docs.</p></section>")
    lifecycle.advance(rid, phase="drafting",
                      report=json.dumps({"doc_html": body}),
                      spawn=rec, git=FakeGit())
    docs = [a for a in c.get(f"/tasks/{tid}/artifacts").json()["artifacts"]
            if a["kind"] == "doc"]
    assert len(docs) == 1
    doc_id = docs[0]["id"]

    # approve review → delivered
    lifecycle.decide_gate(rid, "review", "approved", spawn=rec, git=FakeGit())
    got = c.get(f"/lifecycle/{rid}").json()
    assert got["phase"] == "delivered" and got["active"] == 0
    assert c.get(f"/tasks/{tid}").json()["status"] == "delivered"

    # the shareable /doc/{id} route renders the doc wrapped once in the shell
    r = c.get(f"/doc/{doc_id}")
    assert r.status_code == 200
    assert "text/html" in r.headers["content-type"]
    html = r.text
    assert "<h2>Scope</h2>" in html
    assert html.lower().count("<!doctype html>") == 1
