export const STATUSES = [
  "ready",
  "in_progress",
  "review",
  "shipped",
  "blocked",
] as const;

export type Status = (typeof STATUSES)[number];

export interface Project {
  id: string;
  name: string;
  path: string;
  account_strategy: string;
  model_ceiling: string | null;
  autopilot: number;
  created_at: string;
  rr_cursor?: number;
}

export type BrainNodeType =
  | "feature"
  | "decision"
  | "convention"
  | "feedback"
  | "bug"
  | "metric";

export interface BrainNode {
  id: string;
  project_id: string;
  type: BrainNodeType;
  label: string;
  detail: string | null;
  x: number | null;
  y: number | null;
}

export interface Task {
  id: string;
  project_id: string;
  title: string;
  feature: string | null;
  priority: number;
  status: Status;
  origin_quote: string | null;
  origin_source: string | null;
  description: string | null;
  created_at: string;
  // Brain-node IDs grounded to this task; resolve against the project's brain
  // node list (see resolveNodes / api.brainNodes) to get full BrainNode objects.
  nodes: string[];
}

export interface Comment {
  id: string;
  author: string | null;
  kind: string;
  body: string;
  created_at: string;
}
