"use client";

import useSWR from "swr";
import Link from "next/link";
import { PageHead } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { Board } from "@/components/backlog/Board";
import { BlockedBanner } from "@/components/backlog/BlockedBanner";
import { useProject } from "@/lib/useProject";
import { api } from "@/lib/api";
import { indexNodesById, recommendedFirstTask } from "@/lib/adapters";

/** "Start here" hint — the first executable task given the dependency graph. */
function NextUpBanner({ tasks }: { tasks: import("@/lib/types").Task[] }) {
  const first = recommendedFirstTask(tasks);
  if (!first) return null;
  return (
    <div style={{ padding: "10px 22px 0" }}>
      <Link
        href={`/task/${first.id}`}
        className="card"
        data-testid="next-up-banner"
        style={{
          padding: "10px 14px", display: "flex", gap: 12, alignItems: "center",
          textDecoration: "none", color: "inherit",
          borderColor: "rgba(122,209,154,.3)",
          background: "linear-gradient(180deg, rgba(122,209,154,.08), var(--bg-1))",
        }}
      >
        <span style={{ fontSize: 14, color: "var(--green)" }}>▶</span>
        <div style={{ fontSize: 12.5, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span className="muted">Start here —</span>
          <b>{first.id}</b>
          <span className="muted">· {first.title}</span>
          <span className="muted">· no open blockers, highest priority</span>
        </div>
        <span className="btn" style={{ marginLeft: "auto" }}>Open task →</span>
      </Link>
    </div>
  );
}

function StateMessage({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: "40px 22px", color: "var(--text-3)", fontSize: 13 }}>
      {children}
    </div>
  );
}

export default function BacklogPage() {
  const { project, loading: projectLoading } = useProject();

  const {
    data: tasksData,
    error: tasksError,
    isLoading: tasksLoading,
  } = useSWR(project ? ["tasks", project.id] : null, () =>
    api.tasks(project!.id),
  );

  const {
    data: brainData,
    error: brainError,
    isLoading: brainLoading,
  } = useSWR(project ? ["brain", project.id] : null, () =>
    api.brainNodes(project!.id),
  );

  const byId = indexNodesById(brainData?.nodes ?? []);
  const error = tasksError || brainError;
  const dataLoading = tasksLoading || brainLoading;

  let body: React.ReactNode;
  if (projectLoading) {
    body = <StateMessage>Loading…</StateMessage>;
  } else if (!project) {
    body = (
      <StateMessage>
        Select or create a project to view its backlog.
      </StateMessage>
    );
  } else if (error) {
    body = (
      <StateMessage>
        <span style={{ color: "var(--red)" }}>
          Couldn’t load the backlog: {String(error.message ?? error)}
        </span>
      </StateMessage>
    );
  } else if (dataLoading || !tasksData) {
    body = <StateMessage>Loading…</StateMessage>;
  } else {
    body = <Board tasks={tasksData.tasks} nodesById={byId} />;
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <PageHead
        title="Backlog"
        actions={
          // No-fabrication: only "Run sprint" is wired (navigates to the
          // orchestrator). Reference's Filter / Suggest-priority need real
          // filtering / an AI action we don't have yet — deferred.
          <Link href="/orchestrator" className="btn primary">
            <Icon name="play" size={13} /> Run sprint
          </Link>
        }
      />
      {tasksData && <NextUpBanner tasks={tasksData.tasks} />}
      {tasksData && <BlockedBanner tasks={tasksData.tasks} />}
      {body}
    </div>
  );
}
