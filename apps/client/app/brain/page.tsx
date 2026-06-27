"use client";

import * as React from "react";
import useSWR from "swr";
import { PageHead } from "@/components/ui";
import { BrainLegend } from "@/components/brain/BrainLegend";
import { GraphCanvas } from "@/components/brain/GraphCanvas";
import { NodeInfo } from "@/components/brain/NodeInfo";
import { useProject } from "@/lib/useProject";
import { api } from "@/lib/api";
import { indexNodesById } from "@/lib/adapters";
import type { BrainNodeType } from "@/lib/types";

const ALL_TYPES: BrainNodeType[] = [
  "feature",
  "decision",
  "convention",
  "feedback",
  "bug",
  "metric",
];

function StateMessage({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: "40px 22px", color: "var(--text-3)", fontSize: 13 }}>
      {children}
    </div>
  );
}

export default function BrainPage() {
  const { project, loading: projectLoading } = useProject();

  const {
    data: nodesData,
    error: nodesError,
    isLoading: nodesLoading,
  } = useSWR(project ? ["brain-nodes", project.id] : null, () =>
    api.brainNodes(project!.id),
  );

  const {
    data: edgesData,
    error: edgesError,
    isLoading: edgesLoading,
  } = useSWR(project ? ["brain-edges", project.id] : null, () =>
    api.brainEdges(project!.id),
  );

  // Tasks are only needed to show "grounded in" links in the info panel, so a
  // failure here shouldn't block the graph — we just omit those links.
  const { data: tasksData } = useSWR(project ? ["tasks", project.id] : null, () =>
    api.tasks(project!.id),
  );

  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [visibleTypes, setVisibleTypes] = React.useState<Set<BrainNodeType>>(
    () => new Set(ALL_TYPES),
  );

  const toggleType = React.useCallback((type: BrainNodeType) => {
    setVisibleTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  const nodes = nodesData?.nodes ?? [];
  const edges = edgesData?.edges ?? [];
  const byId = indexNodesById(nodes);
  const selectedNode = selectedId ? (byId[selectedId] ?? null) : null;

  const error = nodesError || edgesError;
  const dataLoading = nodesLoading || edgesLoading;

  let body: React.ReactNode;
  if (projectLoading) {
    body = <StateMessage>Loading…</StateMessage>;
  } else if (!project) {
    body = (
      <StateMessage>
        Select or create a project to explore its product brain.
      </StateMessage>
    );
  } else if (error) {
    body = (
      <StateMessage>
        <span style={{ color: "var(--red)" }}>
          Couldn’t load the product brain: {String(error.message ?? error)}
        </span>
      </StateMessage>
    );
  } else if (dataLoading || !nodesData) {
    body = <StateMessage>Loading…</StateMessage>;
  } else if (nodes.length === 0) {
    body = (
      <StateMessage>
        This product brain is empty — no knowledge nodes yet. As meetings,
        decisions, feedback and bugs are captured, they’ll appear here as a
        connected graph.
      </StateMessage>
    );
  } else {
    body = (
      <div className="brain-wrap">
        <BrainLegend
          nodes={nodes}
          visibleTypes={visibleTypes}
          onToggle={toggleType}
        />
        <div className="brain-canvas">
          <GraphCanvas
            nodes={nodes}
            edges={edges}
            selectedId={selectedId}
            onSelect={setSelectedId}
            visibleTypes={visibleTypes}
          />
        </div>
        <NodeInfo
          node={selectedNode}
          nodes={nodes}
          edges={edges}
          tasks={tasksData?.tasks ?? []}
          onSelect={setSelectedId}
        />
      </div>
    );
  }

  const subtitle =
    project && nodesData
      ? `${nodes.length} nodes · ${edges.length} edges`
      : undefined;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <PageHead
        title={
          <>
            Product brain
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
