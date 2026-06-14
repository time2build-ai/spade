import re
from tui_pilot.identity import slugify, new_agent_id

def test_slugify_kebabs_and_truncates():
    assert slugify("Dev 1") == "dev-1"
    assert slugify("My Cool Agent!!") == "my-cool-agent"
    assert len(slugify("x" * 50)) <= 16

def test_slugify_fallback_for_empty():
    assert slugify("") == "agent"
    assert slugify("###") == "agent"

def test_id_has_slug_prefix_and_token():
    aid = new_agent_id("dev-1")
    assert aid.startswith("dev-1__")
    # slug__token; split on the LAST "__" so hyphenated slugs are unambiguous
    slug, token = aid.rsplit("__", 1)
    assert slug == "dev-1"
    assert re.fullmatch(r"[0-9a-z]{4,}", token)

def test_separator_is_unambiguous_for_hyphenated_slug():
    aid = new_agent_id("my-cool-agent")
    slug, token = aid.rsplit("__", 1)
    assert slug == "my-cool-agent"   # hyphens in slug don't confuse the split

def test_ids_are_unique_under_load():
    ids = {new_agent_id("dev-1") for _ in range(5000)}
    assert len(ids) == 5000  # no collisions even with identical name
