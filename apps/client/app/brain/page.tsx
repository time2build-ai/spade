"use client";

import * as React from "react";
import Link from "next/link";
import useSWR from "swr";
import { PageHead } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { BrainExplorer } from "@/components/brain/BrainExplorer";
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

export default function BrainPage() {
  const { project, loading: projectLoading } = useProject();

  // Real "Export to MCP": fetch the live manifest and show its summary.
  const [exported, setExported] = React.useState<string | null>(null);
  const exportMcp = async () => {
    if (!project) return;
    const m = await api.brainExport(project.id);
    setExported(`Exported ${m.node_count} nodes · ${m.edge_count} edges`);
  };

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

  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  const nodes = nodesData?.nodes ?? [];
  const edges = edgesData?.edges ?? [];
  const byId = indexNodesById(nodes);

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
    // Product brain is the Explorer only — the node graph lives at /graph-issues.
    const firstFeatureId =
      nodes.find((n) => n.type === "feature")?.id ?? nodes[0]?.id ?? null;
    const explorerSelected = selectedId && byId[selectedId] ? selectedId : firstFeatureId;
    body = (
      <BrainExplorer
        nodes={nodes}
        edges={edges}
        selectedId={explorerSelected}
        onSelect={setSelectedId}
      />
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
        actions={
          <>
            <div className="brain-search">
              <Icon name="search" size={12} />
              <input placeholder="Ask the brain…" aria-label="Search the brain" />
              <span className="badge mono">⌘K</span>
            </div>
            <Link href="/graph-issues" className="btn" data-testid="find-gaps">
              <Icon name="spark" size={13} /> Find gaps
            </Link>
            {exported && (
              <span className="mono" data-testid="mcp-result" style={{ fontSize: 11, color: "var(--green)" }}>
                {exported}
              </span>
            )}
            <button type="button" className="btn primary" data-testid="export-mcp" onClick={exportMcp}>
              <Icon name="doc" size={13} /> Export to MCP
            </button>
          </>
        }
      />
      {body}
    </div>
  );
}
