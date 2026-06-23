import type {
  Brake,
  BrainEdge,
  BrainNode,
  Comment,
  PipelineRun,
  Project,
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
