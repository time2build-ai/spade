# Bring an app to life

One command populates a real, in-progress Spade project — brain graph, backlog
cards across every column, decisions (incl. a proposed one → a real gap + gate
conflict), pipelines at various stages, a live sprint, meetings and feedback —
so you can walk the **full development lifecycle** in the UI.

It also **ingests a meeting**: the seeded "Todo App — kickoff" transcript (via the
mock Granola source) is parsed into seven grounded backlog tasks — open the
Meetings screen to see the meeting → backlog flow, then hit **Ingest a meeting**
to do it live in front of an audience.

```bash
# from apps/api
../../.venv/bin/python -m demo --list                       # show app templates
../../.venv/bin/python -m demo --app link-shortener         # seed it
../../.venv/bin/python -m demo --app link-shortener --reset # wipe + re-seed
../../.venv/bin/python -m demo --app link-shortener --account ~/.claude  # + connect an account so Ask works live
```

Writes to the live DB (`$TUI_PILOT_HOME`, default `~/.spade`), so the running app
shows it on refresh. Pipelines are advanced with a fake spawn — **no live agents,
no tokens**. Then open `localhost:8766`, switch to the project, and explore.

**Apps:** `link-shortener` · `recipe-box` · `habit-tracker`.

**Remove a seeded project:** `--reset` re-seeds it; to delete entirely,
`curl -s -X DELETE 127.0.0.1:8765/projects/<id>` (FK cascade clears its data).

A guided, screen-by-screen walkthrough lives at `docs/LIFECYCLE-TOUR.html`.
Add a new app by appending a template to `demo/templates.py` (pure data).
