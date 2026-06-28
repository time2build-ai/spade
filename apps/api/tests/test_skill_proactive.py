"""Guard: the spade-data skill must keep its proactive-capture guidance.

Proactivity is LLM behavior (verified live in evals/run_proactivity_eval.py), but
the *instruction* that drives it lives in the skill file — this cheap, offline
check stops it from silently disappearing in a refactor.
"""

from pathlib import Path

SKILL = Path(__file__).resolve().parent.parent / "tui_pilot" / "assets" / "spade-data" / "SKILL.md"


def test_skill_has_proactive_capture_section():
    text = SKILL.read_text().lower()
    assert "be proactive" in text, "skill lost its proactive section"
    # the core idea: don't wait to be told
    assert "never" in text and "insert an adr" in text
    # the signal → artifact mapping the agent acts on
    for artifact in ("decision", "feature", "task", "bug", "feedback"):
        assert artifact in text, f"proactive guidance lost the {artifact!r} signal"
    # inferred decisions must be proposed (not silently active), and de-dup first
    assert "proposed" in text
    assert "de-dup" in text or "dedupe" in text or "de-dupe" in text
