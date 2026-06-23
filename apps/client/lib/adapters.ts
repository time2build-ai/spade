import { STATUSES } from "./types";
import type {
  BrainNode,
  BrainNodeType,
  PipelineRun,
  Project,
  Session,
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

// -- brain (Product Brain graph) adapters -------------------------------------

/** Count nodes per type. All 6 type keys are always present (0 if none). */
export function nodeTypeCounts(
  nodes: BrainNode[],
): Record<BrainNodeType, number> {
  const counts = {} as Record<BrainNodeType, number>;
  for (const t of BRAIN_NODE_TYPES) counts[t] = 0;
  for (const node of nodes) {
    if (node.type in counts) counts[node.type] += 1;
  }
  return counts;
}

/** Token color var for a brain node type (drives node + legend colors). */
export function nodeColor(type: BrainNodeType): string {
  switch (type) {
    case "feature":
      return "var(--accent)";
    case "decision":
      return "var(--amber)";
    case "feedback":
      return "var(--blue)";
    case "bug":
      return "var(--red)";
    case "metric":
      return "var(--teal)";
    case "convention":
      return "var(--pink)";
  }
}

export type LaidOutNode = BrainNode & { px: number; py: number };

/**
 * Map each node's x/y into pixel coords within [pad, size-pad]. Present coords
 * are normalized against the min..max of all present coords (a single value or
 * a zero range maps to the center). Nodes missing x or y fall back to a
 * deterministic circle layout by index. Pure + deterministic.
 */
export function layoutNodes(
  nodes: BrainNode[],
  width: number,
  height: number,
  pad = 40,
): LaidOutNode[] {
  const xs = nodes
    .map((n) => n.x)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const ys = nodes
    .map((n) => n.y)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));

  const minX = xs.length ? Math.min(...xs) : 0;
  const maxX = xs.length ? Math.max(...xs) : 1;
  const minY = ys.length ? Math.min(...ys) : 0;
  const maxY = ys.length ? Math.max(...ys) : 1;

  const innerW = Math.max(0, width - pad * 2);
  const innerH = Math.max(0, height - pad * 2);

  const scale = (v: number, min: number, max: number, inner: number) => {
    const range = max - min;
    const t = range === 0 ? 0.5 : (v - min) / range;
    return pad + t * inner;
  };

  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(innerW, innerH) / 2;
  const count = nodes.length || 1;

  return nodes.map((node, i) => {
    const hasCoords =
      typeof node.x === "number" &&
      Number.isFinite(node.x) &&
      typeof node.y === "number" &&
      Number.isFinite(node.y);
    if (hasCoords) {
      return {
        ...node,
        px: scale(node.x as number, minX, maxX, innerW),
        py: scale(node.y as number, minY, maxY, innerH),
      };
    }
    // Deterministic radial fallback for null coords.
    const angle = (i / count) * Math.PI * 2;
    return {
      ...node,
      px: cx + Math.cos(angle) * radius,
      py: cy + Math.sin(angle) * radius,
    };
  });
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

// -- agent pool (live fleet) adapters -----------------------------------------

/**
 * Derive a display status for a live session from its real fields. A dead
 * session (alive=false) is always muted. Otherwise the prep lifecycle drives it:
 * error→red, working→blue, ready→green, booting/priming→amber. When prep is
 * null we fall back to the raw `state` string in a muted color.
 */
export function sessionStatusVisual(s: Session): {
  label: string;
  color: string;
} {
  if (!s.alive) return { label: "dead", color: "var(--text-4)" };
  switch (s.prep) {
    case "error":
      return { label: "error", color: "var(--red)" };
    case "working":
      return { label: "working", color: "var(--blue)" };
    case "ready":
      return { label: "ready", color: "var(--green)" };
    case "booting":
      return { label: "booting", color: "var(--amber)" };
    case "priming":
      return { label: "priming", color: "var(--amber)" };
    default:
      return { label: s.state || "unknown", color: "var(--text-3)" };
  }
}
