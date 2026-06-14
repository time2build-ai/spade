---
name: orchestrator-comms
description: Orchestrator-only — extra actions to spawn, answer, kill, and narrate workers.
---

# Orchestrating workers

You manage workers by writing JSON files to your outbox (`__OUTBOX__`), in
addition to the normal agent-comms actions. One file per action:

- spawn   `{ "id":"...", "action":"spawn", "role":"developer", "model":"haiku|sonnet|opus",
            "task":"...", "mission":"<name>", "reason":"why this model", "cwd":"…?", "mode":"…?" }`
- answer  `{ "id":"...", "action":"answer", "worker":"<worker-id>", "text":"…" }`
            (for a permission prompt, text is "approve" or "deny")
- kill    `{ "id":"...", "action":"kill", "worker":"<worker-id>" }`
- status  `{ "id":"...", "action":"status", "text":"progress note for the human" }`

The control center executes each action and types results back to you (e.g. the
new worker's id, or a worker's forwarded question). Pick the cheapest model that
fits the task; justify any `opus`.
