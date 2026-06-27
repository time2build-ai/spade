"use client";

import * as React from "react";
import Link from "next/link";
import useSWR from "swr";
import { PageHead } from "@/components/ui";
import { ActiveCard } from "@/components/orchestrator/ActiveCard";
import { useProject } from "@/lib/useProject";
import { api } from "@/lib/api";
import type { PipelineRun } from "@/lib/types";

function StateMessage({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: "40px 22px", color: "var(--text-3)", fontSize: 13 }}>
      {children}
    </div>
  );
}

export default function ActiveTasksPage() {
  const { project, loading: projectLoading } = useProject();
  const [openId, setOpenId] = React.useState<string | null>(null);

  const { data, error, isLoading } = useSWR(
    project ? ["pipelines", project.id] : null,
    () => api.pipelines(project!.id),
    { refreshInterval: 2500 },
  );
  const { data: tasksData } = useSWR(project ? ["tasks", project.id] : null, () =>
    api.tasks(project!.id),
  );
  const { data: accountsData } = useSWR("accounts", () => api.accounts());

  const runs: PipelineRun[] = data?.pipelines ?? [];
  const live = runs.filter((r) => r.status !== "shipped");
  const running = live.filter((r) => r.status === "running").length;
  const paused = live.filter((r) => r.status === "paused").length;

  const taskById = new Map((tasksData?.tasks ?? []).map((t) => [t.id, t]));
  const acctById = new Map((accountsData?.accounts ?? []).map((a) => [a.id, a.label]));

  let body: React.ReactNode;
  if (projectLoading) {
    body = <StateMessage>Loading…</StateMessage>;
  } else if (!project) {
    body = <StateMessage>Select or create a project to see active tasks.</StateMessage>;
  } else if (error) {
    body = (
      <StateMessage>
        <span style={{ color: "var(--red)" }}>Couldn’t load pipelines: {String(error.message ?? error)}</span>
      </StateMessage>
    );
  } else if (isLoading && !data) {
    body = <StateMessage>Loading…</StateMessage>;
  } else if (live.length === 0) {
    body = <StateMessage>No active pipelines. Start one from the backlog or orchestrator.</StateMessage>;
  } else {
    body = (
      <>
        <div className="orch-summary-strip" style={{ padding: 0 }}>
          <div className="stat-cell">
            <div className="lbl">Running</div>
            <div className="val">{running}</div>
            <div className="sub">{paused} paused</div>
          </div>
          <div className="stat-cell">
            <div className="lbl">Live pipelines</div>
            <div className="val">{live.length}</div>
            <div className="sub">non-shipped</div>
          </div>
        </div>
        <div className="active-list" data-testid="active-list">
          {live.map((run) => {
            const task = taskById.get(run.task_id);
            const acctId = run.stages.find((s) => s.account_id)?.account_id ?? null;
            return (
              <ActiveCard
                key={run.id}
                run={run}
                title={task?.title}
                feature={task?.feature ?? null}
                account={acctId ? acctById.get(acctId) ?? acctId : null}
                priority={task?.priority ?? 2}
                open={openId === run.id}
                onToggle={() => setOpenId(openId === run.id ? null : run.id)}
              />
            );
          })}
        </div>
      </>
    );
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <PageHead
        title={`Active tasks${live.length ? ` · ${live.length} pipelines running` : ""}`}
        actions={
          <Link href="/orchestrator" className="btn">
            Open orchestrator →
          </Link>
        }
      />
      {body}
    </div>
  );
}
