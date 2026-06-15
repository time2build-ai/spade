from tui_pilot import pipelines, roles_seed, tasks, projects, db


def test_pipeline_roles_seeded():
    roles_seed.upsert_pipeline_roles()
    ids = {r["id"] for r in db.query("SELECT id FROM roles")}
    assert "integrator" in ids
    assert "documentor" in ids


def _setup():
    projects.create(id="acme", name="Acme", path="/w")
    return tasks.create(project_id="acme", title="Build X")["id"]


def test_create_run_builds_four_ordered_stages():
    tid = _setup()
    run = pipelines.create_run(project_id="acme", task_id=tid)
    stages = pipelines.get(run["id"])["stages"]
    assert [s["role"] for s in stages] == ["developer", "reviewer", "integrator", "documentor"]
    assert all(s["state"] == "queued" for s in stages)


def test_advance_runs_stages_then_ships():
    tid = _setup()
    run = pipelines.create_run(project_id="acme", task_id=tid)
    spawned = []

    def fake_spawn(stage_idx, report):  # returns (session_id, account_id)
        spawned.append((stage_idx, report))
        return (f"sess{stage_idx}", "acct")

    pipelines.start_stage(run["id"], 0, fake_spawn)
    assert pipelines.get(run["id"])["stages"][0]["state"] == "running"
    assert pipelines.get(run["id"])["stages"][0]["session_id"] == "sess0"
    for i in range(4):
        pipelines.complete_stage(run["id"], i, report=f"r{i}", spawn=fake_spawn)
    run2 = pipelines.get(run["id"])
    assert run2["status"] == "shipped"
    assert tasks.get(tid)["status"] == "shipped"
    assert [s["state"] for s in run2["stages"]] == ["done", "done", "done", "done"]
    # stage 1..3 were spawned with the PRIOR stage's report threaded in
    assert (1, "r0") in spawned


def test_spawn_failure_pauses_run():
    tid = _setup()
    run = pipelines.create_run(project_id="acme", task_id=tid)

    def boom(idx, report):
        raise RuntimeError("no account")

    pipelines.start_stage(run["id"], 0, boom)
    r = pipelines.get(run["id"])
    assert r["status"] == "paused" and r["stages"][0]["state"] == "failed"
