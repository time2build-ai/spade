---
name: planning
description: Turn a goal, feature, or initiative the human describes into a structured backlog — a small set of dependency-linked Spade tasks. Use whenever the human asks you to plan, break down, scope, or "figure out how to build" something, or describes work they want to make real. Always brainstorm + propose before creating anything.
---

# Planning work into the backlog

When the human describes something they want to build ("build the client-context API + an
MCP", "plan out onboarding", "break this down"), DON'T just start spawning agents or
creating tasks. Run a short, disciplined planning process and turn the result into real
Spade backlog tasks with explicit dependencies. This mirrors a brainstorm → plan → tasks
workflow.

The API base is `__API_BASE__` (call it `$B`). Use the **spade-data** skill for the exact
task/link/pipeline endpoints. The current project is whatever `$B/current-project` reports.

## The process (always in this order)

### 1. Ground yourself first
Read the current state before planning so the plan fits what exists — don't duplicate or
contradict it:
```
PID=$(curl -s $B/current-project | jq -r .project_id)
curl -s "$B/tasks?project_id=$PID"        # existing backlog
curl -s "$B/brain/nodes?project_id=$PID"  # product brain (features/decisions/etc.)
```

### 2. Clarify (only if genuinely needed)
Ask **1–3 sharp questions** ONLY when the goal is too ambiguous to plan well — scope,
hard constraints, what "done" looks like. If the goal is already clear, skip straight to
the proposal. Never interrogate; respect the human's time.

### 3. Propose — DO NOT create yet
Reply with a concise plan **as a message** and stop. Include:
- A one-line restatement of the goal + any assumptions.
- The **task breakdown**: a short, YAGNI list. For each task: a title, the feature it
  belongs to, priority (`0`=P0 … `3`), and a one-line description. Prefer the *smallest*
  set of well-bounded tasks that actually delivers the goal.
- The **structure / dependencies**, stated explicitly:
  - an optional **epic** with **subtasks** under it,
  - which tasks **block** which (ordering: a blocker must finish before the thing it
    blocks),
  - any **related** tasks.
Present it clearly (a short list + the dependency lines). Then ask the human to approve or
edit. **Wait for their go.** Revise and re-propose if they change it.

### 4. Create — only after approval
On approval, create everything via the API and capture the returned ids:
```
# one task (repeat per task; save each returned id)
TID=$(curl -s -X POST $B/tasks -H 'content-type: application/json' \
  -d '{"project_id":"'"$PID"'","title":"Wire up client-context API","feature":"Context API","priority":1,"description":"..."}' | jq -r .id)

# link tasks — rel is blocks | related | subtask. "A blocks B" = A must finish first.
# "EPIC subtask CHILD" = EPIC is the parent of CHILD.
curl -s -X POST $B/tasks/$EPIC/links   -H 'content-type: application/json' -d '{"to_task":"'"$CHILD"'","rel":"subtask"}'
curl -s -X POST $B/tasks/$BLOCKER/links -H 'content-type: application/json' -d '{"to_task":"'"$BLOCKED"'","rel":"blocks"}'
curl -s -X POST $B/tasks/$A/links      -H 'content-type: application/json' -d '{"to_task":"'"$B2"'","rel":"related"}'
```
Order of creation: create the epic first, then the child tasks, then add the `subtask`
links from epic→child, then the `blocks`/`related` links between children. Set every
task's `project_id` to the current project.

### 5. Confirm
Report back the **real created ids** (e.g. "Created SPD-006…SPD-010") with a one-line
summary of the structure, and offer the obvious next step — e.g. running the first
unblocked task through a pipeline (`POST $B/pipelines` then `/start`, see spade-data).

## Rules
- **Brainstorm intent before structure.** Understand the *why* and the success criteria,
  then decompose. Don't pad the plan — YAGNI; cut anything that doesn't serve the goal.
- **Decompose into small, independently-shippable tasks** with clear boundaries. A task
  that's really an epic should become an epic + subtasks.
- **Make dependencies explicit and minimal** — only real ordering constraints become
  `blocks`. Don't invent links.
- **Never create tasks before the human approves the proposal.** Only create what was
  approved; report the real ids — never claim work you didn't do.
