from tui_pilot import router


def test_keyword_classifies():
    assert router.classify("Investigate auth perf", "")["kind"] == "research"
    assert router.classify("Write the client SOW", "")["kind"] == "docs"
    assert router.classify("Add a dark-mode toggle", "")["kind"] == "code"
    d = router.classify("SOW for Q3", "")
    assert d["kind"] == "docs" and d["doc_template"] in ("sow", "explainer")


def test_llm_seam_returns_none_and_keyword_path_still_valid():
    # tui-pilot has no headless model path: _llm_classify is a stub returning None.
    assert router._llm_classify("Add a login button", "") is None
    r = router.classify("Add a login button", "")
    assert r["kind"] == "code" and isinstance(r.get("reason"), str) and r["reason"]


def test_research_vs_docs_precedence():
    # a title with both a research verb and a doc noun resolves per the PINNED
    # precedence (research wins).
    assert router.classify("Research and write a doc on caching", "")["kind"] == "research"


def test_docs_template_selection():
    # explicit sow token → sow template; other doc nouns → explainer.
    assert router.classify("Draft the SOW", "")["doc_template"] == "sow"
    assert router.classify("Write an explainer on our API", "")["doc_template"] == "explainer"
    assert router.classify("Update the documentation", "")["doc_template"] == "explainer"


def test_doc_word_boundary_not_substring():
    # "document" should NOT be matched by a naive "doc " substring; the \bdoc\b
    # regex only fires on the standalone word (or the plural). A title with no
    # standalone doc/docs token and no research verb is code.
    assert router.classify("Add a docstring parser", "")["kind"] == "code"
    assert router.classify("Write the doc", "")["kind"] == "docs"
    assert router.classify("Publish the docs", "")["kind"] == "docs"


def test_doc_template_only_for_docs_kind():
    assert "doc_template" not in router.classify("Add a login button", "")
    assert "doc_template" not in router.classify("Investigate the outage", "")


def test_reason_is_a_short_human_string():
    assert router.classify("Add a button", "")["reason"]
    assert "research" in router.classify("Investigate X", "")["reason"].lower()
