"use client";

import * as React from "react";
import useSWR from "swr";
import { PageHead } from "@/components/ui";
import { DecisionCard } from "@/components/decisions/DecisionCard";
import { DecisionDetail } from "@/components/decisions/DecisionDetail";
import { useProject } from "@/lib/useProject";
import { api } from "@/lib/api";
import type { BrainNode } from "@/lib/types";

function StateMessage({ children }: { children: React.ReactNode }) {
  return <div className="decisions-empty">{children}</div>;
}

export default function DecisionsPage() {
  const { project, loading: projectLoading } = useProject();

  const { data, error, isLoading } = useSWR(
    project ? ["brain-nodes", project.id] : null,
    () => api.brainNodes(project!.id),
  );

  // Edges + tasks power the detail modal's Connections / Linked work. Failures
  // here shouldn't block the list, so we read them loosely (default to []).
  const { data: edgesData } = useSWR(
    project ? ["brain-edges", project.id] : null,
    () => api.brainEdges(project!.id),
  );
  const { data: tasksData } = useSWR(
    project ? ["tasks", project.id] : null,
    () => api.tasks(project!.id),
  );

  // ADRs are not a separate table — they're brain nodes typed "decision".
  const decisions = React.useMemo(
    () => (data?.nodes ?? []).filter((n) => n.type === "decision"),
    [data],
  );

  const [openId, setOpenId] = React.useState<string | null>(null);

  // Honor a deep link from the brain panel (/decisions#dec-<id>): open that
  // decision's modal once the list has loaded.
  React.useEffect(() => {
    if (!decisions.length) return;
    const hash = window.location.hash;
    const m = hash.match(/^#dec-(.+)$/);
    if (m && decisions.some((d) => d.id === m[1])) setOpenId(m[1]);
  }, [decisions]);

  const openIndex = openId ? decisions.findIndex((d) => d.id === openId) : -1;
  const openNode = openIndex >= 0 ? decisions[openIndex] : null;

  let body: React.ReactNode;
  if (projectLoading) {
    body = <StateMessage>Loading…</StateMessage>;
  } else if (!project) {
    body = (
      <StateMessage>
        Select or create a project to see its recorded decisions.
      </StateMessage>
    );
  } else if (error) {
    body = (
      <StateMessage>
        <span style={{ color: "var(--red)" }}>
          Couldn’t load decisions: {String(error.message ?? error)}
        </span>
      </StateMessage>
    );
  } else if (isLoading || !data) {
    body = <StateMessage>Loading…</StateMessage>;
  } else if (decisions.length === 0) {
    body = <StateMessage>No decisions recorded yet.</StateMessage>;
  } else {
    body = (
      <div className="decisions-list">
        {decisions.map((node, i) => (
          <DecisionCard
            key={node.id}
            node={node}
            index={i}
            onOpen={(n: BrainNode) => setOpenId(n.id)}
          />
        ))}
      </div>
    );
  }

  const subtitle = project && data ? `${decisions.length} ADRs` : undefined;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <PageHead
        title={
          <>
            Decisions
            {subtitle && (
              <span className="muted" style={{ fontWeight: 400 }}>
                {" "}
                · {subtitle}
              </span>
            )}
          </>
        }
      />
      {body}
      {openNode && (
        <DecisionDetail
          node={openNode}
          index={openIndex}
          nodes={data?.nodes ?? []}
          edges={edgesData?.edges ?? []}
          tasks={tasksData?.tasks ?? []}
          onClose={() => setOpenId(null)}
          onOpenNode={(n) => setOpenId(n.id)}
        />
      )}
    </div>
  );
}
