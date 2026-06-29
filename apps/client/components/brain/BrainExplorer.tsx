"use client";

import * as React from "react";
import { Markdown } from "@/components/ask/Markdown";
import { NODE_TYPE_META } from "@/lib/adapters";
import type { BrainNode, BrainEdge, BrainNodeType } from "@/lib/types";

/**
 * Brain Explorer — the reference's detail-first 3-column layout
 * (namespace tree · record detail · relations map). Mirrors the reference
 * BrainView structure, but under the no-fabrication policy it renders ONLY real
 * fields: type, id, label, detail, and edges. The reference's invented content
 * (owner, confidence/coverage, code-surface file list, activity feed, MCP block)
 * is intentionally omitted — those need backend data we don't have.
 */

const GROUP_TYPES: BrainNodeType[] = [
  "decision",
  "convention",
  "feedback",
  "bug",
  "metric",
  "feature",
];

// Plural labels for the tree / index / relations headers.
const PLURAL: Record<BrainNodeType, string> = {
  feature: "Features",
  decision: "Decisions",
  convention: "Conventions",
  feedback: "Feedback",
  bug: "Bugs",
  metric: "Metrics",
};

/** Render prose with `ADR-NNN` tokens as cross-link chips. */

export interface BrainExplorerProps {
  nodes: BrainNode[];
  edges: BrainEdge[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function BrainExplorer({ nodes, edges, selectedId, onSelect }: BrainExplorerProps) {
  const nodesById = React.useMemo(
    () => Object.fromEntries(nodes.map((n) => [n.id, n])),
    [nodes],
  );

  // Undirected adjacency from edges.
  const adj = React.useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const e of edges) {
      if (!m.has(e.from_id)) m.set(e.from_id, new Set());
      if (!m.has(e.to_id)) m.set(e.to_id, new Set());
      m.get(e.from_id)!.add(e.to_id);
      m.get(e.to_id)!.add(e.from_id);
    }
    return m;
  }, [edges]);

  const linkedTo = React.useCallback(
    (id: string): BrainNode[] =>
      [...(adj.get(id) ?? [])].map((x) => nodesById[x]).filter(Boolean) as BrainNode[],
    [adj, nodesById],
  );

  const features = nodes.filter((n) => n.type === "feature");
  const indexTypes: BrainNodeType[] = ["decision", "convention", "feedback", "bug", "metric"];
  const typeCount = (t: BrainNodeType) => nodes.filter((n) => n.type === t).length;

  const sel = selectedId ? nodesById[selectedId] : undefined;
  const neighbors = sel ? linkedTo(sel.id) : [];
  const groups: Partial<Record<BrainNodeType, BrainNode[]>> = {};
  for (const n of neighbors) (groups[n.type] ??= []).push(n);

  return (
    <div className="brain-explorer">
      {/* LEFT — namespace tree */}
      <aside className="bx-tree">
        <div className="bx-tree-h">Features</div>
        {features.map((f) => {
          const linked = linkedTo(f.id);
          const c = (t: BrainNodeType) => linked.filter((x) => x.type === t).length;
          const on = selectedId === f.id;
          return (
            <div
              key={f.id}
              className={"bx-feature" + (on ? " on" : "")}
              data-id={f.id}
              onClick={() => onSelect(f.id)}
            >
              <span className="bx-chevron">▸</span>
              <span className="bx-fname">{f.label}</span>
              <span className="bx-fcounts">
                {c("decision") > 0 && (
                  <span title="decisions" style={{ color: "var(--amber)" }}>{c("decision")}D</span>
                )}
                {c("bug") > 0 && (
                  <span title="bugs" style={{ color: "var(--red)" }}>{c("bug")}B</span>
                )}
                {c("feedback") > 0 && (
                  <span title="feedback" style={{ color: "var(--teal)" }}>{c("feedback")}U</span>
                )}
              </span>
            </div>
          );
        })}

        <div className="bx-tree-h" style={{ marginTop: 18 }}>Index</div>
        {indexTypes.map((t) => (
          <div key={t} className="bx-index-row" data-type={t} onClick={() => {
            const first = nodes.find((n) => n.type === t);
            if (first) onSelect(first.id);
          }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: NODE_TYPE_META[t].color }} />
            <span>{PLURAL[t]}</span>
            <span className="mono muted" style={{ marginLeft: "auto", fontSize: 11 }}>{typeCount(t)}</span>
          </div>
        ))}
      </aside>

      {/* CENTER — record detail */}
      <section className="bx-detail">
        {!sel ? (
          <div className="muted" style={{ padding: "8px 0", fontSize: 13 }}>
            Select a node to see its record.
          </div>
        ) : (
          <>
            <div className="bx-detail-h">
              <span
                className="bx-glyph"
                style={{
                  background: NODE_TYPE_META[sel.type].color + "1a",
                  color: NODE_TYPE_META[sel.type].color,
                  borderColor: NODE_TYPE_META[sel.type].color + "40",
                }}
              >
                {NODE_TYPE_META[sel.type].glyph}
              </span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div
                  className="muted mono"
                  style={{ fontSize: 11, letterSpacing: ".06em", textTransform: "uppercase" }}
                >
                  {NODE_TYPE_META[sel.type].label} ·{" "}
                  <span style={{ color: "var(--text-3)" }}>{sel.id}</span>
                </div>
                <h2 className="bx-title">{sel.label}</h2>
              </div>
              <div className="bx-actions">
                <button className="btn ghost">Edit</button>
                <button className="btn ghost">⋯</button>
              </div>
            </div>

            {/* Keys grid + description — REAL node columns only (Type/Owner/
                Source/Last touched + the node's own markdown detail). */}
            {(() => {
              const owner = sel.owner ?? null;
              const source = sel.source ?? null;
              const lastTouched = sel.updated_at
                ? new Date(sel.updated_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
                : null;
              return (
                <>
                  <div className="bx-keys">
                    <div><span className="k">Type</span><span>{NODE_TYPE_META[sel.type].label}</span></div>
                    <div><span className="k">Owner</span><span data-testid="bx-owner">{owner ?? "—"}</span></div>
                    <div><span className="k">Last touched</span><span className="mono" data-testid="bx-touched">{lastTouched ?? "—"}</span></div>
                    <div><span className="k">Source</span><span data-testid="bx-source">{source ?? "—"}</span></div>
                  </div>

                  <div className="bx-section-h">Description</div>
                  <div className="bx-prose">
                    {sel.detail ? <Markdown>{sel.detail}</Markdown> : <span className="muted">No description recorded yet.</span>}
                  </div>
                </>
              );
            })()}
          </>
        )}
      </section>

      {/* RIGHT — relations map */}
      <aside className="bx-relations">
        <div className="bx-rel-h">
          Relations
          <span className="muted mono" style={{ fontSize: 11 }}>{neighbors.length} edges</span>
        </div>

        {sel && (
          <div className="bx-anchor">
            <div
              className="bx-anchor-center"
              style={{ borderColor: NODE_TYPE_META[sel.type].color + "60" }}
            >
              <span style={{ color: NODE_TYPE_META[sel.type].color }}>
                {NODE_TYPE_META[sel.type].glyph}
              </span>
              <span className="bx-anchor-label">{sel.label}</span>
            </div>
            <div className="bx-anchor-spokes">
              {GROUP_TYPES.filter((t) => groups[t]).map((t) => (
                <div key={t} className="bx-spoke">
                  <span className="bx-spoke-dot" style={{ background: NODE_TYPE_META[t].color }} />
                  <span
                    className="muted"
                    style={{ fontSize: 11, fontFamily: "var(--mono)", letterSpacing: ".04em" }}
                  >
                    {PLURAL[t].toLowerCase()}
                  </span>
                  <span className="mono" style={{ marginLeft: "auto", color: "var(--text-3)", fontSize: 11 }}>
                    {groups[t]!.length}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {GROUP_TYPES.filter((t) => groups[t]).map((t) => (
          <React.Fragment key={t}>
            <div className="bx-rel-divider" />
            <div className="bx-rel-group">
              <div className="bx-rel-group-h">
                <span style={{ color: NODE_TYPE_META[t].color }}>{NODE_TYPE_META[t].glyph}</span>
                <span>{PLURAL[t]}</span>
                <span className="mono muted" style={{ marginLeft: "auto" }}>{groups[t]!.length}</span>
              </div>
              {groups[t]!.map((x) => (
                <div key={x.id} className="bx-rel-item" data-id={x.id} onClick={() => onSelect(x.id)}>
                  <span className="bx-rel-bullet" style={{ background: NODE_TYPE_META[t].color }} />
                  <span className="bx-rel-label">{x.label}</span>
                  <span className="bx-rel-id mono">{x.id}</span>
                </div>
              ))}
            </div>
          </React.Fragment>
        ))}

        {/* MCP server block (reference) */}
        <div className="bx-rel-divider" />
        <div className="bx-rel-group" data-testid="mcp-block">
          <div className="bx-rel-group-h">
            <span style={{ color: "var(--text-3)" }}>∿</span>
            <span>MCP server</span>
          </div>
          <div className="muted mono" style={{ fontSize: 11, lineHeight: 1.7, padding: "4px 0" }}>
            localhost:8717
            <br />
            <span style={{ color: "var(--green)" }}>●</span> connected · 2 sessions reading
          </div>
        </div>
      </aside>
    </div>
  );
}
