"""Per-kind lifecycle templates — the pure-data registry the engine reads.

The V2 engine hardcoded a single graph (shaping→plan_review→building→pr_review→
shipped) in ``lifecycle.py`` module constants and ``if phase==...`` branches. This
module generalizes that into a registry keyed by *kind* (``code`` today; research
and docs land in later chunks). The engine looks up ``run["kind"]`` and drives the
matching template instead of a hardcoded chain, so a new kind is a new registry
entry + its handlers — no engine rewiring.

A template is pure data:
    {
      "terminal_status": "shipped",     # the task status when the run finishes
      "needs_workspace": True,          # does the first phase need a cloned repo?
      "phases": [ {name, agent, fanout, gate, column}, ... ],
      "gate_advances": { gate: {approve_next, changes_target[, source_phase]} },
    }

Each phase entry:
- ``name``   the phase / task-status name (the state-machine node).
- ``agent``  does entering this phase spawn an agent?
- ``fanout`` is this a parallel fan-out phase (Chunk 2)?
- ``gate``   the gate OPENED when this phase's agent finishes (or None).
- ``column`` the universal board column this phase maps to.

``gate_advances`` is keyed by gate id. Each value carries the approve target
(``approve_next``) and the changes-requested rework target (``changes_target``),
plus an optional ``source_phase`` = the phase the run sits in while the gate waits
(defaults to the producing phase). Code's ``plan`` gate is the one case where the
run first moves to a dedicated review phase (``plan_review``) before waiting.

IMPORTANT (V2 parity): a gate is not a phase. ``review`` is a reserved gate id
(research/docs) and must never appear in ``agent_phases`` / the phase list.
"""

from __future__ import annotations

import functools

LIFECYCLE_TEMPLATES: dict[str, dict] = {
    "code": {
        "terminal_status": "shipped",
        "needs_workspace": True,
        "phases": [
            {"name": "shaping", "agent": True, "fanout": False,
             "gate": "plan", "column": "Planning"},
            # plan_review: the run sits here while the plan gate waits.
            {"name": "plan_review", "agent": False, "fanout": False,
             "gate": None, "column": "Planning"},
            {"name": "building", "agent": True, "fanout": False,
             "gate": "manual_test", "column": "In progress"},
            {"name": "pr_review", "agent": True, "fanout": False,
             "gate": "merge", "column": "Review"},
            {"name": "shipped", "agent": False, "fanout": False,
             "gate": None, "column": "Done"},
        ],
        "gate_advances": {
            # plan gate: shaping finishes → run moves to plan_review and waits.
            "plan": {"approve_next": "building", "changes_target": "shaping",
                     "source_phase": "plan_review"},
            # manual_test / merge gates wait at their producing phase.
            "manual_test": {"approve_next": "pr_review", "changes_target": "building"},
            "merge": {"approve_next": "shipped", "changes_target": "building"},
        },
    },
    # Research: a non-code kind with NO workspace. scoping proposes angles (scope
    # gate), investigating fans out one agent per angle (Chunk 2 barrier), synthesis
    # cross-checks + writes the report (review gate), delivered is terminal. The
    # scope gate's approve edge fans out (resolved via investigating's `fanout`
    # flag in decide_gate), not a single _spawn_phase.
    "research": {
        "terminal_status": "delivered",
        "needs_workspace": False,
        "phases": [
            {"name": "scoping", "agent": True, "fanout": False,
             "gate": "scope", "column": "Planning"},
            {"name": "investigating", "agent": True, "fanout": True,
             "gate": None, "column": "In progress"},
            {"name": "synthesis", "agent": True, "fanout": False,
             "gate": "review", "column": "Review"},
            {"name": "delivered", "agent": False, "fanout": False,
             "gate": None, "column": "Done"},
        ],
        "gate_advances": {
            "scope": {"approve_next": "investigating", "changes_target": "scoping"},
            "review": {"approve_next": "delivered", "changes_target": "synthesis"},
        },
    },
    # Docs: a non-code kind with NO workspace and NO PR/merge. outline proposes the
    # document structure (outline gate), drafting writes the styled BODY sections
    # (review gate), delivered is terminal. Both artifacts are INLINE (content, no
    # repo_path), like research. The `doc` body is stored WITHOUT the shared shell
    # — render_shell wraps it once at the /doc/{id} render step (no double-shell).
    "docs": {
        "terminal_status": "delivered",
        "needs_workspace": False,
        "phases": [
            {"name": "outline", "agent": True, "fanout": False,
             "gate": "outline", "column": "Planning"},
            {"name": "drafting", "agent": True, "fanout": False,
             "gate": "review", "column": "Review"},
            {"name": "delivered", "agent": False, "fanout": False,
             "gate": None, "column": "Done"},
        ],
        "gate_advances": {
            "outline": {"approve_next": "drafting", "changes_target": "outline"},
            "review": {"approve_next": "delivered", "changes_target": "drafting"},
        },
    },
}


# Human labels for every gate id across all templates. Exposed to the client via
# GET /lifecycle/templates so the task view doesn't hardcode a second copy.
GATE_LABELS: dict[str, str] = {
    "plan": "Plan review",
    "manual_test": "Manual test",
    "merge": "Merge approval",
    "scope": "Scope review",
    "outline": "Outline review",
    "review": "Review",
}

# Human labels for every artifact kind a lifecycle produces (drives the client
# Artifacts panel labels).
ARTIFACT_LABELS: dict[str, str] = {
    "spec": "Spec",
    "plan": "Plan",
    "test_guide": "Test guide",
    "review_report": "Review report",
    "finding": "Finding",
    "report": "Report",
    "outline": "Outline",
    "doc": "Document",
}


# -- accessors ----------------------------------------------------------------

def client_templates() -> dict:
    """kind → board mapping for the client (``GET /lifecycle/templates``).

    Each entry: ``{terminal_status, columns: {phase: column}, phases: [...]}`` so
    the client can bucket a task's kind+phase into a universal board column
    without hardcoding a second copy of the registry.
    """
    out: dict[str, dict] = {}
    for kind, tpl in LIFECYCLE_TEMPLATES.items():
        out[kind] = {
            "terminal_status": tpl["terminal_status"],
            "columns": {p["name"]: p["column"] for p in tpl["phases"]},
            "phases": [
                {"name": p["name"], "column": p["column"],
                 "agent": bool(p.get("agent")), "fanout": bool(p.get("fanout")),
                 "gate": p.get("gate")}
                for p in tpl["phases"]
            ],
        }
    return out


def template_for(kind: str) -> dict:
    """Return the template for ``kind`` (raises KeyError for an unknown kind)."""
    return LIFECYCLE_TEMPLATES[kind]


def phases(kind: str) -> list[dict]:
    return template_for(kind)["phases"]


def _phase(kind: str, phase: str) -> dict | None:
    for p in phases(kind):
        if p["name"] == phase:
            return p
    return None


def first_phase(kind: str) -> str:
    """The first phase's name (``shaping`` for code) — where ``start_run`` enters."""
    return phases(kind)[0]["name"]


def phase_after(kind: str, phase: str) -> str | None:
    """The next phase in the chain, or None if ``phase`` is terminal/unknown."""
    ps = [p["name"] for p in phases(kind)]
    if phase not in ps:
        return None
    i = ps.index(phase)
    return ps[i + 1] if i + 1 < len(ps) else None


def gate_for_phase(kind: str, phase: str) -> str | None:
    """The gate opened when ``phase``'s agent finishes (or None)."""
    p = _phase(kind, phase)
    return p.get("gate") if p else None


def agent_phases(kind: str) -> set[str]:
    return {p["name"] for p in phases(kind) if p.get("agent")}


def fanout_phases(kind: str) -> set[str]:
    return {p["name"] for p in phases(kind) if p.get("fanout")}


def column_for(kind: str, phase: str) -> str | None:
    p = _phase(kind, phase)
    return p.get("column") if p else None


def terminal_status(kind: str) -> str:
    return template_for(kind)["terminal_status"]


def needs_workspace(kind: str) -> bool:
    return bool(template_for(kind).get("needs_workspace"))


def gate_advances(kind: str) -> dict:
    """Per-gate ``{approve_next, changes_target[, source_phase]}`` map."""
    return template_for(kind)["gate_advances"]


def _gate_source_phase(kind: str, gate: str, adv: dict) -> str | None:
    """The phase the run sits in while ``gate`` waits.

    Explicit ``source_phase`` wins (code's plan gate → plan_review); otherwise it
    is the producing phase — the phase whose ``gate`` field equals this gate.
    """
    if adv.get("source_phase"):
        return adv["source_phase"]
    for p in phases(kind):
        if p.get("gate") == gate:
            return p["name"]
    return None


@functools.cache
def transition_pairs() -> frozenset[tuple[str, str]]:
    """Union across all templates of legal ``(from, to)`` status transitions.

    (a) consecutive ``(phase[i], phase[i+1])`` pairs;
    (b) each gate's ``(source_phase, approve_next)`` and ``(source_phase,
        changes_target)`` edges;
    (c) a self-loop ``(source_phase, source_phase)`` for any gate whose run waits
        at an AGENT phase — that phase can re-spawn / re-review without leaving
        itself (V2 parity: building→building via manual_test, pr_review→pr_review
        via merge; plan's source is the non-agent plan_review, so no self-loop);
    (d) the entry edge ``(ready, first_phase(kind))`` — ``start_run`` does a
        non-forced ``tasks.move(task_id, first_phase(kind))``, so without this a
        non-code start would raise an illegal-transition error.

    Cached: the registry is static at import, so the pair set never changes.
    """
    pairs: set[tuple[str, str]] = set()
    for kind in LIFECYCLE_TEMPLATES:
        names = [p["name"] for p in phases(kind)]
        agents = agent_phases(kind)
        for a, b in zip(names, names[1:]):
            pairs.add((a, b))
        for gate, adv in gate_advances(kind).items():
            src = _gate_source_phase(kind, gate, adv)
            if src is None:
                continue
            if adv.get("approve_next"):
                pairs.add((src, adv["approve_next"]))
            if adv.get("changes_target"):
                pairs.add((src, adv["changes_target"]))
            if src in agents:
                pairs.add((src, src))          # re-spawn/re-review self-loop
        pairs.add(("ready", first_phase(kind)))
    return frozenset(pairs)
