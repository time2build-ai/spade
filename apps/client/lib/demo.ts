/**
 * Demo-data layer — mirrors the reference mockup's `SpadeData`
 * (`docs/Spade (standalone).html`). Per PLAN-V2.md the app must look identical
 * to the reference INCLUDING its rich data: screens render the full reference
 * look using real API data where it exists and these SEED values for everything
 * the API doesn't expose yet. Every export here is demo/seed data; backend
 * follow-ups (PLAN-V2 Phase 3) replace each behind the same component contract.
 *
 * Sourcing rule: prefer real, fall back to seed — `realValue ?? SEED`.
 */

/** Use the real value when present, otherwise the seed. */
export function seedFallback<T>(real: T | null | undefined, seed: T): T {
  return real === null || real === undefined ? seed : real;
}

/** Topbar sprint pill (reference `sprints[0]`). BACKEND: sprint-counter API. */
export const DEMO_SPRINT = {
  num: 26,
  dayLabel: "day 2/10",
  counter: "sprint 26 · day 2/10",
};

/** account label/email → usage % of the rate window. BACKEND: account usage. */
export const DEMO_ACCOUNT_USAGE: Record<string, number> = {
  "rmurphy@acme": 62,
  "rmurphy@acme.com": 62,
};

/** Default usage % when an account isn't in the map. */
export const DEMO_ACCOUNT_USAGE_DEFAULT = 62;

/** Reference sidebar badge values (project-scoped). */
export const DEMO_SIDEBAR_COUNTS: Record<string, number | string> = {
  sprints: 26,
  backlog: 23,
  brain: 847,
  graphIssues: 7,
  orchestrator: "7 live",
  agentPool: 10,
  gates: 2,
  meetings: 42,
  feedback: 312,
  decisions: 94,
};

/** Reference sidebar badge values (workspace-scoped). */
export const DEMO_WS_COUNTS = { agentsPool: 5, integrations: 7, projects: 4 };
