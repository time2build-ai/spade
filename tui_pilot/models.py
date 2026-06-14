"""Model tiers for sizing a worker to its task.

Tier names are stable across the codebase; the concrete `--model` ids may need
confirming against the installed Claude Code (see spec §5)."""
from __future__ import annotations

# cheap → capable
TIERS = ["haiku", "sonnet", "opus"]

_IDS = {
    "haiku": "claude-haiku-4-5",
    "sonnet": "claude-sonnet-4-6",
    "opus": "claude-opus-4-8",
}

def model_id(tier: str | None) -> str | None:
    """Concrete --model id for a tier, or None for unknown/absent (server default)."""
    if not tier:
        return None
    return _IDS.get(tier)

def within_ceiling(tier: str | None, ceiling: str) -> bool:
    """True if `tier` is at or below `ceiling`. Unknown/None tier == default → allowed."""
    if tier not in TIERS:
        return True
    if ceiling not in TIERS:
        return True
    return TIERS.index(tier) <= TIERS.index(ceiling)
