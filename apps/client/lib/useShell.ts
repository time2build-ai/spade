"use client";

import useSWR from "swr";
import { api } from "./api";

/**
 * Shared data for the app shell (sidebar nav counts + topbar status pills).
 * Every value is REAL — from the live endpoints, scoped to the current project.
 * Counts are `undefined` until loaded (render no badge), and the UI hides a
 * badge that is 0, so a fresh/empty project shows a clean nav (never fake demo
 * numbers). SWR dedupes these fetches with the per-view pages.
 */
export function useShellData(projectId: string | null) {
  // Global (no project scope).
  const { data: sessions } = useSWR("sessions", () => api.sessions(), { refreshInterval: 5000 });
  const { data: accounts } = useSWR("accounts", () => api.accounts());
  const { data: brakes } = useSWR("brakes", () => api.brakes(), { refreshInterval: 8000 });

  // Project-scoped (skipped when no project is selected).
  const key = (k: string) => (projectId ? [k, projectId] : null);
  const { data: tasks } = useSWR(key("tasks"), () => api.tasks(projectId!));
  const { data: brain } = useSWR(key("brain"), () => api.brainNodes(projectId!));
  const { data: edges } = useSWR(key("brain-edges"), () => api.brainEdges(projectId!));
  const { data: pipelines } = useSWR(key("pipelines"), () => api.pipelines(projectId!));
  const { data: sprints } = useSWR(key("sprints"), () => api.sprints(projectId!));
  const { data: meetings } = useSWR(key("meetings"), () => api.meetings(projectId!));
  const { data: feedback } = useSWR(key("feedback"), () => api.feedbackClusters(projectId!));

  const decisions = brain ? brain.nodes.filter((n) => n.type === "decision").length : undefined;
  const currentSprint = sprints?.sprints.find((s) => s.state === "active") ?? sprints?.sprints[0] ?? null;

  return {
    counts: {
      backlog: tasks?.tasks.length,
      brain: brain?.nodes.length,
      graphIssues: edges?.edges.length,
      decisions,
      sprints: sprints?.sprints.length,
      orchestrator: pipelines ? pipelines.pipelines.filter((p) => p.status === "running").length : undefined,
      agentPool: accounts?.accounts.length,
      gates: brakes?.brakes.length,
      meetings: meetings?.meetings.length,
      feedback: feedback?.clusters.length,
    },
    aliveSessions: sessions ? sessions.sessions.filter((s) => s.alive).length : undefined,
    runningPipelines: pipelines ? pipelines.pipelines.filter((p) => p.status === "running").length : 0,
    currentSprint,
    defaultAccount: accounts
      ? accounts.accounts.find((a) => a.is_default === 1) ?? accounts.accounts[0] ?? null
      : undefined,
  };
}
