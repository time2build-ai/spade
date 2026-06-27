"use client";

import * as React from "react";
import Link from "next/link";
import { Chip } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { Markdown } from "@/components/ask/Markdown";
import { indexNodesById, nodeColor } from "@/lib/adapters";
import type { BrainEdge, BrainNode, Task } from "@/lib/types";

export interface NodeInfoProps {
  node: BrainNode | null;
  nodes: BrainNode[];
  edges: BrainEdge[];
  /** Tasks for the project — used to surface the records this node grounds. */
  tasks?: Task[];
  /** Click a connected node to select it. */
  onSelect?: (id: string) => void;
}

/** "Jun 23, 2026" — falls back to the raw string if unparseable. */
function formatDate(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  return new Date(t).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

interface Connection {
  edgeId: string;
  rel: string;
  /** "out" = node → other, "in" = other → node. */
  dir: "out" | "in";
  other: BrainNode;
}

/** Right info panel for the selected node: type chip, label, detail, and
 *  connections grouped by relationship with direction + connected-node type. */
export function NodeInfo({ node, nodes, edges, tasks, onSelect }: NodeInfoProps) {
  const byId = React.useMemo(() => indexNodesById(nodes), [nodes]);

  // Tasks this node is grounded in (reverse of Task.nodes) — each links to its
  // own record page at /task/[id].
  const groundedTasks = React.useMemo(() => {
    if (!node || !tasks) return [];
    return tasks.filter((t) => t.nodes?.includes(node.id));
  }, [node, tasks]);

  const connections = React.useMemo<Connection[]>(() => {
    if (!node) return [];
    const out: Connection[] = [];
    for (const e of edges) {
      let otherId: string | null = null;
      let dir: "out" | "in" = "out";
      if (e.from_id === node.id) {
        otherId = e.to_id;
        dir = "out";
      } else if (e.to_id === node.id) {
        otherId = e.from_id;
        dir = "in";
      }
      if (otherId === null) continue;
      const other = byId[otherId];
      if (other) out.push({ edgeId: e.id, rel: e.rel || "related", dir, other });
    }
    return out;
  }, [node, edges, byId]);

  // Group connections by relationship verb, preserving first-seen order.
  const groups = React.useMemo(() => {
    const m = new Map<string, Connection[]>();
    for (const c of connections) {
      const arr = m.get(c.rel);
      if (arr) arr.push(c);
      else m.set(c.rel, [c]);
    }
    return [...m.entries()];
  }, [connections]);

  if (!node) {
    return (
      <aside className="brain-info brain-info-empty">
        <div className="bx-empty">
          <svg
            className="bx-empty-art"
            viewBox="0 0 80 72"
            width="80"
            height="72"
            aria-hidden="true"
          >
            {/* a single node… */}
            <circle
              cx="32"
              cy="30"
              r="6.5"
              fill="none"
              stroke="var(--text-4)"
              strokeWidth="1.25"
            />
            <circle cx="32" cy="30" r="2.5" fill="var(--text-3)" />
            {/* …and a cursor about to tap it */}
            <g
              transform="translate(38 36)"
              fill="none"
              stroke="var(--text-3)"
              strokeWidth="1.25"
              strokeLinejoin="round"
            >
              <path d="M0 0 L0 18 L5 13 L8 20 L11 19 L8 12 L15 12 Z" />
            </g>
          </svg>
          <div className="bx-empty-title">Nothing selected</div>
          <div className="bx-empty-hint">
            Click a node in the graph to see its details and connections.
          </div>
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
      {node.detail ? (
        <div className="bx-detail">
          <Markdown>{node.detail}</Markdown>
        </div>
      ) : (
        <div className="bx-detail-empty">No description yet.</div>
      )}

      {node.created_at && (
        <div className="bx-meta mono">Added {formatDate(node.created_at)}</div>
      )}

      {/* Jump to this node's record. Decisions have a dedicated page; every node
          also links to the tasks it's grounded in. */}
      {(node.type === "decision" || groundedTasks.length > 0) && (
        <div className="bx-records">
          {node.type === "decision" && (
            <Link href={`/decisions#dec-${node.id}`} className="bx-record-link">
              <Icon name="doc" size={13} className="ico" />
              <span>View in Decisions</span>
              <span className="bx-record-arrow" aria-hidden="true">→</span>
            </Link>
          )}
          {groundedTasks.map((t) => (
            <Link key={t.id} href={`/task/${t.id}`} className="bx-record-link">
              <span className="bx-record-id mono">{t.id}</span>
              <span className="bx-record-title">{t.title}</span>
              <span className="bx-record-arrow" aria-hidden="true">→</span>
            </Link>
          ))}
        </div>
      )}

      <div className="sb-label" style={{ margin: "18px 0 10px" }}>
        Connections · {connections.length}
      </div>
      {connections.length === 0 ? (
        <div style={{ color: "var(--text-4)", fontSize: 12 }}>
          No connections yet.
        </div>
      ) : (
        <div className="bx-rel-groups">
          {groups.map(([rel, items]) => (
            <div className="bx-rel-group" key={rel}>
              <div className="bx-rel-rel mono">
                {rel.replace(/_/g, " ")}
                <span className="bx-rel-count">{items.length}</span>
              </div>
              {items.map((c) => (
                <button
                  key={c.edgeId}
                  type="button"
                  onClick={() => onSelect?.(c.other.id)}
                  className="bx-rel-item"
                  title={`${c.other.type} · ${c.dir === "out" ? "outgoing" : "incoming"}`}
                >
                  <span
                    className="bx-rel-dir mono"
                    aria-hidden="true"
                    style={{ color: c.dir === "out" ? "var(--accent)" : "var(--text-4)" }}
                  >
                    {c.dir === "out" ? "→" : "←"}
                  </span>
                  <span
                    className="bx-rel-dot"
                    style={{ background: nodeColor(c.other.type) }}
                  />
                  <span className="bx-rel-label">{c.other.label}</span>
                  <span className="bx-rel-type">{c.other.type}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}
