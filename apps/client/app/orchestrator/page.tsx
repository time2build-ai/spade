"use client";

import { useState } from "react";
import useSWR from "swr";
import { PageHead } from "@/components/ui";
import { KpiStrip } from "@/components/orchestrator/KpiStrip";
import { PipelineTable } from "@/components/orchestrator/PipelineTable";
import { useProject } from "@/lib/useProject";
import { api } from "@/lib/api";
import { filterRuns, pipelineKpis } from "@/lib/adapters";
import type { PipelineRun } from "@/lib/types";

type Filter = "all" | "active" | "paused" | "shipped";
const FILTERS: Filter[] = ["all", "active", "paused", "shipped"];

function StateMessage({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: "40px 22px", color: "var(--text-3)", fontSize: 13 }}>
      {children}
    </div>
  );
}

export default function OrchestratorPage() {
  const { project, loading: projectLoading } = useProject();
  const [filter, setFilter] = useState<Filter>("all");

  const { data, error, isLoading, mutate } = useSWR(
    project ? ["pipelines", project.id] : null,
    () => api.pipelines(project!.id),
    { refreshInterval: 2500 },
  );

  // Join task titles + account labels for the table columns (real data).
  const { data: tasksData } = useSWR(project ? ["tasks", project.id] : null, () =>
    api.tasks(project!.id),
  );
  const { data: accountsData } = useSWR("accounts", () => api.accounts());

  const runs: PipelineRun[] = data?.pipelines ?? [];
  const filtered = filterRuns(runs, filter);
  const kpis = pipelineKpis(runs);
  const liveCount = kpis.active;

  const titleById: Record<string, string> = {};
  for (const t of tasksData?.tasks ?? []) titleById[t.id] = t.title;
  const accountById: Record<string, string> = {};
  for (const a of accountsData?.accounts ?? []) accountById[a.id] = a.label;

  async function onStart(id: string) {
    await api.startPipeline(id);
    await mutate();
  }
  async function onAdvance(id: string) {
    await api.advancePipeline(id);
    await mutate();
  }

  let body: React.ReactNode;
  if (projectLoading) {
    body = <StateMessage>Loading…</StateMessage>;
  } else if (!project) {
    body = (
      <StateMessage>
        Select or create a project to view its pipelines.
      </StateMessage>
    );
  } else if (error) {
    body = (
      <StateMessage>
        <span style={{ color: "var(--red)" }}>
          Couldn’t load pipelines: {String(error.message ?? error)}
        </span>
      </StateMessage>
    );
  } else if (isLoading && !data) {
    body = <StateMessage>Loading…</StateMessage>;
  } else if (runs.length === 0) {
    body = (
      <StateMessage>
        No pipelines yet. Pipeline runs appear here once you start one for a
        task — the orchestrator dispatches it through the Developer → Reviewer →
        Integrator → Documentor stages.
      </StateMessage>
    );
  } else {
    body = (
      <>
        <KpiStrip runs={runs} />
        <div className="filter-bar">
          <span>Filter</span>
          <div className="seg">
            {FILTERS.map((f) => (
              <button
                key={f}
                className={filter === f ? "on" : ""}
                onClick={() => setFilter(f)}
              >
                {f === "all"
                  ? `All (${runs.length})`
                  : f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
          <span style={{ marginLeft: "auto" }} className="muted">
            click a pipeline to expand details ↓
          </span>
        </div>

        <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
          {filtered.length === 0 ? (
            <StateMessage>No pipelines match this filter.</StateMessage>
          ) : (
            <PipelineTable
              runs={filtered}
              titleById={titleById}
              accountById={accountById}
              onStart={onStart}
              onAdvance={onAdvance}
            />
          )}
        </div>
      </>
    );
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <PageHead
        title="Orchestrator"
        actions={
          <span className="topbar-pill">
            <span className="pulse-dot" /> {liveCount} sessions live
          </span>
        }
      />
      {body}
    </div>
  );
}
