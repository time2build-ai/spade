"""Chunk 5 Task 5.2: the shareable /doc/{id} route + render_shell.

The stored `doc` artifact is BODY-only; `render_shell` wraps it ONCE here into a
full, theme-aware, self-contained HTML document. The route is read-only and only
serves `kind == "doc"` artifacts (404 otherwise).
"""

from fastapi.testclient import TestClient

from tui_pilot import artifacts, doc_templates, projects, tasks


def _doc_artifact(body="<section><h2>Scope</h2><p>Hello.</p></section>"):
    projects.create(id="acme", name="Acme", path="/w")
    tid = tasks.create(project_id="acme", title="Client SOW")["id"]
    return artifacts.register(tid, None, "doc", "Client SOW", content=body)


# -- render_shell --------------------------------------------------------------

def test_render_shell_wraps_body_in_full_document():
    body = "<section><h2>Scope</h2></section>"
    html = doc_templates.render_shell("My Doc", body)
    assert "<!doctype html>" in html.lower()
    assert "<html" in html.lower() and "</html>" in html.lower()
    assert "My Doc" in html                       # title rendered
    assert body in html                           # body embedded verbatim
    # theme-aware + self-contained (no external requests)
    assert "prefers-color-scheme" in html
    assert "http://" not in html and "https://" not in html


def test_render_shell_sanitizes_scripts_handlers_and_js_urls():
    body = ('<section><h2>Scope</h2>'
            '<script>alert(1)</script>'
            '<img src=x onerror=alert(1)>'
            '<a href="javascript:alert(1)">x</a></section>')
    html = doc_templates.render_shell("Doc", body)
    assert "<script" not in html.lower()
    assert "<script>alert(1)</script>" not in html   # script block (+ contents) gone
    assert "onerror" not in html.lower()
    assert "javascript:" not in html.lower()          # scheme stripped → inert href
    assert "<h2>Scope</h2>" in html          # legit markup preserved


def test_render_shell_unwraps_full_document_to_single_shell():
    body = ("<!doctype html><html><head><style>body{color:red}</style></head>"
            "<body><section><h2>Scope</h2></section></body></html>")
    html = doc_templates.render_shell("Doc", body)
    assert html.lower().count("<!doctype html>") == 1     # single shell
    assert html.lower().count("<body") == 1
    assert "<h2>Scope</h2>" in html                       # inner content kept
    assert "color:red" not in html                        # agent head/style dropped


# -- GET /doc/{id} -------------------------------------------------------------

def test_get_doc_returns_wrapped_html():
    from tui_pilot.server import app
    art = _doc_artifact()
    c = TestClient(app)
    r = c.get(f"/doc/{art['id']}")
    assert r.status_code == 200
    assert "text/html" in r.headers["content-type"]
    html = r.text
    assert "<!doctype html>" in html.lower()      # wrapped in the shell once
    assert "<h2>Scope</h2>" in html               # the body is present
    assert html.lower().count("<!doctype html>") == 1   # NOT double-shelled


def test_get_doc_sets_csp_and_nosniff_headers():
    from tui_pilot.server import app
    art = _doc_artifact()
    c = TestClient(app)
    r = c.get(f"/doc/{art['id']}")
    assert r.status_code == 200
    csp = r.headers.get("content-security-policy", "")
    assert "default-src 'none'" in csp
    assert r.headers.get("x-content-type-options") == "nosniff"


def test_get_doc_strips_script_and_event_handlers():
    from tui_pilot.server import app
    art = _doc_artifact("<section><h2>S</h2><script>alert(1)</script>"
                        "<img src=x onerror=alert(1)></section>")
    c = TestClient(app)
    html = c.get(f"/doc/{art['id']}").text
    assert "<script" not in html.lower()
    assert "onerror" not in html.lower()
    assert "<h2>S</h2>" in html


def test_get_doc_404_for_non_doc_artifact():
    from tui_pilot.server import app
    projects.create(id="acme", name="Acme", path="/w")
    tid = tasks.create(project_id="acme", title="R")["id"]
    art = artifacts.register(tid, None, "report", "A report", content="body")
    c = TestClient(app)
    assert c.get(f"/doc/{art['id']}").status_code == 404


def test_get_doc_404_for_missing_artifact():
    from tui_pilot.server import app
    c = TestClient(app)
    assert c.get("/doc/does-not-exist").status_code == 404
