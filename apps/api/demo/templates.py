"""Ready-made app templates for the 'bring an app to life' bootstrapper.

Each template is compact data; demo/seed.py expands it into a real, in-progress
project — brain graph, backlog cards across columns, decisions (incl. a proposed
one → a real gap + gate conflict), pipelines at various stages, a live sprint,
meetings and feedback. Pure data, no logic.
"""

# task = (title, feature, status, priority)   status ∈ ready/in_progress/review/shipped/blocked
# decision = (label, status)                  status ∈ active/proposed
# feedback_cluster = (label, count, [(source, n)])
# meeting = (title, summary, [attendees])

TEMPLATES = {
    "link-shortener": {
        "id": "snip",
        "name": "Snip · Link Shortener",
        "path": "~/code/snip",
        "tagline": "Short links, custom slugs, click analytics and QR codes.",
        "features": ["Short-link creation", "Custom slugs", "Click analytics", "QR codes",
                     "Link expiry", "Team workspaces"],
        "decisions": [("Use nanoid for slug generation", "active"),
                      ("Postgres over DynamoDB for links", "active"),
                      ("Edge redirects via the CDN", "active"),
                      ("Move analytics to ClickHouse", "proposed")],
        "conventions": ["{data, error} response envelope", "Validate slugs at the edge"],
        "bugs": ["Redirect 404s on expired links", "QR code is blurry on retina"],
        "feedback": ["Want bulk CSV import of links", "Click analytics feel delayed"],
        "metrics": ["P95 redirect latency", "Links created / day"],
        "tasks": [
            ("Create a short link from a URL", "Short-link creation", "shipped", 1),
            ("Edge redirect handler", "Short-link creation", "shipped", 0),
            ("Slug collision + retry", "Custom slugs", "shipped", 1),
            ("Custom slug input + validation", "Custom slugs", "review", 1),
            ("Click analytics dashboard", "Click analytics", "in_progress", 1),
            ("Generate a QR code per link", "QR codes", "in_progress", 2),
            ("Link expiry settings", "Link expiry", "ready", 2),
            ("Bulk CSV import", "Short-link creation", "ready", 2),
            ("Team workspaces + roles", "Team workspaces", "ready", 3),
            ("Per-link UTM passthrough", "Click analytics", "ready", 3),
            ("Fix 404 on expired links", "Link expiry", "blocked", 0),
        ],
        "meetings": [
            ("Kickoff — Snip MVP", "Agreed the MVP is create + redirect + basic analytics. "
             "Chose nanoid slugs and Postgres; deferred team workspaces.", ["You", "Dana", "Akira"]),
            ("Analytics review", "Click analytics lag traced to batch writes; floated a move to "
             "ClickHouse (recorded as a proposed decision).", ["You", "Akira"]),
        ],
        "feedback_clusters": [
            ("Want bulk link import", 9, [("Intercom", 6), ("GitHub", 3)]),
            ("Analytics update too slowly", 6, [("Intercom", 4), ("App Store", 2)]),
        ],
        "sprint": (26, "day 3/10"),
    },

    "recipe-box": {
        "id": "recipebox",
        "name": "Recipe Box",
        "path": "~/code/recipe-box",
        "tagline": "Save recipes, plan meals, generate a shopping list.",
        "features": ["Recipe capture", "Meal planner", "Shopping list", "Import from URL",
                     "Tags & search", "Sharing"],
        "decisions": [("Parse recipes with schema.org JSON-LD", "active"),
                      ("Offline-first with local SQLite", "active"),
                      ("Weekly planner is the home screen", "active"),
                      ("Add AI ingredient substitution", "proposed")],
        "conventions": ["Ingredients normalised to grams", "Images stored as WebP"],
        "bugs": ["Import drops fractional quantities", "Shopping list duplicates units"],
        "feedback": ["Want to scale servings", "Import fails on some blogs"],
        "metrics": ["Recipes saved / user", "Planner completion rate"],
        "tasks": [
            ("Save a recipe manually", "Recipe capture", "shipped", 1),
            ("Tag & search recipes", "Tags & search", "shipped", 2),
            ("Import a recipe from a URL", "Import from URL", "review", 1),
            ("Weekly meal planner grid", "Meal planner", "in_progress", 1),
            ("Generate a shopping list", "Shopping list", "in_progress", 1),
            ("Scale servings up/down", "Recipe capture", "ready", 2),
            ("Share a recipe by link", "Sharing", "ready", 3),
            ("Dedupe shopping-list units", "Shopping list", "ready", 2),
            ("Fix fractional import parsing", "Import from URL", "blocked", 0),
        ],
        "meetings": [
            ("Recipe Box kickoff", "Scoped MVP to capture + plan + list. Chose offline-first "
             "local SQLite and schema.org parsing for imports.", ["You", "Priya"]),
        ],
        "feedback_clusters": [
            ("Need serving scaling", 7, [("App Store", 5), ("Intercom", 2)]),
            ("Imports fail on some sites", 5, [("GitHub", 3), ("Intercom", 2)]),
        ],
        "sprint": (12, "day 5/10"),
    },

    "habit-tracker": {
        "id": "streak",
        "name": "Streak · Habit Tracker",
        "path": "~/code/streak",
        "tagline": "Build habits, keep streaks, get gentle nudges.",
        "features": ["Habit creation", "Daily check-in", "Streaks", "Reminders",
                     "Stats & insights", "Widgets"],
        "decisions": [("Local notifications over push for reminders", "active"),
                      ("Streak resets at local midnight", "active"),
                      ("Store check-ins as an event log", "active"),
                      ("Add social accountability groups", "proposed")],
        "conventions": ["Times are stored in the user's local tz", "One event per check-in (no edits)"],
        "bugs": ["Streak off-by-one across DST", "Reminder fires twice on iOS"],
        "feedback": ["Want a home-screen widget", "Reminders are too aggressive"],
        "metrics": ["7-day retention", "Avg active streaks / user"],
        "tasks": [
            ("Create a habit", "Habit creation", "shipped", 1),
            ("Daily check-in toggle", "Daily check-in", "shipped", 0),
            ("Compute current streak", "Streaks", "review", 1),
            ("Local reminder scheduling", "Reminders", "in_progress", 1),
            ("Stats & insights screen", "Stats & insights", "in_progress", 2),
            ("Home-screen widget", "Widgets", "ready", 2),
            ("Accountability groups", "Stats & insights", "ready", 3),
            ("Soften reminder cadence", "Reminders", "ready", 2),
            ("Fix DST streak off-by-one", "Streaks", "blocked", 0),
        ],
        "meetings": [
            ("Streak planning", "Decided local notifications and an append-only check-in log. "
             "Floated social accountability groups (proposed).", ["You", "Sam"]),
        ],
        "feedback_clusters": [
            ("Want a widget", 8, [("App Store", 6), ("Intercom", 2)]),
            ("Reminders too aggressive", 4, [("Intercom", 4)]),
        ],
        "sprint": (4, "day 2/14"),
    },
}
