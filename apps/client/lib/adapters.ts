import { STATUSES } from "./types";
import type {
  BrainNode,
  BrainNodeType,
  LifecycleTemplates,
  PipelineRun,
  Project,
  Session,
  StageState,
  Status,
  Task,
  TaskLink,
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

/** Bucket tasks into their statuses. All keys present; unknown statuses ignored. */
export function tasksByStatus(tasks: Task[]): Record<Status, Task[]> {
  const buckets = {} as Record<Status, Task[]>;
  for (const s of STATUSES) buckets[s] = [];
  for (const task of tasks) {
    const bucket = buckets[task.status];
    if (bucket) bucket.push(task);
  }
  return buckets;
}

// -- universal board columns (Task-Type Router) -------------------------------

/** The 5 universal board columns, in display order. Every kind's phases map into
 *  one of these via the `/lifecycle/templates` mapping. `blocked` is NOT a
 *  column — blocked tasks surface in the amber banner. */
export const BOARD_COLUMNS = [
  "Ready",
  "Planning",
  "In progress",
  "Review",
  "Done",
] as const;
export type BoardColumn = (typeof BOARD_COLUMNS)[number];

/**
 * Map a task to its universal board column using the per-kind template mapping.
 * Edge handling:
 *  - `blocked`     → null (excluded from columns; surfaced in the blocked banner);
 *  - `kind == null`→ Ready (untyped tasks live in Ready until routed/started);
 *  - `status ready`→ Ready (regardless of kind);
 *  - otherwise the template's phase→column mapping, falling back to Ready for an
 *    unknown kind/phase (e.g. templates not yet loaded).
 */
export function columnFor(
  task: Task,
  templates?: LifecycleTemplates,
): BoardColumn | null {
  if (task.status === "blocked") return null;
  if (task.status === "ready") return "Ready";
  if (!task.kind) return "Ready";
  const col = templates?.templates?.[task.kind]?.columns?.[task.status];
  if (col && (BOARD_COLUMNS as readonly string[]).includes(col)) {
    return col as BoardColumn;
  }
  return "Ready";
}

/** Bucket tasks into the 5 universal columns via `columnFor`. All keys present;
 *  blocked tasks (columnFor → null) are excluded. */
export function tasksByColumn(
  tasks: Task[],
  templates?: LifecycleTemplates,
): Record<BoardColumn, Task[]> {
  const buckets = {} as Record<BoardColumn, Task[]>;
  for (const c of BOARD_COLUMNS) buckets[c] = [];
  for (const task of tasks) {
    const col = columnFor(task, templates);
    if (col) buckets[col].push(task);
  }
  return buckets;
}

// -- task dependencies (links) adapters ---------------------------------------

export type TaskRelations = {
  blockedBy: string[];
  blocks: string[];
  related: string[];
  parent: string[];
  subtasks: string[];
};

/**
 * Bucket a task's links into derived dependency relations, returning the OTHER
 * task id for each. Semantics:
 *  - blocks ("A blocks B", from→to): from==T → `blocks` (T blocks them);
 *    to==T → `blockedBy` (they block T).
 *  - subtask ("A is parent of B", from→to): from==T → `subtasks` (T's children);
 *    to==T → `parent` (T's parent).
 *  - related (symmetric): the other end, from either direction.
 */
export function taskRelations(taskId: string, links: TaskLink[]): TaskRelations {
  const out: TaskRelations = {
    blockedBy: [],
    blocks: [],
    related: [],
    parent: [],
    subtasks: [],
  };
  for (const link of links) {
    const isFrom = link.from_task === taskId;
    const isTo = link.to_task === taskId;
    if (!isFrom && !isTo) continue;
    switch (link.rel) {
      case "blocks":
        if (isFrom) out.blocks.push(link.to_task);
        else out.blockedBy.push(link.from_task);
        break;
      case "subtask":
        if (isFrom) out.subtasks.push(link.to_task);
        else out.parent.push(link.from_task);
        break;
      case "related":
        out.related.push(isFrom ? link.to_task : link.from_task);
        break;
    }
  }
  return out;
}

/**
 * Per-task execution readiness derived from the dependency graph:
 *  - `isEpic`     — has subtasks (a container; you execute its leaves, not it);
 *  - `blockedByOpen` — how many of its blockers are still un-shipped;
 *  - `startable`  — a ready, non-epic leaf with no open blocker → safe to run NOW.
 */
export type TaskExecState = { startable: boolean; blockedByOpen: number; isEpic: boolean };

export function taskExecutionStates(tasks: Task[]): Map<string, TaskExecState> {
  const statusById = new Map(tasks.map((t) => [t.id, t.status]));
  const out = new Map<string, TaskExecState>();
  for (const t of tasks) {
    const rel = taskRelations(t.id, t.links);
    const blockedByOpen = rel.blockedBy.filter((id) => {
      const s = statusById.get(id);
      return s != null && s !== "shipped";
    }).length;
    const isEpic = rel.subtasks.length > 0;
    out.set(t.id, {
      startable: t.status === "ready" && blockedByOpen === 0 && !isEpic,
      blockedByOpen,
      isEpic,
    });
  }
  return out;
}

/** The single task to start first: the highest-priority startable leaf. */
export function recommendedFirstTask(tasks: Task[]): Task | null {
  const states = taskExecutionStates(tasks);
  const startable = tasks.filter((t) => states.get(t.id)?.startable);
  if (!startable.length) return null;
  startable.sort(
    (a, b) => a.priority - b.priority || a.id.localeCompare(b.id, undefined, { numeric: true }),
  );
  return startable[0];
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

/**
 * Per-type metadata for brain nodes — color + single-letter glyph + label.
 * Mirrors the reference `typeMeta` (Spade standalone, GraphIssuesView): feature
 * #c9b8ff/F, decision #e6b86a/D, convention #e69bb6/C, feedback #7adcc7/U,
 * bug #e87d7d/B, metric #7ab6e6/M. Colors are expressed as our token vars.
 */
export const NODE_TYPE_META: Record<BrainNodeType, { color: string; glyph: string; label: string }> = {
  feature: { color: "var(--accent)", glyph: "F", label: "Feature" },
  decision: { color: "var(--amber)", glyph: "D", label: "Decision" },
  convention: { color: "var(--pink)", glyph: "C", label: "Convention" },
  feedback: { color: "var(--teal)", glyph: "U", label: "Feedback" },
  bug: { color: "var(--red)", glyph: "B", label: "Bug" },
  metric: { color: "var(--blue)", glyph: "M", label: "Metric" },
};

/** Token color var for a brain node type (drives node + legend colors). */
export function nodeColor(type: BrainNodeType): string {
  return NODE_TYPE_META[type].color;
}

/** Single-letter glyph for a brain node type (F/D/C/U/B/M), per the reference. */
export function nodeGlyph(type: BrainNodeType): string {
  return NODE_TYPE_META[type].glyph;
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
