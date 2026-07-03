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
