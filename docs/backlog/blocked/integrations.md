# Integrations — `/integrations`

**Status:** 🔴 Blocked (no backend). **Handoff:** `views/integrations.jsx`.

## What it is
Connection-aware integration catalog grouped by category (Meetings, Feedback, Code, PM,
Observability, Analytics). Each integration type expands to individual connections (identity,
workspace-vs-project scope, health pill ok/warn/stale, last-sync time, "used by N projects").

## Why blocked
No integrations/connections model or endpoints. `data.integrations` is mock. There is no
connect/OAuth flow, health, or sync state in the backend.

## Backend needed first (rough)
- An `integrations`/`connections` model: `id, type, category, scope (workspace|project),
  identity, status (ok|warn|stale), last_sync_at, project_id?`.
- Endpoints: `GET /integrations`, `GET /integrations/{type}/connections`, and a connect flow
  (OAuth/credential exchange) per provider.
- This is a large surface — most categories (Meetings/Feedback/PM/Observability) also need
  their own ingestion backends (see meetings.md / feedback.md). Integrations is effectively the
  front door to all the other blocked views.

## When unblocked — UI scope
Category-grouped `int-type-card`s expanding to `int-conn` rows with health pills + last-sync;
disconnected services as dimmed connect CTAs. Reuse `Card`, `Chip`, `TogglePill`.

## Honesty notes
The biggest fabrication risk in the handoff — every connection here is mock. Build only once a
real connections registry + at least one working provider exists.
