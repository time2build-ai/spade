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

export type BrainEdge = {
  id: string;
  project_id: string;
  from_id: string;
  to_id: string;
  rel: string | null;
};

export type LinkRel = "blocks" | "related" | "subtask";

export type TaskLink = {
  id: string;
  from_task: string;
  to_task: string;
  rel: LinkRel;
  created_at: string;
};

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
  // Task→task dependency links where this task is either end (see taskRelations).
  links: TaskLink[];
}

export type Brake = {
  id: string;
  mission: string;
  brake: string;
  detail: string;
  worker: string | null;
};

export interface Comment {
  id: string;
  author: string | null;
  kind: string;
  body: string;
  created_at: string;
}

export const STAGE_ROLES = [
  "developer",
  "reviewer",
  "integrator",
  "documentor",
] as const;
export type StageRole = (typeof STAGE_ROLES)[number];
export type StageState = "queued" | "running" | "done" | "failed";
export type RunStatus = "queued" | "running" | "paused" | "shipped";

export type PipelineStage = {
  id: string;
  pipeline_run_id: string;
  role: string;
  stage_order: number;
  state: StageState;
  session_id: string | null;
  account_id: string | null;
  created_at: string;
};

export type Account = {
  id: string;
  label: string;
  color: string | null;
  provider: string;
  config_dir: string;
  is_default: number;
  created_at: string;
};

export type Session = {
  id: string;
  name: string;
  alive: boolean;
  cmd: string;
  cwd: string;
  role: string | null;
  label: string | null;
  emoji: string | null;
  mode: string | null;
  prep: string | null;
  prep_detail: string | null;
  task: string | null;
  order: number | null;
  model: string | null;
  mission: string | null;
  parent: string | null;
  reason: string | null;
  state: string;
  harness_state: string | null;
  has_menu: boolean;
  account_id: string | null;
  project_id: string | null;
};

export type PipelineRun = {
  id: string;
  project_id: string;
  task_id: string;
  status: RunStatus;
  current_stage: number;
  created_at: string;
  stages: PipelineStage[];
};
