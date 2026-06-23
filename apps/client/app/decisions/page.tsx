"use client";

import * as React from "react";
import useSWR from "swr";
import { PageHead } from "@/components/ui";
import { DecisionCard } from "@/components/decisions/DecisionCard";
import { useProject } from "@/lib/useProject";
import { api } from "@/lib/api";

function StateMessage({ children }: { children: React.ReactNode }) {
  return <div className="decisions-empty">{children}</div>;
}

export default function DecisionsPage() {
  const { project, loading: projectLoading } = useProject();

  const {
    data,
    error,
    isLoading,
  } = useSWR(project ? ["brain-nodes", project.id] : null, () =>
    api.brainNodes(project!.id),
  );

  // ADRs are not a separate table — they're brain nodes typed "decision".
  const decisions = (data?.nodes ?? []).filter((n) => n.type === "decision");

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
        {decisions.map((node) => (
          <DecisionCard key={node.id} node={node} />
        ))}
      </div>
    );
  }

  const subtitle =
    project && data ? `${decisions.length} ADRs` : undefined;

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
    </div>
  );
}
