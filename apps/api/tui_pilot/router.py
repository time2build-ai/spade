"""Task-type router — classify a task as code / research / docs.

The router is intentionally a **keyword matcher**. tui-pilot has NO headless /
SDK / direct-API model path: the documented invariant (``__init__.py`` docstring
"No headless flags, no SDK, no direct API calls"; ``server.py`` / ``controller.py``
— every agent is an interactive ``claude`` driven over tmux) means there is no
cheap one-shot model call available to a synchronous HTTP handler. So ``classify``
runs on a keyword matcher; ``_llm_classify`` ships as a **stub returning None**
recording that invariant. An agent-based classifier (spawning a real tmux agent)
is a separate future charter, out of scope here.

``classify(title, description) -> {kind, reason, doc_template?}``:
- ``kind``  one of ``code`` / ``research`` / ``docs``.
- ``reason`` a short human string naming the matched token (or the code fallback).
- ``doc_template`` present ONLY when ``kind == "docs"`` (``sow`` or ``explainer``).
"""

from __future__ import annotations

import re

# Word-boundary keyword sets. Research is checked BEFORE docs (see classify).
# These lists are intentionally LEAN and ADVISORY: the output is only stored as
# `kind_suggested` (a suggestion), never the authoritative kind — a human confirms
# it — so we optimize for a few high-signal tokens over exhaustive coverage.
#
# NOTE the docs set deliberately uses ``\bdoc\b`` / ``\bdocs\b`` word-boundary
# tokens, NOT a ``"doc "`` substring — the substring approach both missed the
# trailing-word case ("Write the doc") and would false-match inside "document"/
# "docstring". The regex only fires on the standalone word or its plural.
_RESEARCH_RE = re.compile(
    r"\b(research|investigate|compare|analyze|analyse|explore|audit)\b"
)
_DOCS_RE = re.compile(
    r"(\bsow\b|\bexplainer\b|\bwrite-up\b|\bwriteup\b|\bdocumentation\b|\bdoc\b|\bdocs\b)"
)
_SOW_RE = re.compile(r"\bsow\b")


def _llm_classify(title: str, description: str) -> None:
    """Agent-based classifier seam — a STUB that always returns ``None``.

    tui-pilot has no headless/SDK/direct-API model path (invariant: ``__init__.py``,
    ``server.py``, ``controller.py`` — every agent is interactive ``claude`` over
    tmux); an agent-based classifier is a separate charter.
    """
    return None


def classify(title: str, description: str = "") -> dict:
    """Classify a task's kind from its title + description.

    Tries the ``_llm_classify`` seam first (currently always None), then falls
    through to the keyword matcher. Returns ``{kind, reason[, doc_template]}``.
    """
    seam = _llm_classify(title, description)
    if seam is not None:
        return seam

    text = f"{title} {description}".lower()

    # PINNED precedence: research is checked BEFORE docs. A title containing both a
    # research verb and a doc noun classifies as research — research is the
    # higher-effort lifecycle, and a doc can be a research follow-up.
    m = _RESEARCH_RE.search(text)
    if m:
        return {"kind": "research", "reason": f"matched research keyword {m.group(1)!r}"}

    m = _DOCS_RE.search(text)
    if m:
        template = "sow" if _SOW_RE.search(text) else "explainer"
        return {
            "kind": "docs",
            "reason": f"matched docs keyword {m.group(1)!r}",
            "doc_template": template,
        }

    return {"kind": "code", "reason": "no research/docs keywords → code"}
