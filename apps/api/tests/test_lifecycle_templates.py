from tui_pilot import lifecycle_templates as LT


def test_code_template_matches_v2_graph():
    t = LT.template_for("code")
    assert [p["name"] for p in t["phases"]] == \
        ["shaping", "plan_review", "building", "pr_review", "shipped"]
    assert LT.phase_after("code", "shaping") == "plan_review"
    assert LT.gate_for_phase("code", "shaping") == "plan"     # opened when shaping finishes
    assert LT.column_for("code", "building") == "In progress"
    assert LT.terminal_status("code") == "shipped"
    assert LT.first_phase("code") == "shaping"


def test_unknown_kind_raises():
    import pytest
    with pytest.raises(KeyError):
        LT.template_for("nope")


def test_consecutive_phase_pairs_union_covers_code_chain():
    pairs = LT.transition_pairs()   # set of (from,to) across all templates
    assert ("shaping", "plan_review") in pairs
    assert ("building", "pr_review") in pairs


def test_transition_pairs_include_entry_edge_per_kind():
    # start_run does a non-forced tasks.move(task_id, first_phase(kind)), so the
    # entry edge (ready, first_phase) MUST be a legal pair for every kind.
    pairs = LT.transition_pairs()
    assert ("ready", "shaping") in pairs        # code


def test_gate_advances_shape_for_code():
    ga = LT.gate_advances("code")
    assert ga["plan"]["approve_next"] == "building"
    assert ga["plan"]["changes_target"] == "shaping"
    assert ga["manual_test"] == {"approve_next": "pr_review", "changes_target": "building"}
    assert ga["merge"] == {"approve_next": "shipped", "changes_target": "building"}


def test_agent_and_fanout_phases_for_code():
    assert LT.agent_phases("code") == {"shaping", "building", "pr_review"}
    assert LT.fanout_phases("code") == set()


def test_gate_advance_edges_are_transition_pairs():
    pairs = LT.transition_pairs()
    # plan gate: source phase is plan_review (where the run sits while gate waits)
    assert ("plan_review", "building") in pairs
    assert ("plan_review", "shaping") in pairs
