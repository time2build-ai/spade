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


# -- auto-posted activity trail (stage reports + ship event) -------------------

def _spawn(stage_idx, report):  # returns (session_id, account_id)
    return (f"sess{stage_idx}", "acct")


def test_completing_a_stage_posts_its_report_as_a_task_comment():
    tid = _setup()
    run = pipelines.create_run(project_id="acme", task_id=tid)
    pipelines.start_stage(run["id"], 0, _spawn)
    pipelines.complete_stage(run["id"], 0, report="## Done\nAdded test_hello.py", spawn=_spawn)

    reports = [c for c in tasks.comments(tid) if c["kind"] == "stage_report"]
    assert len(reports) == 1
    assert reports[0]["author"] == "developer"
    assert "Added test_hello.py" in reports[0]["body"]


def test_stage_with_no_report_posts_no_stage_report_comment():
    tid = _setup()
    run = pipelines.create_run(project_id="acme", task_id=tid)
    pipelines.start_stage(run["id"], 0, _spawn)
    pipelines.complete_stage(run["id"], 0, report=None, spawn=_spawn)
    assert [c for c in tasks.comments(tid) if c["kind"] == "stage_report"] == []


def test_idempotent_complete_does_not_double_post():
    tid = _setup()
    run = pipelines.create_run(project_id="acme", task_id=tid)
    pipelines.start_stage(run["id"], 0, _spawn)
    pipelines.complete_stage(run["id"], 0, report="r0", spawn=_spawn)
    pipelines.complete_stage(run["id"], 0, report="r0", spawn=_spawn)  # racing re-entry
    assert len([c for c in tasks.comments(tid) if c["kind"] == "stage_report"]) == 1


def test_shipping_posts_a_system_comment():
    tid = _setup()
    run = pipelines.create_run(project_id="acme", task_id=tid)
    pipelines.start_stage(run["id"], 0, _spawn)
    for i in range(4):
        pipelines.complete_stage(run["id"], i, report=f"r{i}", spawn=_spawn)
    system = [c for c in tasks.comments(tid) if c["kind"] == "system"]
    assert any("shipped" in c["body"].lower() for c in system)


def test_run_progress_derived_from_stage_states():
    """Phase 3: GET pipeline runs carry a real progress derived from stages."""
    tid = _setup()
    run = pipelines.create_run(project_id="acme", task_id=tid)
    rid = run["id"]

    # Freshly queued → 0%, 0 of 4 done.
    fresh = pipelines.get(rid)
    assert fresh["stages_total"] == 4
    assert fresh["stages_done"] == 0
    assert fresh["progress"] == 0

    # Mark stage 0 done and stage 1 running → 1 done + half of the running = 38%.
    pipelines._set_stage(rid, 0, state="done")
    pipelines._set_stage(rid, 1, state="running")
    mid = pipelines.get(rid)
    assert mid["stages_done"] == 1
    assert mid["progress"] == 38

    # A shipped run is always 100%.
    pipelines._set_run(rid, status="shipped")
    assert pipelines.get(rid)["progress"] == 100
