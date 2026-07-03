"""Chunk 5: the docs lifecycle (outline → outline gate → drafting → review gate
→ delivered).

Driven entirely by FAKE agents (a recording spawn + FakeGit) — docs never clone
a repo (needs_workspace=False) and produce INLINE artifacts (outline + doc body),
never a repo pointer. The `doc` artifact stores BODY sections only; the shared
`render_shell` wraps it once at the `/doc/{id}` render step (Task 5.2), so the
stored content must never contain a full-document shell.
"""

import json

from tui_pilot import (
    artifacts, doc_templates, gates, lifecycle, lifecycle_templates as LT,
    projects, tasks,
)


class Rec:
    """Recording spawn: returns a deterministic session per phase."""
    def __init__(self):
        self.calls = []

    def __call__(self, run, phase):
        self.calls.append(phase)
        return (f"sess-{phase}", "acct")

    def count(self, phase):
        return sum(1 for p in self.calls if p == phase)


class FakeGit:
    """Injected git facade; docs never clone, so this is barely exercised."""
    def prepare_workspace(self, cfg, task_id, slug, kind="feat"):
        return {}


def _docs_task(doc_template="sow"):
    projects.create(id="acme", name="Acme", path="/w")
    tid = tasks.create(project_id="acme", title="Write the client SOW")["id"]
    tasks.set_kind(tid, "docs", doc_template=doc_template)
    return tid


def _start(rec, doc_template="sow"):
    tid = _docs_task(doc_template)
    return lifecycle.start_run("acme", tid, spawn=rec, git=FakeGit())


# -- template registration ----------------------------------------------------

def test_docs_template_shape():
    t = LT.template_for("docs")
    assert [p["name"] for p in t["phases"]] == ["outline", "drafting", "delivered"]
    assert LT.first_phase("docs") == "outline"
    assert LT.needs_workspace("docs") is False
    assert LT.terminal_status("docs") == "delivered"
    assert LT.gate_for_phase("docs", "outline") == "outline"
    assert LT.gate_for_phase("docs", "drafting") == "review"
    assert LT.fanout_phases("docs") == set()
    assert LT.column_for("docs", "outline") == "Planning"
    assert LT.column_for("docs", "drafting") == "Review"
    assert LT.column_for("docs", "delivered") == "Done"
    ga = LT.gate_advances("docs")
    assert ga["outline"]["approve_next"] == "drafting"
    assert ga["outline"]["changes_target"] == "outline"
    assert ga["review"]["approve_next"] == "delivered"
    assert ga["review"]["changes_target"] == "drafting"


def test_docs_entry_edge_is_a_transition_pair():
    assert ("ready", "outline") in LT.transition_pairs()


def test_doc_templates_registry_has_required_sections():
    assert set(doc_templates.TEMPLATES) == {"sow", "explainer"}
    for spec in doc_templates.TEMPLATES.values():
        assert spec["sections"]                # non-empty required section list


# -- Task 5.1: start (no workspace) + outline → outline gate ------------------

def test_start_docs_enters_outline_without_workspace():
    rec = Rec()
    run = _start(rec)
    assert run["phase"] == "outline"
    assert run["worktree_path"] is None
    assert tasks.get(run["task_id"])["status"] == "outline"
    assert rec.count("outline") == 1


def test_outline_finish_registers_outline_and_opens_gate():
    rec = Rec()
    run = _start(rec)
    tid = run["task_id"]
    lifecycle.advance(run["id"], phase="outline",
                      report=json.dumps({"outline": "1. Scope\n2. Deliverables"}),
                      spawn=rec, git=FakeGit())
    # run stays at outline while the outline gate waits
    assert lifecycle.get(run["id"])["phase"] == "outline"
    assert tasks.get(tid)["status"] == "outline"
    g = gates.gate_for(run["id"], "outline")
    assert g is not None and g["status"] == "waiting"
    outlines = [a for a in artifacts.for_task(tid) if a["kind"] == "outline"]
    assert len(outlines) == 1
    assert outlines[0]["repo_path"] is None            # inline content
    assert "Deliverables" in outlines[0]["content"]


def test_outline_bad_json_blocks():
    rec = Rec()
    run = _start(rec)
    lifecycle.advance(run["id"], phase="outline", report="not json",
                      spawn=rec, git=FakeGit())
    assert lifecycle.get(run["id"])["phase"] == "blocked"
    assert tasks.get(run["task_id"])["status"] == "blocked"


# -- outline gate decisions ---------------------------------------------------

def _to_outline_gate(rec):
    run = _start(rec)
    lifecycle.advance(run["id"], phase="outline",
                      report=json.dumps({"outline": "1. Scope\n2. Deliverables"}),
                      spawn=rec, git=FakeGit())
    return run


def test_outline_approve_advances_to_drafting():
    rec = Rec()
    run = _to_outline_gate(rec)
    lifecycle.decide_gate(run["id"], "outline", "approved", spawn=rec, git=FakeGit())
    assert lifecycle.get(run["id"])["phase"] == "drafting"
    assert tasks.get(run["task_id"])["status"] == "drafting"
    assert rec.count("drafting") == 1
    assert gates.gate_for(run["id"], "outline")["status"] == "approved"


def test_outline_changes_requested_reworks_outline():
    rec = Rec()
    run = _to_outline_gate(rec)
    lifecycle.decide_gate(run["id"], "outline", "changes_requested",
                          comment="add pricing", spawn=rec, git=FakeGit())
    assert lifecycle.get(run["id"])["phase"] == "outline"
    assert rec.count("outline") == 2               # outline re-spawned
    assert rec.count("drafting") == 0


# -- Task 5.1: drafting → review gate → delivered -----------------------------

_DOC_BODY = ("<section><h2>Scope</h2><p>The work.</p></section>"
             "<section><h2>Deliverables</h2><p>The docs.</p></section>")


def _to_review_gate(rec):
    run = _to_outline_gate(rec)
    lifecycle.decide_gate(run["id"], "outline", "approved", spawn=rec, git=FakeGit())
    lifecycle.advance(run["id"], phase="drafting",
                      report=json.dumps({"doc_html": _DOC_BODY}),
                      spawn=rec, git=FakeGit())
    return run


def test_drafting_finish_registers_doc_body_only_and_opens_review():
    rec = Rec()
    run = _to_review_gate(rec)
    tid = run["task_id"]
    assert lifecycle.get(run["id"])["phase"] == "drafting"    # waits at drafting
    docs = [a for a in artifacts.for_task(tid) if a["kind"] == "doc"]
    assert len(docs) == 1
    body = docs[0]["content"]
    assert docs[0]["repo_path"] is None                       # inline content
    assert "<h2>Scope</h2>" in body
    # BODY/sections ONLY — no full-document shell baked into the stored content
    assert "<!doctype" not in body.lower()
    assert "<html" not in body.lower()
    assert "<head" not in body.lower()
    g = gates.gate_for(run["id"], "review")
    assert g is not None and g["status"] == "waiting"


def test_drafting_bad_json_blocks():
    rec = Rec()
    run = _to_outline_gate(rec)
    lifecycle.decide_gate(run["id"], "outline", "approved", spawn=rec, git=FakeGit())
    lifecycle.advance(run["id"], phase="drafting", report="not json",
                      spawn=rec, git=FakeGit())
    assert lifecycle.get(run["id"])["phase"] == "blocked"


def test_review_approve_delivers():
    rec = Rec()
    run = _to_review_gate(rec)
    rid = run["id"]
    tid = run["task_id"]
    lifecycle.decide_gate(rid, "review", "approved", spawn=rec, git=FakeGit())
    r = lifecycle.get(rid)
    assert r["phase"] == "delivered" and r["active"] == 0
    assert tasks.get(tid)["status"] == "delivered"
    # doc artifact survives, still body-only
    docs = [a for a in artifacts.for_task(tid) if a["kind"] == "doc"]
    assert len(docs) == 1 and "<!doctype" not in docs[0]["content"].lower()


def test_review_changes_requested_reworks_drafting():
    rec = Rec()
    run = _to_review_gate(rec)
    rid = run["id"]
    before = rec.count("drafting")
    lifecycle.decide_gate(rid, "review", "changes_requested",
                          comment="fix tone", spawn=rec, git=FakeGit())
    assert lifecycle.get(rid)["phase"] == "drafting"
    assert rec.count("drafting") == before + 1
    assert lifecycle.get(rid)["active"] == 1


# -- prompts ------------------------------------------------------------------

def test_drafting_prompt_embeds_sections_and_svg_and_body_only():
    from tui_pilot import spade_server
    rec = Rec()
    run = _to_outline_gate(rec)
    lifecycle.decide_gate(run["id"], "outline", "approved", spawn=rec, git=FakeGit())
    prompt = spade_server._phase_prompt(lifecycle.get(run["id"]), "drafting")
    # embeds the chosen sow template's required sections
    for section in doc_templates.TEMPLATES["sow"]["sections"]:
        assert section in prompt
    # instructs pre-rendered inline SVG for mermaid + body-only output
    assert "svg" in prompt.lower()
    assert "mermaid" in prompt.lower()
    assert "body" in prompt.lower()


def test_outline_prompt_mentions_outline():
    from tui_pilot import spade_server
    rec = Rec()
    run = _start(rec)
    prompt = spade_server._phase_prompt(lifecycle.get(run["id"]), "outline")
    assert "outline" in prompt.lower()
