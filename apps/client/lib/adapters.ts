import { STATUSES } from "./types";
import type {
  BrainNode,
  BrainNodeType,
  Project,
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
