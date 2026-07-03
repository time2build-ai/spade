import type {
  Account,
  Artifact,
  Brake,
  BrainEdge,
  BrainGap,
  BrainManifest,
  BrainNode,
  Comment,
  Gate,
  LinkRel,
  ChatMessageReal,
  ChatThreadReal,
  FeedbackClusterReal,
  GateConflictSide,
  Integration,
  Kind,
  LifecycleRun,
  LifecycleTemplates,
  Meeting,
  MeetingIngestResult,
  MeetingSample,
  PipelineRun,
  Project,
  ProjectGit,
  ReleaseLanes,
  Session,
  Sprint,
  Task,
} from "./types";

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const api = {
  projects: () => http<{ projects: Project[] }>("/projects"),
  // One project plus its connected account pool (`pool: string[]` of account
  // ids). Used to gate the Ask dock when a project has no connected account.
  project: (id: string) => http<Project & { pool: string[] }>(`/projects/${id}`),
  createProject: (body: {
    id: string;
    name: string;
    path: string;
    account_strategy?: string;
    model_ceiling?: string | null;
    autopilot?: number;
  }) => http<Project>("/projects", { method: "POST", body: JSON.stringify(body) }),
  // Patch a project's automation settings (autopilot / strategy / ceiling). Only
  // the sent fields are updated; an explicit `model_ceiling: null` clears it.
  updateProject: (
    id: string,
    body: Partial<Pick<Project, "name" | "path" | "account_strategy" | "model_ceiling" | "autopilot">>,
  ) => http<Project>(`/projects/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  // Delete a project and all its data (brain / backlog / pipelines cascade).
  deleteProject: (id: string) =>
    http<{ id: string; status: string }>(`/projects/${id}`, { method: "DELETE" }),
  // Host environment hints (e.g. home dir for default project paths).
  env: () => http<{ home: string }>("/env"),
  // The server's "current project" — what agents (orchestrator / spade-data
  // skill) treat as active. Keep it in sync with the UI's selected project.
  setCurrentProject: (projectId: string) =>
    http<{ project_id: string | null }>("/current-project", {
      method: "PUT",
      body: JSON.stringify({ project_id: projectId }),
    }),
  // Global fleet (no project param) and the provider account pool.
  sessions: () => http<{ sessions: Session[] }>("/sessions"),
  // One session (used to poll an orchestrator's `prep` while it boots).
  session: (id: string) => http<Session>(`/sessions/${id}`),
  // Spawn a project-scoped orchestrator. Returns immediately; priming runs in
  // the background (poll `session(id)` for prep booting -> priming -> ready).
  spawnOrchestrator: (projectId: string, cwd: string) =>
    http<Session>("/sessions", {
      method: "POST",
      body: JSON.stringify({
        // SpawnRequest requires a unique session `name` (label). Scope it to the
        // project so the spawned orchestrator is easy to identify.
        name: `orchestrator-${projectId}`,
        // `role` must be set explicitly: /sessions does not expose
        // is_orchestrator, so resolveOrchestrator re-finds this session by
        // `role === "orchestrator"`. Without it the role persists as null and a
        // fresh ask would spawn a duplicate orchestrator.
        role: "orchestrator",
        is_orchestrator: true,
        project_id: projectId,
        cwd,
        mode: "bypass",
      }),
    }),
  // Send a prompt to a session; `response` is the agent's reply text.
  // Timeout is generous (300s): a first "set up the brain + a backlog" turn on a
  // fresh project drives the orchestrator through dozens of live API round-trips
  // and routinely runs ~90-150s. A tight timeout cut that off mid-turn, which the
  // server surfaced as a 500 — hence "short prompts work, the pitch errors".
  promptSession: (id: string, text: string, timeout = 300) =>
    http<{ response: string; state: string }>(`/sessions/${id}/prompt`, {
      method: "POST",
      body: JSON.stringify({ text, timeout }),
    }),
  accounts: () => http<{ accounts: Account[] }>("/accounts"),
  brainNodes: (projectId: string) =>
    http<{ nodes: BrainNode[] }>(
      `/brain/nodes?project_id=${encodeURIComponent(projectId)}`,
    ),
  // Create a brain node (e.g. record a decision: type="decision" + status/owner).
  createBrainNode: (body: {
    project_id: string;
    type: BrainNode["type"];
    label: string;
    detail?: string | null;
    status?: string | null;
    owner?: string | null;
  }) => http<BrainNode>("/brain/nodes", { method: "POST", body: JSON.stringify(body) }),
  // Patch a brain node (e.g. flip an ADR's status/owner).
  updateBrainNode: (
    id: string,
    body: Partial<Pick<BrainNode, "label" | "detail" | "status" | "owner">>,
  ) => http<BrainNode>(`/brain/nodes/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  brainEdges: (projectId: string) =>
    http<{ edges: BrainEdge[] }>(
      `/brain/edges?project_id=${encodeURIComponent(projectId)}`,
    ),
  brainExport: (projectId: string) =>
    http<BrainManifest>(`/brain/export?project_id=${encodeURIComponent(projectId)}`),
  brainGaps: (projectId: string) =>
    http<{ gaps: BrainGap[] }>(`/brain/gaps?project_id=${encodeURIComponent(projectId)}`),
  gateConflict: (projectId: string) =>
    http<{ conflict: { existing: GateConflictSide; proposed: GateConflictSide } | null }>(
      `/gate/conflict?project_id=${encodeURIComponent(projectId)}`,
    ),
  tasks: (projectId: string) =>
    http<{ tasks: Task[] }>(
      `/tasks?project_id=${encodeURIComponent(projectId)}`,
    ),
  task: (id: string) => http<Task>(`/tasks/${id}`),
  comments: (id: string) =>
    http<{ comments: Comment[] }>(`/tasks/${id}/comments`),
  moveTask: (id: string, status: string) =>
    http<Task>(`/tasks/${id}/move`, {
      method: "POST",
      body: JSON.stringify({ status }),
    }),
  // Link two tasks (blocks | related | subtask). Returns the enriched FROM task.
  addTaskLink: (taskId: string, toTask: string, rel: LinkRel) =>
    http<Task>(`/tasks/${taskId}/links`, {
      method: "POST",
      body: JSON.stringify({ to_task: toTask, rel }),
    }),
  removeTaskLink: (taskId: string, linkId: string) =>
    http<{ id: string; status: string }>(`/tasks/${taskId}/links/${linkId}`, {
      method: "DELETE",
    }),
  pipelines: (projectId: string) =>
    http<{ pipelines: PipelineRun[] }>(
      `/pipelines?project_id=${encodeURIComponent(projectId)}`,
    ),
  pipeline: (runId: string) => http<PipelineRun>(`/pipelines/${runId}`),
  // NOTE: the pipeline WRITE path (create/start/advance) was retired in favor of
  // the lifecycle engine. Only the read getters above remain (one-release
  // coexistence). Use startLifecycle / decideGate / advance the lifecycle instead.
  sprints: (projectId: string) =>
    http<{ sprints: Sprint[] }>(
      `/sprints?project_id=${encodeURIComponent(projectId)}`,
    ),
  meetings: (projectId: string) =>
    http<{ meetings: Meeting[] }>(
      `/meetings?project_id=${encodeURIComponent(projectId)}`,
    ),
  // Canned transcripts the demo can ingest (the "connected notes tool").
  meetingSamples: () => http<{ samples: MeetingSample[] }>("/meetings/samples"),
  // Ingest a meeting transcript → records the meeting and spins its action
  // items into grounded backlog tasks. Pass a sample id, or an explicit
  // { title, transcript } to ingest arbitrary notes.
  ingestMeeting: (body: {
    project_id: string;
    sample?: string;
    title?: string;
    transcript?: string;
    source?: string;
  }) =>
    http<MeetingIngestResult>("/meetings/ingest", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  feedbackClusters: (projectId: string) =>
    http<{ clusters: FeedbackClusterReal[] }>(
      `/feedback?project_id=${encodeURIComponent(projectId)}`,
    ),
  integrations: (projectId: string) =>
    http<{ integrations: Integration[] }>(
      `/integrations?project_id=${encodeURIComponent(projectId)}`,
    ),
  setIntegrationConnected: (id: string, connected: boolean) =>
    http<Integration>(`/integrations/${id}`, { method: "PATCH", body: JSON.stringify({ connected }) }),
  chatThreads: (projectId: string) =>
    http<{ threads: ChatThreadReal[] }>(
      `/chat/threads?project_id=${encodeURIComponent(projectId)}`,
    ),
  chatMessages: (threadId: string) =>
    http<{ messages: ChatMessageReal[] }>(`/chat/threads/${threadId}/messages`),
  // Human gates — brakes are global orchestrator state (no project_id).
  brakes: () => http<{ brakes: Brake[] }>("/brakes"),
  allowBrake: (id: string) =>
    http<unknown>(`/brakes/${id}/allow`, { method: "POST" }),
  skipBrake: (id: string) =>
    http<unknown>(`/brakes/${id}/skip`, { method: "POST" }),
  // -- Task Lifecycle V2 -----------------------------------------------------
  // The durable brainstorm→ship state machine (worktrees, PRs, human gates,
  // releases). Runs live alongside the legacy pipeline until Chunk 6.
  startLifecycle: (projectId: string, taskId: string) =>
    http<LifecycleRun>("/lifecycle/start", {
      method: "POST",
      body: JSON.stringify({ project_id: projectId, task_id: taskId }),
    }),
  lifecycle: (runId: string) => http<LifecycleRun>(`/lifecycle/${runId}`),
  // -- Task-Type Router ------------------------------------------------------
  // The per-kind board mapping (kind → phase → column) + gate/artifact labels,
  // so the board and task view don't hardcode a second copy of the registry.
  templates: () => http<LifecycleTemplates>("/lifecycle/templates"),
  // Confirm / override a task's lifecycle kind (409s once a run exists — locked).
  setKind: (taskId: string, kind: Kind, docTemplate?: string) =>
    http<Task>(`/tasks/${taskId}/kind`, {
      method: "POST",
      body: JSON.stringify({ kind, doc_template: docTemplate ?? null }),
    }),
  // Backfill: classify every null-kind task in the project, storing suggestions.
  routeUntyped: (projectId: string) =>
    http<{ project_id: string; routed: number }>(
      `/projects/${projectId}/route-untyped`,
      { method: "POST" },
    ),
  // The shareable styled-doc URL for a `doc` artifact. NOT an http<T> call — it's
  // an <iframe> src. Next only proxies `/api/:path*`, so it must be `/api/doc/…`.
  docUrl: (artifactId: string) => `/api/doc/${artifactId}`,
  lifecycleList: (projectId: string) =>
    http<{ runs: LifecycleRun[] }>(
      `/lifecycle?project_id=${encodeURIComponent(projectId)}`,
    ),
  retryLifecycle: (runId: string) =>
    http<LifecycleRun>(`/lifecycle/${runId}/retry`, { method: "POST" }),
  // Approve / request-changes a human gate on a task's active run.
  approveGate: (taskId: string, gate: string, comment?: string) =>
    http<LifecycleRun>(`/tasks/${taskId}/gates/${gate}/approve`, {
      method: "POST",
      body: JSON.stringify({ comment: comment ?? null }),
    }),
  requestGateChanges: (taskId: string, gate: string, comment: string) =>
    http<LifecycleRun>(`/tasks/${taskId}/gates/${gate}/request-changes`, {
      method: "POST",
      body: JSON.stringify({ comment }),
    }),
  // Documents pinned to a task (spec / plan / test_guide / review_report) and
  // their rendered markdown (read from the repo at the pinned branch).
  artifacts: (taskId: string) =>
    http<{ artifacts: Artifact[] }>(`/tasks/${taskId}/artifacts`),
  artifactContent: (taskId: string, artifactId: string) =>
    http<{ content: string }>(`/tasks/${taskId}/artifacts/${artifactId}/content`),
  // Per-project Repository config (the separate ProjectGit entity).
  projectGit: (projectId: string) => http<ProjectGit>(`/projects/${projectId}/git`),
  updateProjectGit: (
    projectId: string,
    body: Partial<Pick<ProjectGit, "repo_ssh_url" | "dev_branch" | "staging_branch" | "prod_branch" | "worktrees_root">>,
  ) =>
    http<ProjectGit>(`/projects/${projectId}/git`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  // Waiting lifecycle gates for a project (the gate board's home).
  lifecycleGates: (projectId: string) =>
    http<{ gates: Gate[] }>(`/projects/${projectId}/gates`),
  // Release lanes (dev / staging / prod) + promotion between them.
  releases: (projectId: string) =>
    http<{ releases: ReleaseLanes }>(`/projects/${projectId}/releases`),
  promote: (projectId: string, from: string, to: string) =>
    http<{ pr_number?: number; pr_url?: string }>(`/projects/${projectId}/promote`, {
      method: "POST",
      body: JSON.stringify({ from_env: from, to_env: to }),
    }),
  // Plain-text endpoint (the live agent terminal screen) — kept out of the
  // JSON `http<T>` wrapper so it returns text, not parsed JSON.
  sessionScreen: async (sessionId: string): Promise<string> => {
    const res = await fetch(`/api/sessions/${sessionId}/screen`);
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    return res.text();
  },
};
