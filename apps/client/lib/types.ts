export const STATUSES = [
  "ready",
  // Task Lifecycle V2 phases (brainstorm → ship state machine) — code kind.
  "shaping",
  "plan_review",
  "building",
  "pr_review",
  // The legacy pipeline statuses ('in_progress'/'review') were retired with the
  // pipeline write path (Chunk 6) and remapped to 'building'/'pr_review' by the
  // backend db._migrate.
  "shipped",
  // Task-Type Router per-kind phases: research (scoping/investigating/synthesis)
  // and docs (outline/drafting); `review` is a shared phase name; `delivered` is
  // the terminal status for research + docs.
  "scoping",
  "investigating",
  "synthesis",
  "outline",
  "drafting",
  "review",
  "delivered",
  "blocked",
] as const;

export type Status = (typeof STATUSES)[number];

/** A task's lifecycle kind — which per-kind flow (and board mapping) it runs. */
export type Kind = "code" | "research" | "docs";

/** One kind's board mapping from GET /lifecycle/templates. */
export interface LifecycleTemplate {
  terminal_status: string;
  /** phase name → universal board column. */
  columns: Record<string, string>;
  phases: {
    name: string;
    column: string;
    agent: boolean;
    fanout: boolean;
    gate: string | null;
  }[];
}

/** GET /lifecycle/templates — the per-kind board mapping + human labels, so the
 *  client buckets tasks and labels gates/artifacts without a hardcoded copy. */
export interface LifecycleTemplates {
  templates: Record<string, LifecycleTemplate>;
  gate_labels: Record<string, string>;
  artifact_labels: Record<string, string>;
}

// -- Task Lifecycle V2 ---------------------------------------------------------

/** A durable per-task lifecycle run (the brainstorm→ship state machine row). */
export interface LifecycleRun {
  id: string;
  project_id: string;
  task_id: string;
  /** Which per-kind lifecycle this run drives (code / research / docs). */
  kind?: string | null;
  phase: string;
  active: number;
  /** Number of fan-out agent rows for the run's fan-out phase (research
   *  `investigating`); drives the `▶ N agents` card badge. 0 when none. */
  fanout_count?: number;
  branch_name: string | null;
  worktree_path: string | null;
  pr_number: number | null;
  pr_url: string | null;
  merge_commit: string | null;
  env_dev_at: string | null;
  env_staging_at: string | null;
  env_prod_at: string | null;
  agent_session_id: string | null;
  account_id: string | null;
  blocked_reason: string | null;
  blocked_from_phase: string | null;
  self_heal_attempts: number;
  last_finished_session: string | null;
  created_at: string | null;
  updated_at: string | null;
}

/** A code-enforced human approval gate (plan / manual_test / merge). The
 *  project-scoped waiting list joins in the task title + the run's phase. */
export interface Gate {
  id: string;
  task_id: string;
  run_id: string;
  gate: string;
  status: string;
  comment: string | null;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string | null;
  // Present on the project waiting list (GET /projects/{id}/gates).
  task_title?: string | null;
  phase?: string | null;
}

/** A document pinned to a task — a repo_path on a branch (spec / plan /
 *  test_guide / review_report). */
export interface Artifact {
  id: string;
  task_id: string;
  run_id: string | null;
  kind: string;
  title: string | null;
  repo_path: string | null;
  branch: string | null;
  /** Inline body for non-repo artifacts (research findings/reports, docs). Null
   *  for repo-pointer artifacts (spec/plan/etc. read from a branch). */
  content?: string | null;
  created_by: string | null;
  created_at: string | null;
}

/** Per-project git config (the separate Repository entity). GET returns {} when
 *  unconfigured, so every field is optional. */
export interface ProjectGit {
  project_id?: string;
  repo_ssh_url?: string | null;
  dev_branch?: string | null;
  staging_branch?: string | null;
  prod_branch?: string | null;
  worktrees_root?: string | null;
  created_at?: string | null;
}

/** One task in a release lane (furthest env its run has reached). */
export interface ReleaseItem {
  run_id: string;
  task_id: string;
  title: string | null;
  merge_commit: string | null;
  env_dev_at: string | null;
  env_staging_at: string | null;
  env_prod_at: string | null;
}

/** Tasks grouped by deployment env (Development / Staging / Production lanes). */
export interface ReleaseLanes {
  dev: ReleaseItem[];
  staging: ReleaseItem[];
  prod: ReleaseItem[];
}

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
  // Task-Type Router: the authoritative kind (set at confirm/Start; null until
  // then), the router's advisory suggestion + reason, and the docs sub-template.
  // Optional on the client so older mocks/fixtures without them still typecheck;
  // the real /api/tasks response always includes them.
  kind?: Kind | null;
  kind_suggested?: Kind | null;
  kind_reason?: string | null;
  doc_template?: string | null;
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
