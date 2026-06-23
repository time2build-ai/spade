import pytest
from tui_pilot.models import model_id, within_ceiling, TIERS

def test_tier_to_model_id():
    assert model_id("haiku") == "claude-haiku-4-5"
    assert model_id("sonnet") == "claude-sonnet-4-6"
    assert model_id("opus") == "claude-opus-4-8"

def test_unknown_tier_returns_none():
    assert model_id("") is None
    assert model_id(None) is None
    assert model_id("gpt") is None

def test_tiers_are_ordered_cheap_to_capable():
    assert TIERS == ["haiku", "sonnet", "opus"]

def test_within_ceiling():
    assert within_ceiling("haiku", "sonnet") is True
    assert within_ceiling("sonnet", "sonnet") is True
    assert within_ceiling("opus", "sonnet") is False
    assert within_ceiling("haiku", "opus") is True

def test_within_ceiling_unknown_tier_is_allowed():
    assert within_ceiling(None, "sonnet") is True
    assert within_ceiling("weird", "sonnet") is True
