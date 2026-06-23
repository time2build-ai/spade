import { useCallback, useState } from "react";
import useSWR from "swr";
import { api } from "./api";
import type { Project } from "./types";

const STORAGE_KEY = "spade.projectId";

/**
 * Resolve the active project from a list and a stored id:
 *   - stored id present in list -> that project
 *   - otherwise -> the first project
 *   - empty list -> null
 */
export function resolveActiveProject(
  projects: Project[],
  storedId: string | null,
): Project | null {
  if (projects.length === 0) return null;
  if (storedId) {
    const match = projects.find((p) => p.id === storedId);
    if (match) return match;
  }
  return projects[0];
}

function readStoredId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(STORAGE_KEY);
}

export interface UseProjectResult {
  projects: Project[];
  project: Project | null;
  setProject: (id: string) => void;
  loading: boolean;
  error: Error | undefined;
}

export function useProject(): UseProjectResult {
  const { data, error, isLoading } = useSWR("projects", () => api.projects());
  const projects = data?.projects ?? [];

  const [activeId, setActiveId] = useState<string | null>(() => readStoredId());

  const project = resolveActiveProject(projects, activeId);

  const setProject = useCallback((id: string) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, id);
    }
    setActiveId(id);
  }, []);

  return {
    projects,
    project,
    setProject,
    loading: isLoading,
    error: error as Error | undefined,
  };
}
