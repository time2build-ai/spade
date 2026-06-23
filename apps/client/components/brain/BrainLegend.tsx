"use client";

import * as React from "react";
import { nodeColor, nodeTypeCounts } from "@/lib/adapters";
import type { BrainNode, BrainNodeType } from "@/lib/types";

const TYPE_ORDER: { type: BrainNodeType; label: string }[] = [
  { type: "feature", label: "Features" },
  { type: "decision", label: "Decisions" },
  { type: "convention", label: "Conventions" },
  { type: "feedback", label: "Feedback" },
  { type: "bug", label: "Bugs" },
  { type: "metric", label: "Metrics" },
];

export interface BrainLegendProps {
  nodes: BrainNode[];
  visibleTypes: Set<BrainNodeType>;
  onToggle: (type: BrainNodeType) => void;
}

/** Left panel: a row per node type with color swatch, count, and visibility toggle. */
export function BrainLegend({
  nodes,
  visibleTypes,
  onToggle,
}: BrainLegendProps) {
  const counts = nodeTypeCounts(nodes);
  return (
    <aside className="brain-side">
      <div
        className="sb-label"
        style={{ marginBottom: 8 }}
      >
        Node types
      </div>
      {TYPE_ORDER.map(({ type, label }) => {
        const on = visibleTypes.has(type);
        return (
          <button
            key={type}
            type="button"
            className="legend-item"
            aria-pressed={on}
            onClick={() => onToggle(type)}
            style={{
              width: "100%",
              textAlign: "left",
              opacity: on ? 1 : 0.4,
            }}
          >
            <span
              className="legend-dot"
              style={{ background: nodeColor(type) }}
            />
            <span>{label}</span>
            <span className="count">{counts[type]}</span>
          </button>
        );
      })}
    </aside>
  );
}
