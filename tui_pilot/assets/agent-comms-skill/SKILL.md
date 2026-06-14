---
name: agent-comms
description: Use ALWAYS while running under the tui-pilot control center — to ask a question, request context, ask for help, report progress, or finish.
---

# Talking to the control center

You run under an automated control center. To communicate, **write a JSON file**
into your outbox directory (it already exists — do NOT invent another path):

```
__OUTBOX__
```

Your agent id is `__AGENT_ID__`. Each signal is one file: `__OUTBOX__/<unique>.json`
(use a short unique name per signal, e.g. `q1.json`, `done.json`).

Shape:

```json
{ "id": "<unique>", "action": "...", "text": "...", "options": ["..."],
  "refs": ["/abs/path"], "report": "...md...",
  "next": {"role": "...", "task": "...", "mode": "...", "start": "confirm|auto"} }
```

Actions:

- **ask_question** — you need a decision. Add `"options"` for presets. THEN END
  YOUR TURN and wait; the answer arrives as your next message.
- **need_context** — missing info/files/credentials. END YOUR TURN and wait.
- **need_help** — stuck / blocked. Attach paths in `"refs"`. END YOUR TURN and wait.
- **progress** — status heartbeat. Do NOT wait; keep working.
- **finished** — mission complete. Always include `"report"` (Done / Current
  state / What's next / Open questions / Artifacts). Add `"next"` ONLY to request
  a successor agent.

Rules:

- Write to the exact `__OUTBOX__` path above — never create your own comms folder.
- One blocking signal at a time. After a blocking signal (ask_question /
  need_context / need_help), stop and wait for the reply — you'll receive it as
  your next user message. Do not poll your inbox.
