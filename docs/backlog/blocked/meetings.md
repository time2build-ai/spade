# Meetings — `/meetings`

**Status:** 🔴 Blocked (no backend). **Handoff:** `views/meetings.jsx` (the most state-nuanced view).

## What it is
Meeting ingestion: a list of meetings (source granola/fathom/otter, duration, participants,
extracted task/decision/question counts, fidelity badge), and a two-column transcript +
extraction detail with inline highlights that link to created tasks.

## Why blocked
No meetings data model or endpoints exist. `data.meetings` in the handoff is entirely mock.
The transcript/extraction/fidelity machinery has no backend at all.

## Backend needed first (rough)
- A `meetings` table: `id, project_id, source, title, duration, started_at, participants,
  fidelity (transcript|summary|outcomes_only|metadata_only|processing)`.
- Extracted-items linkage: meeting → created tasks/decisions (could reuse `task.origin_source`
  / brain nodes with a `source_meeting_id`).
- Endpoints: `GET /meetings?project_id=`, `GET /meetings/{id}` (with transcript + extraction),
  and an ingestion path (upload/connect a source).
- Likely an LLM extraction step (transcript → tasks/decisions) — overlaps with Ask/LLM work.

## When unblocked — UI scope
List with fidelity badges + lower-fidelity fallbacks (banners/skeletons/summary-only), and the
two-column transcript with `<mark>` highlights + hover popovers to the created task. Reuse `Chip`, `Card`.

## Honesty notes
Do NOT build this against fabricated meetings. It needs the data model first.
