import type { BrainNode, Comment, Project, Task } from "./types";

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
};
