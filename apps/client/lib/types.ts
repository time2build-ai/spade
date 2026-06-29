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
  created_at?: string | null;
  // Phase 3: real lifecycle/provenance columns (nullable). status is decision-only;
  // owner/source/updated_at apply to any node type.
  status?: string | null;
  owner?: string | null;
  source?: string | null;
  updated_at?: string | null;
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
  // Phase 3: real per-account columns (may be null) + derived live-session count.
  role?: string | null;
  model?: string | null;
  plan?: string | null;
  active_sessions?: number;
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
  // Phase 3: real progress derived from stage states (0..100). cost/eta/tokens/
  // files remain client-seeded (not tracked by the pipeline model).
  progress?: number;
  stages_done?: number;
  stages_total?: number;
};

// Phase 3: real sprint rows. Counts are derived server-side from pipeline runs.
export type Sprint = {
  id: string;
  project_id: string;
  number: number;
  day_label: string | null;
  state: string;
  started_at: string | null;
  created_at: string | null;
  shipped: number;
  review: number;
  progress: number;
  queued: number;
  total: number;
};

// Phase 3: real meeting records. Ingested meetings also carry the raw transcript
// and the `source` they came from (the notes tool); both are null when absent.
export type Meeting = {
  id: string;
  project_id: string;
  title: string;
  date: string | null;
  summary: string | null;
  attendees: string[];
  transcript: string | null;
  source: string | null;
  created_at: string | null;
};

// A canned meeting transcript the demo can ingest (GET /meetings/samples).
export type MeetingSample = {
  id: string;
  title: string;
  source: string;
  date: string;
  attendees: string[];
};

// Result of POST /meetings/ingest — the recorded meeting + the backlog tasks
// extracted from its action items (each grounded back to the meeting).
export type MeetingIngestResult = {
  meeting: Meeting;
  tasks: Task[];
};

// Phase 3: real feedback clusters. Verbatim quotes are a follow-up (seeded).
export type FeedbackClusterReal = {
  id: string;
  project_id: string;
  label: string;
  count: number;
  sources: { name: string; n: number; color: string }[];
  created_at: string | null;
};

// Phase 3: real integration connections.
export type Integration = {
  id: string;
  project_id: string;
  name: string;
  category: string | null;
  status: string;
  usage: string | null;
  connected: number;
  created_at: string | null;
};

// Phase 3: persisted chat threads + messages (/ask). payload carries structured
// tool output (cites / plan / action cards).
export type ChatThreadReal = {
  id: string;
  project_id: string;
  title: string | null;
  pinned: number;
  updated_at: string | null;
  created_at: string | null;
};
export type ChatMessageReal = {
  id: string;
  thread_id: string;
  role: string;
  who: string | null;
  text: string | null;
  payload: {
    cites?: string[];
    plan?: { title: string; steps: string[] };
    action?: { kind: string; id: string; risk: string; title: string; remove: string[]; add: string[] };
  } | null;
  created_at: string | null;
};

// Phase 3: derived brain views — MCP export manifest + gap-analysis findings.
export type BrainManifest = {
  project_id: string;
  node_count: number;
  edge_count: number;
  by_type: Record<string, number>;
  resources: { uri: string; name: string; type: string }[];
};
export type BrainGap = { id: string; kind: string; label: string; detail: string };

// Phase 3: a real gate conflict side (a decision node), from /gate/conflict.
export type GateConflictSide = { id: string; label: string; detail: string | null; owner: string | null };
