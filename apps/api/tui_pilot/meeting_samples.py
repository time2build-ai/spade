"""Canned meeting transcripts for the ingest demo.

These stand in for a real meeting-notes integration (Granola / Otter / Fireflies
/ Zoom). Each sample carries a realistic transcript whose action lines are tagged
with an arrow (``→``) — `meetings.extract_action_items` parses those into backlog
tasks. A leading ``!`` after the arrow (``→!``) marks a high-priority item.

Deterministic on purpose: no model call, no tokens, so the live demo always lands
the same way. Add a sample by appending to SAMPLES (pure data).
"""

from __future__ import annotations

# Each sample: a key → {title, date, source, attendees, summary, transcript}.
# `source` names the upstream tool the notes "came from" (for the UI badge).
SAMPLES: dict[str, dict] = {
    "todo-kickoff": {
        "title": "Todo App — kickoff",
        "date": "2026-06-26",
        "source": "Granola",
        "attendees": ["You", "Jose"],
        "summary": (
            "Scoped the first slice of the todo app: a React + Vite front end over "
            "a small FastAPI + SQLite back end. Agreed to ship the core list and "
            "check-off loop first, persist early, and leave due dates for a later "
            "pass."
        ),
        "transcript": (
            "You: Okay, let's get the todo app off the ground. What's the smallest thing worth building first?\n"
            "Jose: The core list, honestly. People need to jot down todos and check them off. → Build the todo list view with add and check-off\n"
            "You: And we should persist from day one — losing items on refresh feels broken. → Set up the FastAPI + SQLite backend with a todos table\n"
            "Jose: Agreed. Wire the front end straight to it. → Add the create-todo endpoint and hook the form up to it\n"
            "You: Editing and deleting come up constantly, let's not skip them. → Support editing and deleting a todo\n"
            "Jose: A filter for just the open ones would keep the list usable. → Add a filter to show only open todos\n"
            "You: Due dates would be nice down the line, but it's not for this slice. → Explore optional due dates as a follow-up\n"
            "Jose: Last thing — let's get a clean empty state so the first run isn't a blank box. →! Design the empty state for a fresh list\n"
        ),
    },
    "weekly-sync": {
        "title": "Weekly sync — polish & bugs",
        "date": "2026-06-29",
        "source": "Otter.ai",
        "attendees": ["You", "Maya", "Devin", "Priya"],
        "summary": (
            "Reviewed the first build with the team. The check-off loop works; the "
            "rough edges are around persistence races, mobile layout and keyboard "
            "flow. Priya flagged accessibility before we widen the beta."
        ),
        "transcript": (
            "Priya: The list looks great on desktop but it's cramped on my phone. → Fix the mobile layout for the todo list\n"
            "Devin: I saw a todo come back after I deleted it — looks like a save race. →! Fix the delete/save race on the todos endpoint\n"
            "Maya: Power users will want to add without reaching for the mouse. → Add a keyboard shortcut to add a todo\n"
            "Priya: And we should screen-reader test before the beta widens. →! Run an accessibility pass on the todo list\n"
            "You: Good. Let's also remember state when you reload mid-edit. → Persist in-progress edits across reload\n"
        ),
    },
}


def get(key: str) -> dict | None:
    return SAMPLES.get(key)


def listing() -> list[dict]:
    """Lightweight catalog for a picker — id/title/source/date, no transcript."""
    return [
        {"id": k, "title": s["title"], "source": s["source"],
         "date": s["date"], "attendees": s["attendees"]}
        for k, s in SAMPLES.items()
    ]
