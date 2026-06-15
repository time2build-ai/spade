from tui_pilot import pipelines, roles_seed, tasks, projects, db


def test_pipeline_roles_seeded():
    roles_seed.upsert_pipeline_roles()
    ids = {r["id"] for r in db.query("SELECT id FROM roles")}
    assert "integrator" in ids
    assert "documentor" in ids


def test_pipeline_roles_upsert_on_already_seeded_db():
    # Simulate an OLD foundation DB that predates integrator+documentor: seed the
    # full set, then drop the two pipeline-only roles so the table is non-empty
    # (seed_if_empty would no-op) but missing them.
    roles_seed.seed_if_empty()
    db.execute("DELETE FROM roles WHERE id IN ('integrator', 'documentor')")
    ids = {r["id"] for r in db.query("SELECT id FROM roles")}
    assert "integrator" not in ids and "documentor" not in ids

    roles_seed.upsert_pipeline_roles()

    ids = {r["id"] for r in db.query("SELECT id FROM roles")}
    for rid in ("developer", "reviewer", "integrator", "documentor"):
        assert rid in ids
    assert db.query("SELECT count(*) AS c FROM roles")[0]["c"] == 7


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


def test_complete_stage_is_re_entry_safe():
    # A manual /advance racing the poll loop must not double-spawn the next stage.
    tid = _setup()
    run = pipelines.create_run(project_id="acme", task_id=tid)
    spawned = []

    def fake_spawn(stage_idx, report):
        spawned.append(stage_idx)
        return (f"sess{stage_idx}", "acct")

    pipelines.start_stage(run["id"], 0, fake_spawn)  # spawns stage 0
    spawned.clear()

    pipelines.complete_stage(run["id"], 0, report="r0", spawn=fake_spawn)
    pipelines.complete_stage(run["id"], 0, report="r0", spawn=fake_spawn)  # no-op

    assert spawned == [1]  # stage 1 spawned exactly once
    stages = pipelines.get(run["id"])["stages"]
    assert stages[0]["state"] == "done"
    assert stages[1]["state"] == "running"


def test_spawn_failure_pauses_run():
    tid = _setup()
    run = pipelines.create_run(project_id="acme", task_id=tid)

    def boom(idx, report):
        raise RuntimeError("no account")

    pipelines.start_stage(run["id"], 0, boom)
    r = pipelines.get(run["id"])
    assert r["status"] == "paused" and r["stages"][0]["state"] == "failed"
