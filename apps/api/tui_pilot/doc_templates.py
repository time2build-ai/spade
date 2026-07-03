"""Doc templates + the styled-doc renderer.

A docs task produces a shareable, styled HTML deliverable. This module holds two
pure-data pieces:

- ``TEMPLATES`` — per doc-template (``sow`` / ``explainer``) the REQUIRED
  sections a drafting agent must produce, embedded into its prompt. The stored
  ``doc`` artifact is the section BODY only (no ``<html>``/shell) so it can be
  rendered in different frames without a double-shell.
- ``render_shell(title, body_html)`` — the shared, theme-aware, self-contained
  HTML/CSS shell applied ONCE at render time (the ``/doc/{id}`` route). The shell
  is a locked layout in a house style; the agent-authored body carries no scripts
  (mermaid is pre-rendered to inline SVG at drafting time), so the ``/doc`` view
  can serve it inside a locked ``sandbox=""`` iframe with no ``allow-scripts``.
"""

from __future__ import annotations

import html as _html
import re

# Per doc-template required sections (the drafting prompt embeds these; the agent
# emits one <section> per required section). Order is the document order.
TEMPLATES: dict[str, dict] = {
    "sow": {
        "label": "Statement of Work",
        "sections": [
            "Overview",
            "Scope of Work",
            "Deliverables",
            "Timeline",
            "Investment",
            "Terms & Assumptions",
        ],
    },
    "explainer": {
        "label": "Explainer",
        "sections": [
            "Introduction",
            "Background",
            "How It Works",
            "Examples",
            "Summary",
        ],
    },
}


# The house style: a single locked layout, theme-aware via prefers-color-scheme
# (and the client's data-theme override), fully self-contained (no external font,
# stylesheet, script, or image request — safe under a strict CSP / locked iframe).
_SHELL_CSS = """
:root {
  --bg: #ffffff; --fg: #1a1d24; --muted: #5b6472; --rule: #e6e8ec;
  --accent: #2f6df6; --card: #f7f8fa; --code: #f2f3f5;
  --maxw: 46rem;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0f1115; --fg: #e6e8ec; --muted: #9aa4b2; --rule: #262a31;
    --accent: #6ea1ff; --card: #161a20; --code: #161a20;
  }
}
:root[data-theme="light"] {
  --bg: #ffffff; --fg: #1a1d24; --muted: #5b6472; --rule: #e6e8ec;
  --accent: #2f6df6; --card: #f7f8fa; --code: #f2f3f5;
}
:root[data-theme="dark"] {
  --bg: #0f1115; --fg: #e6e8ec; --muted: #9aa4b2; --rule: #262a31;
  --accent: #6ea1ff; --card: #161a20; --code: #161a20;
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--fg);
  font: 16px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
        Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
}
.doc { max-width: var(--maxw); margin: 0 auto; padding: 3.5rem 1.5rem 6rem; }
.doc-title {
  font-size: 2rem; line-height: 1.2; font-weight: 700; letter-spacing: -0.01em;
  margin: 0 0 2rem; padding-bottom: 1rem; border-bottom: 2px solid var(--accent);
}
.doc section { margin: 0 0 2.25rem; }
.doc h2 {
  font-size: 1.25rem; font-weight: 650; margin: 0 0 0.75rem; letter-spacing: -0.005em;
}
.doc h3 { font-size: 1.05rem; font-weight: 600; margin: 1.5rem 0 0.5rem; }
.doc p { margin: 0 0 1rem; }
.doc ul, .doc ol { margin: 0 0 1rem; padding-left: 1.4rem; }
.doc li { margin: 0.25rem 0; }
.doc a { color: var(--accent); }
.doc code {
  background: var(--code); padding: 0.1em 0.35em; border-radius: 4px;
  font: 0.9em/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.doc pre {
  background: var(--code); padding: 1rem; border-radius: 8px; overflow-x: auto;
}
.doc pre code { background: none; padding: 0; }
.doc table {
  width: 100%; border-collapse: collapse; margin: 0 0 1rem; display: block;
  overflow-x: auto;
}
.doc th, .doc td {
  border: 1px solid var(--rule); padding: 0.5rem 0.75rem; text-align: left;
}
.doc th { background: var(--card); font-weight: 600; }
.doc blockquote {
  margin: 0 0 1rem; padding: 0.5rem 1rem; border-left: 3px solid var(--accent);
  color: var(--muted);
}
.doc svg, .doc img { max-width: 100%; height: auto; }
.doc figure { margin: 0 0 1.5rem; text-align: center; }
""".strip()


# -- body hardening -----------------------------------------------------------
# The /doc/{id} route is a SHAREABLE top-level navigation at the API origin (NOT
# the client's sandboxed iframe), and the body is agent-authored HTML — buggy or
# prompt-injected (via the task title/description) content could carry <script>,
# inline `on*=` handlers, or `javascript:` URLs → stored XSS at the API origin.
# The drafting prompt only *asks* for script-free body-only output; this enforces
# it. NOT a full HTML sanitizer — a deliberately simple regex strip sufficient for
# this internal surface, paired with a restrictive CSP on the response.

_SCRIPT_RE = re.compile(r"(?is)<script\b.*?</script\s*>")
_BARE_SCRIPT_RE = re.compile(r"(?is)</?script\b[^>]*>")
_ON_ATTR_RE = re.compile(r"""(?i)\s+on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)""")
_JS_URL_RE = re.compile(r"(?i)javascript:")
# outer full-document wrapper the agent may emit despite the body-only instruction
_DOCTYPE_RE = re.compile(r"(?is)<!doctype[^>]*>")
_HEAD_RE = re.compile(r"(?is)<head\b.*?</head\s*>")
_BODY_INNER_RE = re.compile(r"(?is)<body\b[^>]*>(.*?)</body\s*>")
_HTML_TAGS_RE = re.compile(r"(?is)</?(?:html|head|body)\b[^>]*>")


def _strip_outer_shell(body: str) -> str:
    """Single-wrap defense: if the agent emitted a full ``<html>``/``<body>``
    document (ignoring the body-only instruction), reduce it to the inner body
    content so ``render_shell`` doesn't produce a nested double-document. The
    agent ``<head>`` (and any ``<style>`` in it) is dropped — the house style
    wins."""
    b = _DOCTYPE_RE.sub("", body)
    b = _HEAD_RE.sub("", b)
    m = _BODY_INNER_RE.search(b)
    if m:
        b = m.group(1)
    return _HTML_TAGS_RE.sub("", b)


def sanitize_body(body: str) -> str:
    """Strip scripts, inline event handlers, and ``javascript:`` URLs from an
    agent-authored doc body (after unwrapping any outer document shell)."""
    b = _strip_outer_shell(body or "")
    b = _SCRIPT_RE.sub("", b)
    b = _BARE_SCRIPT_RE.sub("", b)      # lone/unclosed <script ...> too
    b = _ON_ATTR_RE.sub("", b)
    b = _JS_URL_RE.sub("", b)
    return b


def render_shell(title: str, body_html: str) -> str:
    """Wrap a doc's BODY sections in the full styled, theme-aware HTML document.

    ``title`` is escaped and rendered as the document heading + ``<title>``;
    ``body_html`` is the agent-authored section markup (trusted only insofar as it
    is served inside a locked, script-less iframe by the client). Applied ONCE at
    render time — never baked into the stored ``doc`` artifact (which stays
    body-only), so there is never a double-shell.
    """
    safe_title = _html.escape(title or "Document")
    safe_body = sanitize_body(body_html or "")
    return (
        "<!doctype html>\n"
        '<html lang="en">\n<head>\n'
        '<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
        f"<title>{safe_title}</title>\n"
        f"<style>\n{_SHELL_CSS}\n</style>\n"
        "</head>\n<body>\n"
        '<article class="doc">\n'
        f'<h1 class="doc-title">{safe_title}</h1>\n'
        f"{safe_body}\n"
        "</article>\n</body>\n</html>"
    )
