import { STATUSES } from "./types";
import type {
  BrainNode,
  BrainNodeType,
  PipelineRun,
  Project,
  StageState,
  Status,
  Task,
} from "./types";

const BRAIN_NODE_TYPES: BrainNodeType[] = [
  "feature",
  "decision",
  "convention",
  "feedback",
  "bug",
  "metric",
];

const GLYPH_PALETTE = ["#c9b8ff", "#7ad19a", "#f0c674", "#9bd1f0"] as const;

/** Group a task's brain nodes by type. All 6 type keys are always present. */
export function groupNodesByType(
  nodes: BrainNode[],
): Record<BrainNodeType, BrainNode[]> {
  const grouped = {} as Record<BrainNodeType, BrainNode[]>;
  for (const t of BRAIN_NODE_TYPES) grouped[t] = [];
  for (const node of nodes) {
    if (grouped[node.type]) grouped[node.type].push(node);
  }
  return grouped;
}

/** Build an id -> BrainNode lookup for resolving a task's grounded node ids. */
export function indexNodesById(nodes: BrainNode[]): Record<string, BrainNode> {
  const index: Record<string, BrainNode> = {};
  for (const node of nodes) index[node.id] = node;
  return index;
}

/**
 * Resolve grounded brain-node ids to their BrainNode objects, preserving the
 * id order and dropping any id with no match in the lookup.
 */
export function resolveNodes(
  ids: string[],
  byId: Map<string, BrainNode> | Record<string, BrainNode>,
): BrainNode[] {
  const lookup =
    byId instanceof Map
      ? (id: string) => byId.get(id)
      : (id: string) => byId[id];
  const out: BrainNode[] = [];
  for (const id of ids) {
    const node = lookup(id);
    if (node) out.push(node);
  }
  return out;
}

/** First letter of the project name, uppercased. Falls back to "?". */
export function projectGlyph(p: Project): string {
  const first = p.name.trim().charAt(0);
  return first ? first.toUpperCase() : "?";
}

/** Deterministic palette color picked by hashing the project id. */
export function projectColor(p: Project): string {
  let sum = 0;
  for (let i = 0; i < p.id.length; i++) sum += p.id.charCodeAt(i);
  return GLYPH_PALETTE[sum % GLYPH_PALETTE.length];
}

/** Kebab-case the project name: "Hello Spade (PoC)" -> "hello-spade-poc". */
export function projectSlug(p: Project): string {
  return p.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Bucket tasks into the 5 statuses. All keys present; unknown statuses ignored. */
export function tasksByStatus(tasks: Task[]): Record<Status, Task[]> {
  const buckets = {} as Record<Status, Task[]>;
  for (const s of STATUSES) buckets[s] = [];
  for (const task of tasks) {
    const bucket = buckets[task.status];
    if (bucket) bucket.push(task);
  }
  return buckets;
}

// -- pipeline (Orchestrator) adapters -----------------------------------------

/**
 * Map a backend stage state to its handoff visual token (key + token color).
 * done → green check, running → blue pulse, queued → muted dot, failed → amber gate.
 */
export function stageVisual(state: StageState): {
  key: "done" | "run" | "queue" | "gate";
  color: string;
} {
  switch (state) {
    case "done":
      return { key: "done", color: "var(--green)" };
    case "running":
      return { key: "run", color: "var(--blue)" };
    case "failed":
      return { key: "gate", color: "var(--amber)" };
    case "queued":
    default:
      return { key: "queue", color: "var(--text-3)" };
  }
}

/**
 * Short progress label for a run: "shipped" / "paused", else "step N/4" where N
 * is the 1-based index of the running stage, or the count of done stages when
 * none is running.
 */
export function runStepLabel(run: PipelineRun): string {
  if (run.status === "shipped") return "shipped";
  if (run.status === "paused") return "paused";
  const runningIdx = run.stages.findIndex((s) => s.state === "running");
  const n =
    runningIdx + 1 || run.stages.filter((s) => s.state === "done").length;
  return `step ${n}/4`;
}

/** session_id of the currently running stage (for the live terminal), or null. */
export function runActiveSession(run: PipelineRun): string | null {
  const running = run.stages.find((s) => s.state === "running");
  return running?.session_id ?? null;
}

/**
 * KPI roll-up over a list of runs:
 * - active: runs with status "running"
 * - gated: runs that are paused OR have any failed stage
 * - shipped: runs with status "shipped"
 * - queued: runs with status "queued"
 */
export function pipelineKpis(runs: PipelineRun[]): {
  active: number;
  gated: number;
  shipped: number;
  queued: number;
} {
  const kpis = { active: 0, gated: 0, shipped: 0, queued: 0 };
  for (const run of runs) {
    if (run.status === "running") kpis.active += 1;
    if (run.status === "shipped") kpis.shipped += 1;
    if (run.status === "queued") kpis.queued += 1;
    if (run.status === "paused" || run.stages.some((s) => s.state === "failed"))
      kpis.gated += 1;
  }
  return kpis;
}

/** Filter runs for the Orchestrator list. active = not shipped & not paused. */
export function filterRuns(
  runs: PipelineRun[],
  filter: "all" | "active" | "paused" | "shipped",
): PipelineRun[] {
  switch (filter) {
    case "active":
      return runs.filter(
        (r) => r.status !== "shipped" && r.status !== "paused",
      );
    case "paused":
      return runs.filter((r) => r.status === "paused");
    case "shipped":
      return runs.filter((r) => r.status === "shipped");
    case "all":
    default:
      return runs;
  }
}
