"use client";

import * as React from "react";
import { Chip } from "@/components/ui";
import { indexNodesById } from "@/lib/adapters";
import type { BrainEdge, BrainNode } from "@/lib/types";

export interface NodeInfoProps {
  node: BrainNode | null;
  nodes: BrainNode[];
  edges: BrainEdge[];
  /** Click a connected node to select it. */
  onSelect?: (id: string) => void;
}

interface Connection {
  edgeId: string;
  rel: string | null;
  other: BrainNode;
}

/** Right info panel for the selected node: type chip, label, detail, connections. */
export function NodeInfo({ node, nodes, edges, onSelect }: NodeInfoProps) {
  const byId = React.useMemo(() => indexNodesById(nodes), [nodes]);

  const connections = React.useMemo<Connection[]>(() => {
    if (!node) return [];
    const out: Connection[] = [];
    for (const e of edges) {
      let otherId: string | null = null;
      if (e.from_id === node.id) otherId = e.to_id;
      else if (e.to_id === node.id) otherId = e.from_id;
      if (otherId === null) continue;
      const other = byId[otherId];
      if (other) out.push({ edgeId: e.id, rel: e.rel, other });
    }
    return out;
  }, [node, edges, byId]);

  if (!node) {
    return (
      <aside className="brain-info">
        <div style={{ color: "var(--text-3)", fontSize: 13 }}>
          Select a node
        </div>
      </aside>
    );
  }

  return (
    <aside className="brain-info">
      <Chip type={node.type}>{node.type}</Chip>
      <h2
        style={{
          fontSize: 18,
          margin: "12px 0 6px",
          fontWeight: 600,
          color: "var(--text)",
        }}
      >
        {node.label}
      </h2>
      {node.detail && (
        <div
          style={{
            fontSize: 13.5,
            lineHeight: 1.6,
            color: "var(--text-2)",
            marginBottom: 18,
          }}
        >
          {node.detail}
        </div>
      )}

      <div className="sb-label" style={{ marginBottom: 8 }}>
        Connections · {connections.length}
      </div>
      {connections.length === 0 ? (
        <div style={{ color: "var(--text-4)", fontSize: 12 }}>No edges.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {connections.map((c) => (
            <button
              key={c.edgeId}
              type="button"
              onClick={() => onSelect?.(c.other.id)}
              className="bx-rel-item"
              style={{ width: "100%", textAlign: "left" }}
            >
              {c.rel && (
                <span
                  className="mono"
                  style={{ color: "var(--text-4)", fontSize: 10.5 }}
                >
                  {c.rel}
                </span>
              )}
              <span className="bx-rel-label">{c.other.label}</span>
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}
