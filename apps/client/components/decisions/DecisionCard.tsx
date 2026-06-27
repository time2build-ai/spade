import * as React from "react";
import { Icon } from "@/components/Icon";
import type { BrainNode } from "@/lib/types";

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
  return (
    // `dec-<id>` anchor lets the brain panel deep-link to this exact row.
    <button
      type="button"
      id={`dec-${node.id}`}
      className="dec-row"
      onClick={() => onOpen(node)}
    >
      <span className="dec-row-code mono">{adrCode(index)}</span>
      <span className="dec-row-main">
        <span className="dec-row-title">
          <Icon name="doc" className="ico" />
          {node.label}
        </span>
        <span className="dec-row-meta">
          {date && <span>{date}</span>}
          {preview && <span className="dec-row-snippet">{preview}</span>}
        </span>
      </span>
      <span className="dec-row-open">
        Open <Icon name="chev" size={13} />
      </span>
    </button>
  );
}
