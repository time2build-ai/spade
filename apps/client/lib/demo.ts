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

// ── Backlog task card enrichment ────────────────────────────────────────────
// Real-wins: feedback/bug/decision/metric counts come from the task's linked
// brain nodes; meetings + assignee + flag are seeded. BACKEND: assignee, sprint,
// meeting links, card flag.
const DEMO_ASSIGNEES: ({ name: string; ai: boolean } | null)[] = [
  { name: "Claude · Developer", ai: true },
  { name: "Robert M.", ai: false },
  { name: "Maya P.", ai: false },
  { name: "Claude · Reviewer", ai: true },
  null,
];
const DEMO_FLAGS: (string | null)[] = [null, null, null, "needs spec", "stale 6d", null];

export type TaskCardSeed = {
  meetings: number;
  assignee: { name: string; ai: boolean } | null;
  flag: string | null;
};
export function taskCardSeed(id: string): TaskCardSeed {
  const h = hashId(id);
  return {
    meetings: h % 3,
    assignee: DEMO_ASSIGNEES[h % DEMO_ASSIGNEES.length],
    flag: DEMO_FLAGS[h % DEMO_FLAGS.length],
  };
}

// ── Task detail enrichment (reference mod_08) ───────────────────────────────
// The rich filler for the task page. Real fields (id/title/feature/priority/
// status/origin) win; these seed the feedback strip, quotes, architectural
// context, connected bugs, pipeline history, rich rail + tracked metric.
// BACKEND: assignee, sprint, estimate/branch, feedback quotes, metric series,
// pipeline-history events, write-back plan.
export type TaskDetailSeed = {
  createdFrom: string;
  feedbackCount: string;
  feedbackStats: { num: string; lbl: string }[];
  quotes: { q: string; src: string }[];
  decisions: { id: string; title: string; note: string; date: string }[];
  convention: { title: string; note: string; meta: string };
  bugs: { id: string; title: string }[];
  pipeline: { text: string; when: string; now?: boolean }[];
  assignee: { name: string; ai: boolean };
  sprint: string;
  estimate: string;
  branch: string;
  metric: { value: string; target: string; label: string; series: number[]; delta: string };
  writeBack: string;
};

export function taskDetailSeed(id: string): TaskDetailSeed {
  const slug = id.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return {
    createdFrom: "created from sprint planning · 14h ago",
    feedbackCount: "12 reports · 30d",
    feedbackStats: [
      { num: "12", lbl: "Intercom complaints" },
      { num: "★ 2.3", lbl: "App Store, mobile checkout" },
      { num: "34%", lbl: "Mobile conv (target 50%)" },
      { num: "8.4s", lbl: "P75 LCP, mobile" },
    ],
    quotes: [
      { q: "Checkout is unusable on my phone, takes like 8 seconds to even load.", src: "Intercom · Mar 21" },
      { q: "Why does the cart page jank so badly on iPhone? It used to be fine.", src: "App Store · Mar 18" },
      { q: "I’ve abandoned 3 carts this week because of how slow the images load.", src: "Intercom · Mar 17" },
    ],
    decisions: [
      { id: "ADR-031", title: "Use lazy loading for product carousels", note: "approved over CDN-only approach", date: "Jan 14" },
      { id: "ADR-018", title: "Image pipeline serves WebP via CDN", note: "Cloudflare Workers rewrite path", date: "Nov 09" },
    ],
    convention: { title: "CSS variables for design tokens", note: "All new components must consume tokens, not raw values.", meta: "47 files" },
    bugs: [
      { id: "BUG-1109", title: "Carousel images not compressed on mobile" },
      { id: "BUG-1142", title: "Hero image blocks LCP on slow 3G" },
      { id: "BUG-1153", title: "Apple Pay sheet layout shift" },
    ],
    pipeline: [
      { text: "Task created from Sprint Planning · Mar 25", when: "14h ago · auto from transcript" },
      { text: "Linked to 12 feedback items, 3 bugs, 2 decisions", when: "14h ago · semantic match" },
      { text: "Picked up by Claude · Developer in sess_8d2c", when: "9m ago" },
      { text: "Building — IntersectionObserver, WebP rewrite, image compression", when: "live · 412 lines streamed", now: true },
    ],
    assignee: { name: "Claude · Developer", ai: true },
    sprint: "26",
    estimate: "~25 min",
    branch: `spd/${slug}-mobile-lcp`,
    metric: {
      value: "34%",
      target: "target 50%",
      label: "Mobile checkout conversion",
      series: [42, 40, 41, 39, 40, 38, 37, 38, 36, 35, 36, 34, 34],
      delta: "↓ 4.2pp / 30d",
    },
    writeBack:
      "On merge, Spade will document the lazy-load implementation, update the Checkout feature page, link this PR to the originating meeting, and resolve BUG-1109, BUG-1142, BUG-1153.",
  };
}

// ── Orchestrator run enrichment + KPI subs ──────────────────────────────────
// Real wins (task/stages/status/account); cost/eta/progress/tokens/files/logs
// + KPI sub-lines are seeded. BACKEND: pipeline cost/eta/progress/tokens/files/
// logs columns + tables.
export type OrchLogLine = { lvl: "info" | "tool" | "warn" | "ok"; t: string; msg: string };
export type OrchRunSeed = {
  cost: string;
  eta: string;
  progress: number;
  tokens: string;
  files: [string, string][];
  logs: OrchLogLine[];
};
const ORCH_LOGS: OrchLogLine[] = [
  { lvl: "info", t: "09:42:11", msg: "orchestrator: pipeline run --sprint started by rmurphy" },
  { lvl: "tool", t: "09:42:12", msg: "task.next → SPD-142  Optimize mobile checkout speed" },
  { lvl: "info", t: "09:42:12", msg: "session.spawn role=Developer task=SPD-142 → sess_8d2c" },
  { lvl: "tool", t: "09:42:14", msg: "sess_8d2c product.context → 4.2 KB · feature=Checkout" },
  { lvl: "info", t: "09:43:24", msg: "sess_8d2c edit lib/image/loader.ts (+34 −6)" },
  { lvl: "warn", t: "09:43:38", msg: "acct lab@acme: rate-limit · cooling 5h" },
  { lvl: "info", t: "09:43:39", msg: "handoff lab → rmurphy on session sess_8d2c" },
  { lvl: "ok", t: "09:44:12", msg: "sess_8d2c PR opened #2118 · +213 −62" },
];
export function orchRunSeed(id: string): OrchRunSeed {
  const h = hashId(id);
  return {
    cost: `$${(1 + (h % 800) / 100).toFixed(2)}`,
    eta: `${1 + (h % 9)}m`,
    progress: 20 + (h % 70),
    tokens: `~${60 + (h % 40)}k in / ${8 + (h % 14)}k out`,
    files: [
      ["lib/image/loader.ts", "+34 −6"],
      ["components/CartCarousel.tsx", "+62 −18"],
      ["app/checkout/page.tsx", "+12 −3"],
      ["styles/checkout.module.css", "+4 −1"],
    ],
    logs: ORCH_LOGS,
  };
}
/** Seeded KPI cells (with sub-lines) for the orchestrator summary strip. */
export const DEMO_ORCH_KPIS = [
  { lbl: "Tokens · 24h", val: "2.1M", sub: "≈ $14.20", subMono: true },
  { lbl: "Throughput", val: "5 / day", sub: "7d avg" },
  { lbl: "Concurrency cap", val: "8 / 12", sub: "CPU 41%" },
];

// ── Agent pool account enrichment + executions ──────────────────────────────
// Real wins (label/provider/color, in-use from sessions); role/usage/model/plan/
// current-issue + the executions table are seeded. BACKEND: per-account usage/
// role/model/plan + executions.
export const ROLE_META: Record<string, { color: string }> = {
  Orchestrator: { color: "var(--accent)" },
  Developer: { color: "var(--blue)" },
  Reviewer: { color: "var(--pink)" },
  Integrator: { color: "var(--teal)" },
  Documentor: { color: "var(--accent)" },
  Fallback: { color: "var(--text-3)" },
};
const DEMO_ROLES = ["Orchestrator", "Developer", "Reviewer", "Integrator", "Documentor", "Fallback"];
const DEMO_MODELS = ["claude-opus-4", "claude-sonnet-4", "gpt-4o", "gemini-2.0", "claude-haiku"];
const DEMO_PLANS = ["Max", "Pro", "Team", "Free"];
const DEMO_ISSUE_TITLES = ["Optimize mobile checkout speed", "Receipt template missing taxes", "Cart drawer flicker on open"];

export type AccountSeed = {
  role: string;
  usage: number;
  model: string;
  plan: string;
  currentIssue: { id: string; title: string; nodes: string[] } | null;
};
export function accountSeed(id: string): AccountSeed {
  const h = hashId(id);
  const idle = h % 3 === 0;
  return {
    role: DEMO_ROLES[h % DEMO_ROLES.length],
    usage: 20 + (h % 75),
    model: DEMO_MODELS[h % DEMO_MODELS.length],
    plan: DEMO_PLANS[h % DEMO_PLANS.length],
    currentIssue: idle
      ? null
      : {
          id: `AI-ISS-${230 + (h % 20)}`,
          title: DEMO_ISSUE_TITLES[h % DEMO_ISSUE_TITLES.length],
          nodes: ["f-checkout", "d-031", "b-1142", "m-conv"].slice(0, 1 + (h % 3)),
        },
  };
}

export type Execution = { id: string; role: string; task: string; elapsed: string; nodes: string[] };
export const DEMO_EXECUTIONS: Execution[] = [
  { id: "AI-ISS-241", role: "Reviewer", task: "SPD-142", elapsed: "4m 12s", nodes: ["f-checkout", "d-031", "b-1142"] },
  { id: "AI-ISS-240", role: "Developer", task: "SPD-141", elapsed: "2m 03s", nodes: ["f-email", "d-022"] },
  { id: "AI-ISS-238", role: "Developer", task: "SPD-137", elapsed: "8m 47s", nodes: ["f-cart", "b-1109"] },
  { id: "AI-ISS-237", role: "Documentor", task: "SPD-146", elapsed: "1m 21s", nodes: ["f-search", "c-api"] },
  { id: "AI-ISS-235", role: "Developer", task: "SPD-145", elapsed: "5m 30s", nodes: ["f-checkout", "b-1153"] },
];

// ── Decision (ADR) enrichment ───────────────────────────────────────────────
// Real wins (label/detail/created_at/edges); status/owner/feature/conflict + the
// narrative sections are seeded. Status is deterministic per id so the list
// filter works. BACKEND: ADR status/owner/narrative + lifecycle.
export type DecisionStatus = "active" | "proposed" | "superseded";
const DEMO_DEC_STATUS: DecisionStatus[] = ["active", "active", "proposed", "superseded"];
const DEMO_DEC_FEATURES = ["Checkout", "Search", "Email", "Cart", "Recommendations"];

export type DecisionSeed = {
  status: DecisionStatus;
  owner: string;
  feature: string;
  conflict: string | null;
  summary: { k: string; v: string }[];
  drivers: string[];
  consequences: { good: string[]; bad: string[]; neutral: string[] };
  alternatives: { title: string; note: string }[];
  validation: string[];
  provenance: { k: string; v: string }[];
  changelog: { date: string; text: string }[];
};

export function decisionSeed(id: string): DecisionSeed {
  const h = hashId(id);
  const status = DEMO_DEC_STATUS[h % DEMO_DEC_STATUS.length];
  const owner = DEMO_OWNERS[h % DEMO_OWNERS.length];
  return {
    status,
    owner,
    feature: DEMO_DEC_FEATURES[h % DEMO_DEC_FEATURES.length],
    conflict: h % 4 === 0 ? `ADR-0${10 + (h % 9)}` : null,
    summary: [
      { k: "Status", v: status },
      { k: "Owner", v: owner },
      { k: "Decided", v: "Mar 25, 2026" },
      { k: "Supersedes", v: h % 3 === 0 ? "ADR-014" : "—" },
    ],
    drivers: [
      "Mobile conversion is the headline metric this sprint.",
      "12 feedback reports correlate slow image load with cart abandonment.",
      "The existing CDN-only approach can't meet the LCP target on 3G.",
    ],
    consequences: {
      good: ["LCP drops ~2.1s on P75 mobile.", "Carousel images defer until in-viewport."],
      bad: ["Adds an IntersectionObserver dependency.", "Above-the-fold still needs eager-load."],
      neutral: ["No change to the desktop render path."],
    },
    alternatives: [
      { title: "CDN-only resize", note: "Rejected — doesn't address render-blocking." },
      { title: "Server-side priority hints", note: "Deferred — larger change, revisit next sprint." },
    ],
    validation: [
      "Lighthouse mobile LCP < 2.5s on the checkout route.",
      "No regression in desktop conversion (A/B, 1 week).",
    ],
    provenance: [
      { k: "Originated", v: "Sprint Planning · Mar 25" },
      { k: "Author", v: owner },
      { k: "Session", v: "sess_8d2c" },
    ],
    changelog: [
      { date: "Mar 25", text: "Proposed by Claude · Reviewer" },
      { date: "Mar 26", text: "Approved over the CDN-only approach" },
    ],
  };
}

// ── Ask chat threads (full /ask page) ───────────────────────────────────────
// Seeded threads + rich messages (cites / plan / ADR-EDIT diff cards). The live
// dock still sends to the real orchestrator; the /ask page is a seeded session
// browser. BACKEND: chat thread persistence + structured tool-output.
export type ChatMsg = {
  role: "user" | "assistant";
  who: string;
  t: string;
  text: string;
  cites?: string[];
  plan?: { title: string; steps: string[] };
  action?: { kind: string; id: string; risk: string; title: string; remove: string[]; add: string[] };
};
export type ChatThread = { id: string; title: string; project: string; updated: string; pinned?: boolean; messages: ChatMsg[] };
export const DEMO_THREADS: ChatThread[] = [
  {
    id: "th-1", title: "Lazy-load decision review", project: "Checkout", updated: "2m ago", pinned: true,
    messages: [
      { role: "user", who: "Robert", t: "08:44", text: "Can we tighten the lazy-load threshold for carousels?" },
      { role: "assistant", who: "Spade · Claude", t: "08:46", text: "Drafted. Here's the diff:", action: { kind: "ADR-EDIT", id: "ADR-031", risk: "med", title: "Add viewport-aware caveat to lazy-load threshold", remove: ["Lazy-load any carousel containing more than 3 items."], add: ["Lazy-load any carousel containing more than 3 items on viewports ≤ 768px.", "On desktop, eager-load is permitted up to 6 items."] } },
      { role: "user", who: "Robert", t: "08:50", text: "looks good. send to gates for Akira to review" },
    ],
  },
  {
    id: "th-2", title: "Why is mobile conversion down?", project: "Checkout", updated: "1h ago",
    messages: [
      { role: "user", who: "Robert", t: "07:10", text: "Why is mobile conversion down this sprint?" },
      { role: "assistant", who: "Spade · Claude", t: "07:11", text: "Three signals point at checkout image load.", cites: ["fb-1", "m-conv", "b-1142"], plan: { title: "Investigate mobile checkout LCP", steps: ["Pull P75 LCP for /checkout (mobile)", "Correlate with the 12 Intercom reports", "Check ADR-031 carousel lazy-load coverage"] } },
    ],
  },
  {
    id: "th-3", title: "Sprint 26 standup summary", project: "Workspace", updated: "yesterday",
    messages: [
      { role: "user", who: "Robert", t: "Mar 25", text: "Summarize today's standup." },
      { role: "assistant", who: "Spade · Claude", t: "Mar 25", text: "3 tasks shipped, 1 gate pending (SPD-144), 2 new feedback clusters." },
    ],
  },
];

// ── Accounts (standalone) — strategies + handoffs ───────────────────────────
// Seeded. BACKEND: dispatch-strategy persistence + handoff log.
export const DEMO_STRATEGIES = [
  { id: "round-robin", label: "Round-robin", desc: "Even spread across the pool" },
  { id: "cost-aware", label: "Cost-aware", desc: "Cheapest capable account first" },
  { id: "capability", label: "Capability-match", desc: "Route by role strengths" },
  { id: "manual", label: "Manual", desc: "Pin tasks to accounts" },
];
export type Handoff = { from: string; to: string; reason: string; when: string };
export const DEMO_HANDOFFS: Handoff[] = [
  { from: "lab@acme", to: "rmurphy@acme", reason: "rate-limit · cooling 5h", when: "9m ago" },
  { from: "rmurphy@acme", to: "dan@acme", reason: "capability: multi-file edit", when: "32m ago" },
  { from: "dan@acme", to: "lab@acme", reason: "round-robin", when: "1h ago" },
  { from: "maya@acme", to: "rmurphy@acme", reason: "account exhausted", when: "2h ago" },
];

// ── Gate conflict (bespoke conflict screen) ─────────────────────────────────
// Seeded conflict; the task card hydrates from a real brake when present.
// BACKEND: structured Brake conflict payload.
export const DEMO_GATE = {
  taskId: "SPD-144",
  taskTitle: "Improve recommendation click-through",
  taskDetail: "Developer session sess_4f12 proposed switching from collaborative filtering to a content-based recommender to lift CTR.",
  worker: "sess_4f12",
  existing: {
    title: "ADR-014 · Use collaborative filtering for recommendations",
    meta: "Jan 14, 2026 · Architecture review · Status active",
    quote: "We chose collaborative filtering over content-based to avoid building a content embedding pipeline this quarter.",
    owner: "Akira, decision owner",
  },
  proposed: {
    title: "Switch to content-based recommender",
    meta: "From sess_4f12 · 11m ago",
    quote: "CTR is 2.1%. A content-based model using product titles + tags should outperform on the cold-start segment driving most homepage misses.",
    owner: "Reviewer rationale",
  },
  diff: [
    { t: "ctx", ln: "12", text: 'import { embed } from "@/lib/reco/collab";' },
    { t: "del", ln: "−", text: "  const candidates = await collabFilter.candidates(userId, 50);" },
    { t: "add", ln: "+", text: "  const candidates = await contentBased.candidates(userId, 50);" },
    { t: "ctx", ln: "14", text: "  const ranked = ranker.rank(candidates, ctx);" },
    { t: "ctx", ln: "15", text: "  return ranked.slice(0, limit);" },
  ],
  signals: [
    { label: "User feedback", big: "8", sub: "reports about weak recs · 30d", color: "var(--blue)" },
    { label: "Metric impact", big: "2.1%", sub: "recommendation CTR · target 5%", color: "var(--teal)" },
    { label: "Decision age", big: "101 d", sub: "since ADR-014 was recorded", color: "var(--amber)" },
  ],
  suggestion: "approve as a scoped experiment behind a feature flag, then re-evaluate ADR-014 after 14 days. Spade will draft ADR-046 (proposed) if you accept.",
};

// ── Home dashboard (cross-project triage) ───────────────────────────────────
// Seeded triage feed + KPI band + per-project meta. Real project list wins.
// BACKEND: cross-project triage aggregation + project meta.
export type TriageItem = { kind: string; title: string; project: string; meta: string; sev: "high" | "med" | "low" };
export const TRIAGE_KIND_COLOR: Record<string, string> = {
  gate: "var(--amber)", bug: "var(--red)", feedback: "var(--blue)", decision: "var(--accent)", metric: "var(--teal)", meeting: "var(--pink)",
};
export const DEMO_TRIAGE: TriageItem[] = [
  { kind: "gate", title: "SPD-144 paused — conflicts with ADR-014", project: "Acme Storefront", meta: "needs a human call", sev: "high" },
  { kind: "bug", title: "Apple Pay sheet layout shift on iOS Safari", project: "Acme Storefront", meta: "BUG-1153 · no root cause", sev: "high" },
  { kind: "feedback", title: "12 reports: checkout slow on mobile", project: "Acme Storefront", meta: "Intercom · 30d", sev: "med" },
  { kind: "metric", title: "Mobile checkout conversion at 34%", project: "Acme Storefront", meta: "target 50% · ↓ 4.2pp", sev: "high" },
  { kind: "decision", title: "ADR-031 needs a viewport-aware caveat", project: "Acme Storefront", meta: "drafted by Claude", sev: "med" },
  { kind: "feedback", title: "8 reports: recommendations feel random", project: "Beta App", meta: "App Store · 14d", sev: "med" },
  { kind: "bug", title: "Cart drawer flicker on first open", project: "Acme Storefront", meta: "BUG-1109 · auto-linked", sev: "low" },
  { kind: "meeting", title: "Sprint Planning · Mar 25 — 6 tasks created", project: "Acme Storefront", meta: "auto from transcript", sev: "low" },
  { kind: "metric", title: "Recommendation CTR regression (2.1%)", project: "Beta App", meta: "target 4%", sev: "med" },
  { kind: "gate", title: "Beta deploy waiting on review", project: "Beta App", meta: "SPD-301", sev: "med" },
  { kind: "decision", title: "Document {data,error,meta} envelope gap", project: "Acme Storefront", meta: "convention drift", sev: "low" },
  { kind: "feedback", title: "5 reports: receipts missing line-item taxes", project: "Acme Storefront", meta: "Intercom", sev: "med" },
  { kind: "bug", title: "Hero image blocks LCP on slow 3G", project: "Acme Storefront", meta: "BUG-1142", sev: "high" },
];
export const DEMO_HOME_KPIS = [
  { lbl: "Open triage", val: "13", sub: "across 2 projects" },
  { lbl: "Gates pending", val: "2", sub: "need a human", color: "var(--amber)" },
  { lbl: "Shipped · 7d", val: "18", sub: "+24% vs prev", color: "var(--green)" },
  { lbl: "Active agents", val: "7", sub: "3 accounts" },
  { lbl: "Tokens · 24h", val: "2.1M", sub: "≈ $14.20" },
];
export type ProjectMeta = { state: string; sprint: string; backlog: number; brain: number; workers: number };
export function projectMeta(id: string): ProjectMeta {
  const h = hashId(id);
  return {
    state: ["active", "active", "paused"][h % 3],
    sprint: `${24 + (h % 4)}`,
    backlog: 12 + (h % 30),
    brain: 200 + (h % 800),
    workers: 1 + (h % 5),
  };
}

// ── AI-generated issues (Graph & Issues pane) ───────────────────────────────
// Seeded; BACKEND: AI-issue synthesis + lifecycle (validate/reject/open-task).
export type AiIssueStatus = "validated" | "pending" | "rejected";
export type AiIssue = {
  id: string;
  title: string;
  role: string;
  status: AiIssueStatus;
  confidence: number;
  summary: string;
  agent: string;
};
export const AI_ISSUE_STATUS: Record<AiIssueStatus, { color: string; glyph: string; label: string }> = {
  validated: { color: "var(--green)", glyph: "●", label: "validated" },
  pending: { color: "var(--amber)", glyph: "○", label: "awaiting validation" },
  rejected: { color: "var(--red)", glyph: "✕", label: "rejected" },
};
export const DEMO_AI_ISSUES: AiIssue[] = [
  { id: "AI-ISS-241", title: "Lazy-loaded carousel violates ADR-031 on slow 3G", role: "Reviewer", status: "validated", confidence: 92, summary: "Hero image still blocks LCP despite lazy-load policy. Cluster of 12 feedback reports correlates with conversion drop.", agent: "Claude · Reviewer" },
  { id: "AI-ISS-240", title: "Receipt template missing line-item taxes", role: "Developer", status: "validated", confidence: 88, summary: "5 customer reports of incomplete receipts. PaymentIntent already exposes tax breakdown — only the template needs the field.", agent: "Claude · Developer" },
  { id: "AI-ISS-239", title: "Recommendations CTR regression — experiment ready", role: "Developer", status: "pending", confidence: 71, summary: "Reco CTR at 2.1% (target 4%). 8 feedback items echo “feels random”. ADR-014 may conflict — proposes scoped A/B.", agent: "Claude · Developer" },
  { id: "AI-ISS-238", title: "Cart drawer flicker on first open", role: "Developer", status: "validated", confidence: 84, summary: "Drawer mounts before hydration completes. 4 user reports, all on first session of the day.", agent: "Claude · Developer" },
  { id: "AI-ISS-237", title: "Document {data,error,meta} envelope in search", role: "Documentor", status: "pending", confidence: 64, summary: "Search endpoints still return bare arrays. Convention is enforced elsewhere; ADR docs should reflect the gap.", agent: "Gemini · Documentor" },
  { id: "AI-ISS-235", title: "Apple Pay sheet causes layout shift on iOS Safari", role: "Developer", status: "pending", confidence: 78, summary: "Bug filed but no root cause linked. Pattern matches a known PaymentRequest bug on iOS 17.4.", agent: "Codex · Developer" },
  { id: "AI-ISS-236", title: "Promote design-token usage to onboarding", role: "Integrator", status: "rejected", confidence: 52, summary: "Onboarding still uses hex literals. Cross-cut refactor flagged out-of-scope for sprint 26.", agent: "Cursor · Integrator" },
];

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
