"use client";

import * as React from "react";
import useSWR from "swr";
import { PageHead } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { BrainLegend } from "@/components/brain/BrainLegend";
import { GraphCanvas } from "@/components/brain/GraphCanvas";
import { useProject } from "@/lib/useProject";
import { api } from "@/lib/api";
import { DEMO_AI_ISSUES, AI_ISSUE_STATUS } from "@/lib/demo";
import type { BrainNodeType } from "@/lib/types";

const ALL_TYPES: BrainNodeType[] = ["feature", "decision", "convention", "feedback", "bug", "metric"];

function StateMessage({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: "40px 22px", color: "var(--text-3)", fontSize: 13 }}>{children}</div>;
}

export default function GraphIssuesPage() {
  const { project, loading: projectLoading } = useProject();
  const { data: nodesData, error, isLoading } = useSWR(
    project ? ["brain-nodes", project.id] : null,
    () => api.brainNodes(project!.id),
  );
  const { data: edgesData } = useSWR(project ? ["brain-edges", project.id] : null, () =>
    api.brainEdges(project!.id),
  );

  const nodes = nodesData?.nodes ?? [];
  const edges = edgesData?.edges ?? [];
  const issues = DEMO_AI_ISSUES;

  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [visibleTypes, setVisibleTypes] = React.useState<Set<BrainNodeType>>(() => new Set(ALL_TYPES));
  const toggleType = React.useCallback((t: BrainNodeType) => {
    setVisibleTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }, []);

  let body: React.ReactNode;
  if (projectLoading) body = <StateMessage>Loading…</StateMessage>;
  else if (!project) body = <StateMessage>Select a project to explore its graph.</StateMessage>;
  else if (error) body = <StateMessage><span style={{ color: "var(--red)" }}>Couldn’t load the graph.</span></StateMessage>;
  else if (isLoading && !nodesData) body = <StateMessage>Loading…</StateMessage>;
  else {
    body = (
      <div className="gi-wrap">
        <section className="gi-graph-pane">
          <BrainLegend nodes={nodes} visibleTypes={visibleTypes} onToggle={toggleType} />
          <div className="gi-canvas-wrap">
            {nodes.length > 0 ? (
              <GraphCanvas
                nodes={nodes}
                edges={edges}
                selectedId={selectedId}
                onSelect={setSelectedId}
                visibleTypes={visibleTypes}
              />
            ) : (
              <StateMessage>No knowledge nodes yet.</StateMessage>
            )}
          </div>
        </section>

        <aside className="gi-issues-pane" data-testid="gi-issues">
          <div className="gi-issues-h">
            AI issues
            <span className="muted mono" style={{ fontSize: 11 }}>{issues.length}</span>
          </div>
          {issues.map((iss) => {
            const st = AI_ISSUE_STATUS[iss.status];
            return (
              <div className="gi-issue" key={iss.id} data-status={iss.status}>
                <div className="gi-issue-h">
                  <span className="gi-issue-id mono">{iss.id}</span>
                  <span className="gi-issue-status" style={{ color: st.color }}>{st.glyph} {st.label}</span>
                </div>
                <div className="gi-issue-title">{iss.title}</div>
                <div className="gi-issue-sum">{iss.summary}</div>
                <div className="gi-issue-foot">
                  <span className="mono">{iss.agent}</span>
                  <span className="mono" style={{ marginLeft: "auto", color: "var(--text-3)" }}>
                    {iss.confidence}% conf
                  </span>
                </div>
              </div>
            );
          })}
        </aside>
      </div>
    );
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <PageHead
        title={
          <>
            Graph &amp; Issues
            <span className="muted" style={{ fontWeight: 400 }}>
              {" "}· {nodes.length} nodes · {issues.length} AI issues
            </span>
          </>
        }
        actions={
          <>
            <button type="button" className="btn ghost">
              <Icon name="spark" size={13} /> Re-analyze subgraph
            </button>
            <button type="button" className="btn primary">
              <Icon name="plus" size={13} /> New manual issue
            </button>
          </>
        }
      />
      {body}
    </div>
  );
}
