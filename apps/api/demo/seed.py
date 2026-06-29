"""Expand an app template into a real, in-progress Spade project.

Writes to the live DB ($TUI_PILOT_HOME, default ~/.spade) via the domain modules,
so the running app shows it on refresh. Pipelines are advanced with a fake spawn
(no live agents) so progress + sprint counts are real without spending tokens.
"""

from __future__ import annotations

import os

from tui_pilot import accounts, brain, feedback, meetings, pipelines, projects, sprints, tasks
from demo.templates import TEMPLATES


def _fake_spawn(slug: str, account_id: str):
    def spawn(idx: int, report):
        return (f"sess-{slug}-{idx}", account_id)
    return spawn


def advance_task(project_id: str, task_id: str, to: str = "shipped") -> dict:
    """Run a task through the pipeline with a fake spawn (no live agents, free) —
    used by the workshop's 'watch it build' step. `to` ∈ in_progress/review/shipped."""
    steps = {"in_progress": 1, "review": 2, "shipped": 4}.get(to, 4)
    run = pipelines.create_run(project_id=project_id, task_id=task_id)
    rid = run["id"]
    spawn = _fake_spawn(project_id, "demo")
    pipelines.start_stage(rid, 0, spawn)
    for idx in range(steps):
        pipelines.complete_stage(rid, idx, report=f"stage {idx} done", spawn=spawn)
    r = pipelines.get(rid)
    return {"run": rid, "status": r["status"], "progress": r["progress"]}


def bring_to_life(app: str, *, reset: bool = False, account_dir: str | None = None) -> dict:
    if app not in TEMPLATES:
        raise KeyError(f"unknown app {app!r}; choose from {sorted(TEMPLATES)}")
    t = TEMPLATES[app]
    pid = t["id"]
    slug = pid

    if reset and projects.get(pid):
        projects.delete(pid)  # FK CASCADE clears brain/tasks/pipelines/sprints/…

    if projects.get(pid) is None:
        projects.create(id=pid, name=t["name"], path=os.path.expanduser(t["path"]),
                        account_strategy="round_robin", model_ceiling="opus", autopilot=0)
    projects.set_current_project(pid)

    # --- optional account so "Ask the brain" works live ---------------------
    account_id = "demo"
    if account_dir:
        account_id = "me"
        if accounts.get(account_id) is None:
            accounts.import_existing(id=account_id, label="My Claude",
                                     config_dir=os.path.expanduser(account_dir))
        projects.set_pool(pid, [account_id])

    # --- brain graph --------------------------------------------------------
    feat = {f: brain.create_node(project_id=pid, type="feature", label=f,
                                 owner="You", source="Kickoff")["id"] for f in t["features"]}
    dec = {label: brain.create_node(project_id=pid, type="decision", label=label,
                                    status=status, owner="You", source="Architecture review")["id"]
           for (label, status) in t["decisions"]}
    conv = [brain.create_node(project_id=pid, type="convention", label=c, owner="You")["id"]
            for c in t["conventions"]]
    bug = [brain.create_node(project_id=pid, type="bug", label=b)["id"] for b in t["bugs"]]
    fb = [brain.create_node(project_id=pid, type="feedback", label=f)["id"] for f in t["feedback"]]
    met = [brain.create_node(project_id=pid, type="metric", label=m)["id"] for m in t["metrics"]]

    flist = list(feat.values())
    dlist = list(dec.values())
    # Link most features to a decision (round-robin) — but leave the LAST feature
    # undecided on purpose so Graph & Issues surfaces a real gap.
    for i, fid in enumerate(flist[:-1]):
        brain.add_edge(project_id=pid, from_id=fid, to_id=dlist[i % len(dlist)], rel="decided_by")
    for i, bid in enumerate(bug):
        brain.add_edge(project_id=pid, from_id=bid, to_id=flist[i % len(flist)], rel="affects")
    for i, fid_ in enumerate(fb):
        brain.add_edge(project_id=pid, from_id=fid_, to_id=flist[i % len(flist)], rel="about")
    # Link the first metric; leave the rest orphan (another real gap).
    if met:
        brain.add_edge(project_id=pid, from_id=met[0], to_id=flist[0], rel="measures")

    # --- backlog (tasks across columns) -------------------------------------
    task_ids: list[tuple[str, str, str]] = []  # (id, status, feature)
    for i, (title, feature, status, priority) in enumerate(t["tasks"]):
        tid = tasks.create(project_id=pid, title=title, feature=feature, priority=priority)["id"]
        if status != "ready":
            tasks.move(tid, status)
        if feature in feat:
            tasks.set_nodes(tid, [feat[feature]])
        if i % 4 == 0:
            tasks.add_comment(tid, body="Picked up from the kickoff backlog.", author="You", kind="note")
        task_ids.append((tid, status, feature))

    # --- sprint -------------------------------------------------------------
    num, day = t["sprint"]
    sprints.create(project_id=pid, number=num, day_label=day, state="active")

    # --- pipelines (execution at various stages) ----------------------------
    spawn = _fake_spawn(slug, account_id)
    runs = 0
    for tid, status, _feature in task_ids:
        if status not in ("shipped", "review", "in_progress"):
            continue
        rid = pipelines.create_run(project_id=pid, task_id=tid)["id"]
        pipelines.start_stage(rid, 0, spawn)
        # Advance to a stage that matches the task's lifecycle position.
        steps = {"shipped": 4, "review": 2, "in_progress": 1}[status]
        for idx in range(steps):
            pipelines.complete_stage(rid, idx, report=f"stage {idx} done", spawn=spawn)
        runs += 1

    # --- inputs -------------------------------------------------------------
    for (title, summary, attendees) in t["meetings"]:
        meetings.create(project_id=pid, title=title, date="2026-03-25", summary=summary, attendees=attendees)
    # Ingest a real transcript so the project shows the meeting → backlog flow:
    # the kickoff meeting and the tasks extracted from it (grounded back to it).
    ingested = meetings.ingest(pid, sample="todo-kickoff")
    for (label, count, sources) in t["feedback_clusters"]:
        feedback.create(project_id=pid, label=label, count=count,
                        sources=[{"name": n, "n": k, "color": "var(--blue)"} for (n, k) in sources])

    return {
        "project": pid, "name": t["name"],
        "features": len(feat), "decisions": len(dec), "tasks": len(task_ids),
        "pipelines": runs, "meetings": len(t["meetings"]) + 1,
        "ingested_tasks": len(ingested["tasks"]),
        "feedback_clusters": len(t["feedback_clusters"]),
        "account": account_id if account_dir else None,
    }
