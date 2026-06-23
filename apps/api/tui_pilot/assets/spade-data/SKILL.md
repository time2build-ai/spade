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
# add a brain node / edge
curl -s -X POST $B/brain/nodes -H 'content-type: application/json' -d '{"project_id":"<id>","type":"decision","label":"ADR-1 ...","detail":"..."}'
curl -s -X POST $B/brain/edges -H 'content-type: application/json' -d '{"project_id":"<id>","from_id":"<a>","to_id":"<b>","rel":"decided_by"}'
# RUN a task through the 4-stage agent pipeline (Developer→Reviewer→Integrator→Documentor)
RID=$(curl -s -X POST $B/pipelines -H 'content-type: application/json' -d '{"project_id":"<id>","task_id":"<task_id>"}' | jq -r .id)
curl -s -X POST $B/pipelines/$RID/start    # spawns the developer agent; auto-advances on finish
```

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
- Keep the human informed with a `status` note (orchestrator-comms) and plain-text replies.
