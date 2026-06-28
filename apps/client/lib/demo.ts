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

// ── Brain node enrichment (rich Explorer record) ────────────────────────────
// Deterministic seed keyed off the node id so values are stable. Real fields
// (label/type/detail/edges) always win; these fill the reference's rich record
// (owner / confidence / coverage / source / summary / code-surface / activity).
// BACKEND: node provenance, owner, confidence/coverage, code-surface, activity.
function hashId(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
const DEMO_OWNERS = ["Akira K.", "Dan R.", "Maya P.", "Robert M.", "Sam T."];
const DEMO_SOURCES = ["2 meetings · 4 PRs", "1 meeting · 2 PRs", "3 meetings · 1 PR", "GitHub · 6 commits", "Manual"];
const DEMO_TOUCHED = ["2 days ago", "4h ago", "yesterday", "1 week ago", "3 days ago"];
const DEMO_CONFIDENCE = [
  { label: "high", color: "var(--green)" },
  { label: "medium", color: "var(--amber)" },
  { label: "low", color: "var(--red)" },
];
const DEMO_FILES: [string, string, string][] = [
  ["app/checkout/page.tsx", "+12 −3", "rmurphy"],
  ["components/CartCarousel.tsx", "+62 −18", "claude/sess_8d2c"],
  ["lib/image/loader.ts", "+34 −6", "claude/sess_8d2c"],
  ["lib/stripe/payment-intent.ts", "+8 −2", "dan"],
  ["styles/checkout.module.css", "+4 −1", "maya"],
  ["app/api/webhook/route.ts", "+21 −0", "sam"],
];
const DEMO_ACTIVITY: [string, string, string][] = [
  ["today · 09:42", "var(--blue)", "Claude opened PR #2118 — “Optimize mobile checkout speed”"],
  ["today · 08:14", "var(--accent)", "Linked to meeting Sprint Planning · Mar 25"],
  ["Mar 21", "var(--teal)", "4 new feedback items clustered into “checkout slow on mobile”"],
  ["Jan 14", "var(--amber)", "Decision recorded · ADR-031 use lazy loading for product carousels"],
];

export type BrainNodeSeed = {
  owner: string;
  lastTouched: string;
  source: string;
  confidence: { label: string; color: string };
  coverage: number;
  summary: string;
  codeFiles: [string, string, string][];
  activity: [string, string, string][];
};

export function brainNodeSeed(id: string, detail?: string | null): BrainNodeSeed {
  const h = hashId(id);
  const fileCount = 4 + (h % 3);
  const start = h % DEMO_FILES.length;
  const codeFiles: [string, string, string][] = [];
  for (let i = 0; i < fileCount; i++) codeFiles.push(DEMO_FILES[(start + i) % DEMO_FILES.length]);
  return {
    owner: DEMO_OWNERS[h % DEMO_OWNERS.length],
    lastTouched: DEMO_TOUCHED[h % DEMO_TOUCHED.length],
    source: DEMO_SOURCES[h % DEMO_SOURCES.length],
    confidence: DEMO_CONFIDENCE[h % DEMO_CONFIDENCE.length],
    coverage: 60 + (h % 38),
    summary:
      detail ||
      "Core surface of the product, tracked as part of the active sprint with linked decisions, feedback and metrics.",
    codeFiles,
    activity: DEMO_ACTIVITY,
  };
}
