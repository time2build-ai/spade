import type {
  Account,
  Brake,
  BrainEdge,
  BrainNode,
  Comment,
  LinkRel,
  PipelineRun,
  Project,
  Session,
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
  // Default timeout here is 120s (the backend's own default is 180s).
  promptSession: (id: string, text: string, timeout = 120) =>
    http<{ response: string; state: string }>(`/sessions/${id}/prompt`, {
      method: "POST",
      body: JSON.stringify({ text, timeout }),
    }),
  accounts: () => http<{ accounts: Account[] }>("/accounts"),
  brainNodes: (projectId: string) =>
    http<{ nodes: BrainNode[] }>(
      `/brain/nodes?project_id=${encodeURIComponent(projectId)}`,
    ),
  brainEdges: (projectId: string) =>
    http<{ edges: BrainEdge[] }>(
      `/brain/edges?project_id=${encodeURIComponent(projectId)}`,
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
  startPipeline: (runId: string) =>
    http<PipelineRun>(`/pipelines/${runId}/start`, { method: "POST" }),
  advancePipeline: (runId: string, report?: string | null) =>
    http<PipelineRun>(`/pipelines/${runId}/advance`, {
      method: "POST",
      body: JSON.stringify({ report: report ?? null }),
    }),
  // Human gates — brakes are global orchestrator state (no project_id).
  brakes: () => http<{ brakes: Brake[] }>("/brakes"),
  allowBrake: (id: string) =>
    http<unknown>(`/brakes/${id}/allow`, { method: "POST" }),
  skipBrake: (id: string) =>
    http<unknown>(`/brakes/${id}/skip`, { method: "POST" }),
  // Plain-text endpoint (the live agent terminal screen) — kept out of the
  // JSON `http<T>` wrapper so it returns text, not parsed JSON.
  sessionScreen: async (sessionId: string): Promise<string> => {
    const res = await fetch(`/api/sessions/${sessionId}/screen`);
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    return res.text();
  },
};
