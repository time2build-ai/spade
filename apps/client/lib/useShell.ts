"use client";

import useSWR from "swr";
import { api } from "./api";

/**
 * Shared data for the app shell (sidebar nav counts + topbar status pills).
 * All values come from real endpoints; counts are `undefined` until loaded so
 * the UI can render no badge rather than a stale/fake number. SWR dedupes these
 * fetches with the per-view pages that request the same keys.
 */
export function useShellData(projectId: string | null) {
  // Global (no project scope).
  const { data: sessions } = useSWR("sessions", () => api.sessions(), { refreshInterval: 5000 });
  const { data: accounts } = useSWR("accounts", () => api.accounts());
  const { data: brakes } = useSWR("brakes", () => api.brakes(), { refreshInterval: 8000 });

  // Project-scoped (skipped when no project is selected).
  const { data: tasks } = useSWR(projectId ? ["tasks", projectId] : null, () => api.tasks(projectId!));
  const { data: brain } = useSWR(projectId ? ["brain", projectId] : null, () => api.brainNodes(projectId!));
  const { data: pipelines } = useSWR(projectId ? ["pipelines", projectId] : null, () => api.pipelines(projectId!));

  const decisions = brain ? brain.nodes.filter((n) => n.type === "decision").length : undefined;

  return {
    counts: {
      backlog: tasks?.tasks.length,
      brain: brain?.nodes.length,
      decisions,
      orchestrator: pipelines?.pipelines.length,
      agentPool: sessions?.sessions.length,
      gates: brakes?.brakes.length,
    },
    aliveSessions: sessions ? sessions.sessions.filter((s) => s.alive).length : undefined,
    runningPipelines: pipelines ? pipelines.pipelines.filter((p) => p.status === "running").length : 0,
    defaultAccount: accounts
      ? accounts.accounts.find((a) => a.is_default === 1) ?? accounts.accounts[0] ?? null
      : undefined,
  };
}
