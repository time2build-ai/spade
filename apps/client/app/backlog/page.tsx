"use client";

import useSWR from "swr";
import { PageHead, Btn } from "@/components/ui";
import { Board } from "@/components/backlog/Board";
import { useProject } from "@/lib/useProject";
import { api } from "@/lib/api";
import { indexNodesById } from "@/lib/adapters";

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
          <Btn variant="primary" disabled>
            + New
          </Btn>
        }
      />
      {body}
    </div>
  );
}
