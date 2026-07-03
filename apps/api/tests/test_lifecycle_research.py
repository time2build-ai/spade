"""Chunk 4: the research lifecycle (scoping → scope gate → investigating fan-out
→ synthesis → review gate → delivered).

Driven entirely by FAKE agents (a recording spawn + FakeGit) — no real tmux,
deep-research, or GitHub. The recording spawn threads ``fanout_idx`` via the run
dict exactly like the real ``_lifecycle_spawn`` closure so the fan-out primitive
behaves identically.
"""

import json

from tui_pilot import (
    artifacts, brain, gates, lifecycle, lifecycle_templates as LT, projects,
    tasks,
)


class Rec:
    """Recording spawn: threads fanout_idx via the run dict, returns a session."""
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
    """Injected git facade; research never clones, so this is barely exercised."""
    def prepare_workspace(self, cfg, task_id, slug, kind="feat"):
        return {}


def _research_task():
    projects.create(id="acme", name="Acme", path="/w")
    tid = tasks.create(project_id="acme", title="Research auth options")["id"]
    tasks.set_kind(tid, "research")
    return tid


def _start(rec):
    tid = _research_task()
    run = lifecycle.start_run("acme", tid, spawn=rec, git=FakeGit())
    return run


# -- template registration ----------------------------------------------------

def test_research_template_shape():
    t = LT.template_for("research")
    assert [p["name"] for p in t["phases"]] == \
        ["scoping", "investigating", "synthesis", "delivered"]
    assert LT.first_phase("research") == "scoping"
    assert LT.needs_workspace("research") is False
    assert LT.terminal_status("research") == "delivered"
    assert LT.gate_for_phase("research", "scoping") == "scope"
    assert LT.gate_for_phase("research", "synthesis") == "review"
    assert LT.fanout_phases("research") == {"investigating"}
    assert LT.column_for("research", "scoping") == "Planning"
    assert LT.column_for("research", "investigating") == "In progress"
    assert LT.column_for("research", "synthesis") == "Review"
    assert LT.column_for("research", "delivered") == "Done"
    ga = LT.gate_advances("research")
    assert ga["scope"]["approve_next"] == "investigating"
    assert ga["scope"]["changes_target"] == "scoping"
    assert ga["review"]["approve_next"] == "delivered"
    assert ga["review"]["changes_target"] == "synthesis"


def test_research_entry_edge_is_a_transition_pair():
    assert ("ready", "scoping") in LT.transition_pairs()


# -- Task 4.1: start (no workspace) + scoping → scope gate --------------------

def test_start_research_enters_scoping_without_workspace():
    rec = Rec()
    run = _start(rec)
    assert run["phase"] == "scoping"
    assert run["worktree_path"] is None
    assert tasks.get(run["task_id"])["status"] == "scoping"
    assert rec.count("scoping") == 1


def test_research_spawn_does_not_crash_on_null_worktree_path():
    """A research run has a null worktree_path; _lifecycle_spawn passes it through
    as cwd=None, and server._spawn_agent falls back to a per-agent scratch dir."""
    from tui_pilot import server, spade_server
    projects.create(id="acme", name="Acme", path="/w")
    tid = tasks.create(project_id="acme", title="R")["id"]

    def fake_spawn_agent(**kw):
        assert kw["cwd"] is None      # research runs pass a null cwd through
        server._meta["sp1"] = {"id": "sp1"}
        return {"id": "sp1", "account_id": "acct"}

    import pytest
    monkey = pytest.MonkeyPatch()
    monkey.setattr(server, "_spawn_agent", fake_spawn_agent)
    try:
        run = {"id": "r1", "project_id": "acme", "task_id": tid, "kind": "research",
               "worktree_path": None}
        spawn = spade_server._lifecycle_spawn(None)
        sid, acct = spawn(run, "scoping")     # must not raise on null cwd
        assert sid == "sp1"
    finally:
        server._meta.pop("sp1", None)
        monkey.undo()


def test_scoping_finish_registers_plan_and_opens_scope_gate():
    rec = Rec()
    run = _start(rec)
    tid = run["task_id"]
    lifecycle.advance(
        run["id"], phase="scoping",
        report=json.dumps({"angles": [
            {"brief": "existing auth code", "mode": "repo"},
            {"brief": "OAuth best practices", "mode": "web"},
        ], "summary": "two angles"}),
        spawn=rec, git=FakeGit(),
    )
    # run stays at scoping while the scope gate waits
    assert lifecycle.get(run["id"])["phase"] == "scoping"
    assert tasks.get(tid)["status"] == "scoping"
    g = gates.gate_for(run["id"], "scope")
    assert g is not None and g["status"] == "waiting"
    plans = [a for a in artifacts.for_task(tid) if a["kind"] == "plan"]
    assert len(plans) == 1
    assert plans[0]["repo_path"] is None      # inline content, not a repo pointer
    assert "OAuth best practices" in plans[0]["content"]


def test_scoping_bad_json_blocks():
    rec = Rec()
    run = _start(rec)
    lifecycle.advance(run["id"], phase="scoping", report="not json",
                      spawn=rec, git=FakeGit())
    assert lifecycle.get(run["id"])["phase"] == "blocked"
    assert tasks.get(run["task_id"])["status"] == "blocked"


def test_scoping_zero_angles_blocks_recoverably():
    """A scoping finish with no angles must BLOCK (not stall): an empty fan-out
    would never release the barrier (0 rows → all_done False forever) and there is
    no retry/drop target, so the run would be stuck at investigating active=1. The
    run must instead go to blocked and be recoverable via retry()."""
    rec = Rec()
    run = _start(rec)
    rid = run["id"]
    lifecycle.advance(rid, phase="scoping",
                      report=json.dumps({"angles": [], "summary": "found nothing"}),
                      spawn=rec, git=FakeGit())
    assert lifecycle.get(rid)["phase"] == "blocked"       # not stuck at investigating
    assert tasks.get(run["task_id"])["status"] == "blocked"
    assert gates.gate_for(rid, "scope") is None           # scope gate never opened
    assert rec.count("investigating") == 0                # no fan-out spawned
    # recoverable: retry() re-runs scoping
    lifecycle.retry(rid, spawn=rec, git=FakeGit())
    assert lifecycle.get(rid)["phase"] == "scoping"
    assert rec.count("scoping") == 2                       # scoping re-spawned


# -- Task 4.2: fan-out → synthesis → deliver ----------------------------------

_ANGLES = [
    {"brief": "existing auth code", "mode": "repo"},
    {"brief": "OAuth best practices", "mode": "web"},
]


def _scope(rec):
    """Drive a research run to a waiting scope gate."""
    run = _start(rec)
    lifecycle.advance(
        run["id"], phase="scoping",
        report=json.dumps({"angles": _ANGLES, "summary": "two angles"}),
        spawn=rec, git=FakeGit(),
    )
    return run


def test_scope_approve_fans_out_one_agent_per_angle():
    rec = Rec()
    run = _scope(rec)
    lifecycle.decide_gate(run["id"], "scope", "approved", spawn=rec, git=FakeGit())
    assert lifecycle.get(run["id"])["phase"] == "investigating"
    assert tasks.get(run["task_id"])["status"] == "investigating"
    assert rec.count("investigating") == 2      # one per angle
    # the scope gate was consumed
    assert gates.gate_for(run["id"], "scope")["status"] == "approved"


def test_scope_changes_requested_reworks_scoping():
    rec = Rec()
    run = _scope(rec)
    lifecycle.decide_gate(run["id"], "scope", "changes_requested",
                          comment="narrow it", spawn=rec, git=FakeGit())
    assert lifecycle.get(run["id"])["phase"] == "scoping"
    assert rec.count("scoping") == 2            # scoping re-spawned
    assert rec.count("investigating") == 0      # no fan-out yet


def test_all_findings_release_barrier_and_spawn_synthesis():
    rec = Rec()
    run = _scope(rec)
    rid = run["id"]
    lifecycle.decide_gate(rid, "scope", "approved", spawn=rec, git=FakeGit())
    lifecycle.advance_fanout(rid, "investigating", 0,
                             report='{"summary": "found login.py"}',
                             spawn=rec, git=FakeGit())
    assert lifecycle.get(rid)["phase"] == "investigating"      # barrier held
    lifecycle.advance_fanout(rid, "investigating", 1,
                             report='{"summary": "PKCE recommended"}',
                             spawn=rec, git=FakeGit())
    assert lifecycle.get(rid)["phase"] == "synthesis"          # released
    assert rec.count("synthesis") == 1
    findings = [a for a in artifacts.for_task(run["task_id"]) if a["kind"] == "finding"]
    assert len(findings) == 2


def test_synthesis_prompt_embeds_finding_content():
    """The synthesis manager's prompt must EMBED the inline finding content, not
    just list `@ None` metadata."""
    from tui_pilot import spade_server
    rec = Rec()
    run = _scope(rec)
    rid = run["id"]
    lifecycle.decide_gate(rid, "scope", "approved", spawn=rec, git=FakeGit())
    lifecycle.advance_fanout(rid, "investigating", 0,
                             report="FINDING-ALPHA repo evidence",
                             spawn=rec, git=FakeGit())
    lifecycle.advance_fanout(rid, "investigating", 1,
                             report="FINDING-BETA web evidence",
                             spawn=rec, git=FakeGit())
    prompt = spade_server._phase_prompt(lifecycle.get(rid), "synthesis")
    assert "FINDING-ALPHA repo evidence" in prompt
    assert "FINDING-BETA web evidence" in prompt
    assert "@ None" not in prompt and "@ ?" not in prompt


def test_embedded_content_is_capped_and_backtick_safe():
    """Embedded inline content must be size-capped and use a delimiter that agent
    content containing a ``` fence can't break out of."""
    from tui_pilot import spade_server
    fenced = "```python\nprint('x')\n```  end"
    block = spade_server._embed_block(fenced)
    assert fenced in block                       # content preserved verbatim
    assert block.startswith("<<<CONTENT") and block.rstrip().endswith("CONTENT>>>")
    big = spade_server._embed_block("a" * (spade_server._EMBED_MAX_CHARS + 500))
    assert "…[truncated]" in big
    assert len(big) < spade_server._EMBED_MAX_CHARS + 200


def test_fanout_prompt_is_angle_aware():
    from tui_pilot import spade_server
    rec = Rec()
    run = _scope(rec)
    rid = run["id"]
    lifecycle.decide_gate(rid, "scope", "approved", spawn=rec, git=FakeGit())
    p0 = spade_server._fanout_prompt(lifecycle.get(rid), "investigating", 0)
    p1 = spade_server._fanout_prompt(lifecycle.get(rid), "investigating", 1)
    # angle 0 is repo mode; angle 1 is web mode
    assert "existing auth code" in p0 and "grep" in p0.lower()
    assert "OAuth best practices" in p1 and "deep-research" in p1
    # _spawn_prompt routes a fan-out phase through _fanout_prompt
    run_idx = dict(lifecycle.get(rid)); run_idx["fanout_idx"] = 1
    assert spade_server._spawn_prompt(run_idx, "investigating") == p1


def _to_synthesis(rec):
    run = _scope(rec)
    rid = run["id"]
    lifecycle.decide_gate(rid, "scope", "approved", spawn=rec, git=FakeGit())
    lifecycle.advance_fanout(rid, "investigating", 0, report='{"summary":"a"}',
                             spawn=rec, git=FakeGit())
    lifecycle.advance_fanout(rid, "investigating", 1, report='{"summary":"b"}',
                             spawn=rec, git=FakeGit())
    return run


_SYNTH_REPORT = {
    "report": "# Auth research\nUse PKCE.",
    "followups": [
        {"title": "Adopt PKCE", "description": "Migrate to PKCE flow"},
        {"title": "Audit token storage"},
    ],
    "brain_nodes": [
        {"type": "decision", "label": "Use PKCE", "detail": "chosen flow"},
        {"type": "convention", "label": "Token TTL 15m"},
        {"type": "nonsense", "label": "should be skipped"},   # invalid type
    ],
}


def test_synthesis_finish_registers_report_and_opens_review():
    rec = Rec()
    run = _to_synthesis(rec)
    rid = run["id"]
    lifecycle.advance(rid, phase="synthesis", report=json.dumps(_SYNTH_REPORT),
                      spawn=rec, git=FakeGit())
    assert lifecycle.get(rid)["phase"] == "synthesis"          # waits at synthesis
    reports = [a for a in artifacts.for_task(run["task_id"]) if a["kind"] == "report"]
    assert len(reports) == 1
    assert "Use PKCE" in reports[0]["content"]
    assert reports[0]["repo_path"] is None
    # full parsed synthesis JSON is persisted for the deliver step
    assert json.loads(lifecycle.get(rid)["synthesis_json"])["followups"][0]["title"] \
        == "Adopt PKCE"
    g = gates.gate_for(rid, "review")
    assert g is not None and g["status"] == "waiting"


def test_review_approve_delivers_with_followups_and_brain_nodes():
    rec = Rec()
    run = _to_synthesis(rec)
    rid = run["id"]
    tid = run["task_id"]
    lifecycle.advance(rid, phase="synthesis", report=json.dumps(_SYNTH_REPORT),
                      spawn=rec, git=FakeGit())
    tasks_before = len(tasks.list_for_project("acme"))
    lifecycle.decide_gate(rid, "review", "approved", spawn=rec, git=FakeGit())
    # terminal delivered, run deactivated
    r = lifecycle.get(rid)
    assert r["phase"] == "delivered" and r["active"] == 0
    assert tasks.get(tid)["status"] == "delivered"
    # both followups created
    assert len(tasks.list_for_project("acme")) == tasks_before + 2
    titles = {t["title"] for t in tasks.list_for_project("acme")}
    assert {"Adopt PKCE", "Audit token storage"} <= titles
    # valid brain nodes created (invalid type skipped), each sourced to the run
    nodes = brain.list_nodes("acme")
    labels = {n["label"] for n in nodes}
    assert {"Use PKCE", "Token TTL 15m"} <= labels
    assert "should be skipped" not in labels
    for n in nodes:
        assert n["source"] == f"research:{tid}"


def test_review_changes_requested_reworks_synthesis():
    rec = Rec()
    run = _to_synthesis(rec)
    rid = run["id"]
    lifecycle.advance(rid, phase="synthesis", report=json.dumps(_SYNTH_REPORT),
                      spawn=rec, git=FakeGit())
    before = rec.count("synthesis")
    lifecycle.decide_gate(rid, "review", "changes_requested",
                          comment="add sources", spawn=rec, git=FakeGit())
    assert lifecycle.get(rid)["phase"] == "synthesis"
    assert rec.count("synthesis") == before + 1        # synthesis re-spawned
    assert lifecycle.get(rid)["active"] == 1           # not delivered
