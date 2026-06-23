# Ask / chat — `/ask` (+ floating bubble / dock)

**Status:** 🔴 Blocked (no backend). **Handoff:** `views/ask.jsx`, `views/chat-panel.jsx`, `views/chat-bubble.jsx`.

## What it is
Full-page conversational interface to the brain: threads list · chat stream · context sidebar.
Assistant messages carry citation chips (adr/task/meeting/feedback), plan cards, and action
cards (e.g. a proposed ADR edit with a risk level + inline diff that can be sent to gates).
The same chat UI reused as a floating bubble and a right-side dock app-wide.

## Why blocked
There is no chat/LLM endpoint and no chat-thread persistence. `data.chatThreads` is mock.
"Ask the brain" requires a grounded (RAG-over-brain) LLM call the backend doesn't expose.

## Backend needed first (rough)
- A grounded ask endpoint: `POST /ask` `{ project_id, message, thread_id? }` → streamed
  assistant message + citations (brain node / task / decision IDs it grounded on). Uses the
  brain graph as retrieval context. (Build with the latest Claude model per the project's
  AI guidance.)
- `chat_threads` + `chat_messages` persistence; `GET /threads`, `GET /threads/{id}`.
- Action cards (propose ADR edit → gate) would tie into brakes/decisions write paths.

## When unblocked — UI scope
Three columns (threads · stream · context). Citation chips link into the live views (reuse
`Chip`, navigate to `/task/[id]`, `/decisions`, `/brain`). Composer `@`-mention autocomplete of
brain entities. Then reuse the stream in the global bubble/dock chrome.

## Honesty notes
This is the keystone for several other items: the Home "AI Brief", meeting/feedback extraction,
and action-card→gate flows all lean on the same grounded-LLM capability. Worth building the
`POST /ask` endpoint first as a shared primitive.
