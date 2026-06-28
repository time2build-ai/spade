import * as React from "react";
import { Icon } from "@/components/Icon";
import { decisionSeed } from "@/lib/demo";
import type { BrainNode } from "@/lib/types";

const STATUS_PILL: Record<string, { color: string; bg: string }> = {
  active: { color: "var(--green)", bg: "rgba(122,209,154,.12)" },
  proposed: { color: "var(--amber)", bg: "rgba(230,184,106,.12)" },
  superseded: { color: "var(--text-4)", bg: "var(--bg-2)" },
};

export interface DecisionCardProps {
  node: BrainNode;
  /** 0-based position in the list → stable "ADR-001" display code. */
  index: number;
  onOpen: (node: BrainNode) => void;
}

/** "ADR-007" from a 0-based index. */
export function adrCode(index: number): string {
  return `ADR-${String(index + 1).padStart(3, "0")}`;
}

/** "Jun 23, 2026" — falls back to the raw string if unparseable. */
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

/** First non-empty line of the detail, trimmed for a one-line preview. */
function snippet(detail: string | null): string | null {
  if (!detail) return null;
  const line = detail.split("\n").map((l) => l.trim()).find(Boolean);
  return line ?? null;
}

/**
 * One decision-type brain node rendered as a clickable ADR row. We only have
 * honest fields (`id`, `label`, `detail`, `created_at`), so the row shows a
 * derived ADR code, the title, the recorded date and a one-line preview, and
 * opens the full detail on click.
 */
export function DecisionCard({ node, index, onOpen }: DecisionCardProps) {
  const date = formatDate(node.created_at);
  const preview = snippet(node.detail);
  const seed = decisionSeed(node.id);
  const pill = STATUS_PILL[seed.status];
  return (
    // `dec-<id>` anchor lets the brain panel deep-link to this exact row.
    <button
      type="button"
      id={`dec-${node.id}`}
      className="dec-row"
      data-status={seed.status}
      onClick={() => onOpen(node)}
    >
      <span className="dec-row-code mono">{adrCode(index)}</span>
      <span className="dec-row-main">
        <span className="dec-row-title">
          <Icon name="doc" className="ico" />
          <span style={seed.status === "superseded" ? { textDecoration: "line-through", color: "var(--text-4)" } : undefined}>
            {node.label}
          </span>
          <span className="status-pill" data-testid="dec-status" style={{ color: pill.color, background: pill.bg, borderColor: pill.color + "44" }}>
            {seed.status}
          </span>
        </span>
        <span className="dec-row-meta">
          {date && <span>{date}</span>}
          <span className="muted">· {seed.owner}</span>
          <span className="chip feature" style={{ padding: "0 6px" }}><span className="d" />{seed.feature}</span>
          {seed.conflict && (
            <span className="chip decision" data-testid="dec-conflict" style={{ padding: "0 6px" }}>
              <span className="d" />conflict {seed.conflict}
            </span>
          )}
          {preview && <span className="dec-row-snippet">{preview}</span>}
        </span>
      </span>
      <span className="dec-row-open">
        Open <Icon name="chev" size={13} />
      </span>
    </button>
  );
}
