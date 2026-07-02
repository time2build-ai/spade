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


# NOTE: The pipeline WRITE engine (start_stage/complete_stage board moves +
# auto-advance) was retired in Chunk 6 in favor of the lifecycle engine. The
# former start_stage → in_progress/review → shipped tests were removed with it
# (those statuses no longer exist). The CRUD/read path (create_run, stage
# ordering, derived progress, roles seed) stays for one-release coexistence and
# is still covered below.


def test_spawn_failure_pauses_run():
    tid = _setup()
    run = pipelines.create_run(project_id="acme", task_id=tid)

    def boom(idx, report):
        raise RuntimeError("no account")

    pipelines.start_stage(run["id"], 0, boom)
    r = pipelines.get(run["id"])
    assert r["status"] == "paused" and r["stages"][0]["state"] == "failed"


# -- read path: derived progress ----------------------------------------------
# (The stage-report / ship-comment activity-trail tests exercised the retired
# write engine and were removed with it.)


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
