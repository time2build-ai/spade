---
name: spade-data
description: Read and drive the Spade app (projects, backlog/tasks, product brain, pipelines) over its local HTTP API. Use whenever the human asks about the product state or asks you to do product work.
---

# Inspecting and driving Spade

You are running inside **Spade** (the tui-pilot app). Spade's real state — projects,
backlog tasks, the product "brain" (a knowledge graph), agent pipelines, and accounts —
lives in the app's database, NOT in the filesystem. To know what's going on, query the
local HTTP API with `curl`. The base URL is:

```
__API_BASE__
```

Always `curl -s` and parse the JSON (use `jq` if available, e.g. `curl -s URL | jq`).
**Do NOT `ls` workspace directories to answer questions about projects/tasks** — that is
just agent scratch space. Use the API below.

## Read the current state

```bash
B=__API_BASE__
curl -s $B/current-project                 # {"project_id": "..."} — the active project
curl -s $B/projects                        # all projects
curl -s $B/projects/<id>                   # one project (+ its account pool)
curl -s "$B/tasks?project_id=<id>"         # the BACKLOG: tasks with status/feature/priority
curl -s $B/tasks/<task_id>                 # one task (+ grounded brain node ids)
curl -s "$B/brain/nodes?project_id=<id>"   # PRODUCT BRAIN nodes (feature/decision/feedback/bug/metric)
curl -s "$B/brain/edges?project_id=<id>"   # brain edges (relationships)
curl -s "$B/pipelines?project_id=<id>"     # pipeline runs (4-stage agent execution) + stage states
curl -s $B/pipelines/<run_id>              # one pipeline run with its stages
curl -s $B/accounts                        # cloud accounts
curl -s $B/sessions                        # live agents
```

Task `status` is the kanban column: `ready | in_progress | review | shipped | blocked`.
Priority is `0`(P0)..`3`. A pipeline run `status` is `queued|running|gated|shipped|paused|failed`;
its stages are `developer → reviewer → integrator → documentor`, each `queued|running|done|failed`.

**Before answering anything about the product, find the current project** (`GET /current-project`).
If it is null, list `GET /projects` and ask the human which one (or proceed if there's one).

## Drive Spade (do product work)

```bash
B=__API_BASE__
# switch the active project
curl -s -X PUT $B/current-project -H 'content-type: application/json' -d '{"project_id":"<id>"}'
# create a backlog task
curl -s -X POST $B/tasks -H 'content-type: application/json' \
  -d '{"project_id":"<id>","title":"...","feature":"...","priority":1,"description":"..."}'
# move a task across the kanban
curl -s -X POST $B/tasks/<task_id>/move -H 'content-type: application/json' -d '{"status":"in_progress"}'
# ground a task in the brain (link it to nodes for context)
curl -s -X PUT $B/tasks/<task_id>/nodes -H 'content-type: application/json' -d '{"node_ids":["<n1>","<n2>"]}'
# link tasks (rel: blocks | related | subtask). "A blocks B" = A must finish before B.
# "A subtask B" = A is the parent/epic of child B. "related" is symmetric.
curl -s -X POST $B/tasks/<A>/links -H 'content-type: application/json' -d '{"to_task":"<B>","rel":"blocks"}'
curl -s -X DELETE $B/tasks/<A>/links/<link_id>   # remove a link (each task carries its links[])
# add a brain node / edge.
# `label` = short title. `detail` = a SELF-CONTAINED markdown description (what it
# is, why it matters, where it came from) — this is what the Product brain panel
# renders (as markdown) when the human clicks the node, so make it substantive.
curl -s -X POST $B/brain/nodes -H 'content-type: application/json' -d '{"project_id":"<id>","type":"decision","label":"Adopt OAuth 2.1","detail":"**What:** Use OAuth 2.1 with PKCE for the SPA login flow.\n**Why:** Eliminates implicit-flow token leakage and matches the new auth provider.\n**Source:** 2026-06-23 architecture review."}'
curl -s -X POST $B/brain/edges -H 'content-type: application/json' -d '{"project_id":"<id>","from_id":"<a>","to_id":"<b>","rel":"decided_by"}'
# RUN a task through the 4-stage agent pipeline (Developer→Reviewer→Integrator→Documentor)
RID=$(curl -s -X POST $B/pipelines -H 'content-type: application/json' -d '{"project_id":"<id>","task_id":"<task_id>"}' | jq -r .id)
curl -s -X POST $B/pipelines/$RID/start    # spawns the developer agent; auto-advances on finish
```

## Be proactive — capture as you converse (don't wait to be told)

The human will almost **never** say "insert an ADR" or "create a feature". They just
*talk* — about what they want, what they decided, what's broken. **Your job is to notice
and offer to capture it**, so the brain and backlog stay current without the human
managing them. Listen across the conversation for these signals and act:

| You hear (in plain talk)… | …it's probably a | Proactively do |
|---|---|---|
| "let's use X", "we'll go with", "I'd rather", a choice made between options | **decision (ADR)** | record a brain node `type:"decision"` as **`status:"proposed"`**, link it to the feature it shapes, and say you did |
| "it should be able to…", "users need…", "we want a way to…", a capability | **feature** | add a `type:"feature"` node; if it's actionable now, also add a backlog **task** grounded in it |
| "we should build/add/fix…", concrete work | **task** | create a backlog `task` (with `feature` + a short `description`), grounded in the relevant brain node |
| "it's broken", "X fails when…", "regression", "flickers" | **bug** | add a `type:"bug"` node (+ a task if it needs fixing) |
| "users keep asking…", "people complain about…" | **feedback** | add a `type:"feedback"` node |

**How to be proactive without being annoying:**

- **Notice out loud, then capture.** One line: *"That's a decision — I'll record it as a
  **proposed** ADR and link it to Checkout."* Then do it. Don't make them ask.
- **Infer-low-risk, propose-high-risk.** Features, tasks, bugs, feedback are cheap to capture —
  just create them and mention it. **Decisions** carry weight: record them as **`proposed`**
  (never silently `active`) and let the human confirm/promote — Spade will even flag the
  conflict if a proposal contradicts an active ADR.
- **Only concrete signals.** Skip hypotheticals ("maybe someday…"), chit-chat, and things
  already captured — **read the brain/backlog first** (`GET /brain/nodes`, `GET /tasks`) and
  **de-dupe** before creating. If nothing concrete was said, capture nothing.
- **Summarize at natural breaks.** After a topic, tell them what landed: *"Captured: 1 feature,
  1 proposed ADR, 2 backlog tasks."* So they can see (and undo) it.
- **Ground everything.** Link tasks to their feature node and decisions to what they affect —
  a lone node is a future "gap" Spade will nag about.

This applies to any conversation you can see — a live chat, a meeting summary, a worker's
report. The human steers; **you keep the brain and backlog honest.**

## How you operate in Spade

- When the human asks **about state** ("what projects/tasks/backlog do we have", "what's
  in the brain", "what's running"), `curl` the read endpoints and answer in plain text with
  the real data. Never guess from the filesystem.
- When the human asks you to **do product work** ("ship the Apple Pay feature", "add a task
  for X", "run the checkout task"), use the Spade write API: create/ground tasks and **run
  pipelines** — that is the Spade-native way to put a fleet of agents on a task (the pipeline
  auto-advances Developer→Reviewer→Integrator→Documentor on the task's project + account).
- Running a pipeline is usually better than raw `spawn` for product tasks, because it is
  tracked in Spade and shows up in the Pipelines view. Use `spawn`/`answer`/`kill`/`status`
  (your orchestrator-comms skill) for ad-hoc work or to answer a worker that's blocked on you.
- When you **capture knowledge in the brain**, write each node's `detail` as a
  self-contained markdown description — 2–5 sentences covering *what it is, why it
  matters, and the source/context* (e.g. the meeting, decision, or bug it came from).
  The brain panel renders `detail` as markdown, so prefer `**bold**` lead-ins, short
  lists, and `code` over a bare phrase. Avoid terse one-liners like "PKCE flow".
- Keep the human informed with a `status` note (orchestrator-comms) and plain-text replies.
