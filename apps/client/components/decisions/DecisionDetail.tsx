"use client";

import * as React from "react";
import Link from "next/link";
import { Chip } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { Markdown } from "@/components/ask/Markdown";
import { indexNodesById, nodeColor } from "@/lib/adapters";
import { adrCode } from "./DecisionCard";
import { decisionSeed } from "@/lib/demo";
import type { BrainEdge, BrainNode, Task } from "@/lib/types";

const TOC = [
  ["summary", "Summary"],
  ["drivers", "Decision drivers"],
  ["consequences", "Consequences"],
  ["alternatives", "Alternatives"],
  ["validation", "Validation"],
  ["provenance", "Provenance"],
  ["changelog", "Changelog"],
];

export interface DecisionDetailProps {
  node: BrainNode;
  /** 0-based position → ADR code, matching the row it was opened from. */
  index: number;
  nodes: BrainNode[];
  edges: BrainEdge[];
  tasks: Task[];
  onClose: () => void;
  /** Open another decision (e.g. clicking a connected decision node). */
  onOpenNode?: (node: BrainNode) => void;
}

function formatDate(iso?: string | null): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  return new Date(t).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Full ADR detail as a right-docked aside over the decisions list. */
export function DecisionDetail({
  node,
  index,
  nodes,
  edges,
  tasks,
  onClose,
  onOpenNode,
}: DecisionDetailProps) {
  const byId = React.useMemo(() => indexNodesById(nodes), [nodes]);

  // Close on Escape.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const connections = React.useMemo(() => {
    const out: { id: string; other: BrainNode; rel: string }[] = [];
    for (const e of edges) {
      const otherId =
        e.from_id === node.id ? e.to_id : e.to_id === node.id ? e.from_id : null;
      if (!otherId) continue;
      const other = byId[otherId];
      if (other) out.push({ id: e.id, other, rel: e.rel || "related" });
    }
    return out;
  }, [edges, node.id, byId]);

  const linkedTasks = React.useMemo(
    () => tasks.filter((t) => t.nodes?.includes(node.id)),
    [tasks, node.id],
  );

  const date = formatDate(node.created_at);

  const exportMarkdown = () => {
    const md = `# ${node.label}\n\n${node.detail ?? "_No description yet._"}\n`;
    void navigator.clipboard?.writeText(md);
  };

  return (
    <div className="dec-modal-backdrop" onClick={onClose}>
      <div
        className="dec-modal"
        data-testid="decision-aside"
        role="dialog"
        aria-modal="true"
        aria-label={node.label}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="dec-modal-head">
          <div className="dec-modal-head-left">
            <span className="dec-modal-code mono">{adrCode(index)}</span>
            <Chip type="decision">ADR</Chip>
          </div>
          <div className="dec-modal-actions">
            <button type="button" className="dec-modal-btn" onClick={exportMarkdown}>
              Export markdown
            </button>
            <button
              type="button"
              className="dec-modal-btn dec-modal-btn-icon"
              aria-label="Close"
              onClick={onClose}
            >
              <Icon name="x" size={14} />
            </button>
          </div>
        </header>

        <h2 className="dec-modal-title">{node.label}</h2>
        {date && <div className="dec-modal-meta mono">Recorded {date}</div>}

        {/* TOC scroll-spy (anchors into the structured sections) */}
        <nav className="adr-toc" data-testid="adr-toc">
          {TOC.map(([anchor, label]) => (
            <a key={anchor} href={`#adr-${anchor}`} className="adr-toc-link">{label}</a>
          ))}
        </nav>

        <div className="dec-modal-body">
          {node.detail ? (
            <Markdown>{node.detail}</Markdown>
          ) : (
            <div className="dec-modal-empty">No description recorded yet.</div>
          )}

          {(() => {
            const seed = decisionSeed(node.id);
            return (
              <>
                <section className="adr-section" id="adr-summary">
                  <div className="dec-modal-section-label">Summary</div>
                  <div className="adr-kv">
                    {seed.summary.map((r) => (
                      <div key={r.k}><span className="k">{r.k}</span><span>{r.v}</span></div>
                    ))}
                  </div>
                </section>

                <section className="adr-section" id="adr-drivers">
                  <div className="dec-modal-section-label">Decision drivers</div>
                  <ul className="adr-list">{seed.drivers.map((d, i) => <li key={i}>{d}</li>)}</ul>
                </section>

                <section className="adr-section" id="adr-consequences">
                  <div className="dec-modal-section-label">Consequences</div>
                  <div className="adr-cons">
                    <div><div className="adr-cons-h" style={{ color: "var(--green)" }}>Good</div><ul className="adr-list">{seed.consequences.good.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
                    <div><div className="adr-cons-h" style={{ color: "var(--red)" }}>Bad</div><ul className="adr-list">{seed.consequences.bad.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
                    <div><div className="adr-cons-h" style={{ color: "var(--text-3)" }}>Neutral</div><ul className="adr-list">{seed.consequences.neutral.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
                  </div>
                </section>

                <section className="adr-section" id="adr-alternatives">
                  <div className="dec-modal-section-label">Alternatives considered</div>
                  {seed.alternatives.map((a, i) => (
                    <div className="adr-alt" key={i}>
                      <div className="adr-alt-title">{a.title}</div>
                      <div className="adr-alt-note muted">{a.note}</div>
                    </div>
                  ))}
                </section>

                <section className="adr-section" id="adr-validation">
                  <div className="dec-modal-section-label">Validation</div>
                  <ul className="adr-list">{seed.validation.map((v, i) => <li key={i}>{v}</li>)}</ul>
                </section>

                <section className="adr-section" id="adr-provenance">
                  <div className="dec-modal-section-label">Provenance</div>
                  <div className="adr-kv">{seed.provenance.map((r) => <div key={r.k}><span className="k">{r.k}</span><span>{r.v}</span></div>)}</div>
                </section>

                <section className="adr-section" id="adr-changelog">
                  <div className="dec-modal-section-label">Changelog</div>
                  {seed.changelog.map((c, i) => (
                    <div className="adr-change" key={i}>
                      <span className="mono adr-change-date">{c.date}</span>
                      <span>{c.text}</span>
                    </div>
                  ))}
                </section>
              </>
            );
          })()}

          {linkedTasks.length > 0 && (
            <section className="dec-modal-section">
              <div className="dec-modal-section-label">
                Linked work · {linkedTasks.length}
              </div>
              <div className="dec-modal-links">
                {linkedTasks.map((t) => (
                  <Link key={t.id} href={`/task/${t.id}`} className="dec-modal-link">
                    <span className="dec-modal-link-id mono">{t.id}</span>
                    <span className="dec-modal-link-title">{t.title}</span>
                    <Icon name="chev" size={13} />
                  </Link>
                ))}
              </div>
            </section>
          )}

          {connections.length > 0 && (
            <section className="dec-modal-section">
              <div className="dec-modal-section-label">
                Connections · {connections.length}
              </div>
              <div className="dec-modal-links">
                {connections.map((c) => {
                  const isDecision = c.other.type === "decision";
                  const inner = (
                    <>
                      <span
                        className="dec-modal-dot"
                        style={{ background: nodeColor(c.other.type) }}
                      />
                      <span className="dec-modal-link-title">{c.other.label}</span>
                      <span className="dec-modal-link-rel mono">
                        {c.rel.replace(/_/g, " ")}
                      </span>
                    </>
                  );
                  // Decisions can be opened in place; other types just describe
                  // the link (their record page lives elsewhere / not yet built).
                  return isDecision && onOpenNode ? (
                    <button
                      key={c.id}
                      type="button"
                      className="dec-modal-link"
                      onClick={() => onOpenNode(c.other)}
                    >
                      {inner}
                    </button>
                  ) : (
                    <div key={c.id} className="dec-modal-link dec-modal-link-static">
                      {inner}
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
