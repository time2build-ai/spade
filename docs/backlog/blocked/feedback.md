# Feedback — `/feedback`

**Status:** 🔴 Blocked (no backend). **Handoff:** `views/feedback.jsx`.

## What it is
Feedback clusters: label, linked feature, count, sentiment (neg/pos/feature), 7-day trend,
source breakdown (intercom/appstore/zendesk/playstore), and representative quotes per cluster
(platform, author, date, customer metadata).

## Why blocked
No feedback model or endpoints. `data.feedbackClusters` / `data.feedbackQuotes` are mock.
Sentiment, trends, and source breakdowns have no backing data.

## Backend needed first (rough)
- `feedback_quotes` table: `id, project_id, platform, author, body, sentiment, created_at,
  customer_meta`.
- `feedback_clusters` (or derive by clustering): `id, project_id, label, feature, count, trend`.
- Endpoints: `GET /feedback/clusters?project_id=`, `GET /feedback/clusters/{id}/quotes`.
- Clustering + sentiment likely an LLM/analysis job — overlaps with the LLM work.

## When unblocked — UI scope
Cluster list (sentiment color, trend sparkline, source chips, linked task) + a selected-cluster
quotes panel. Reuse `Chip`, `Card`.

## Honesty notes
A real feedback-quote feed could ship before clustering — an MVP could list raw quotes from a
single connected source without sentiment/trend, clearly omitting the analysis fields.
