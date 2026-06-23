"use client";

import * as React from "react";
import { layoutNodes, nodeColor } from "@/lib/adapters";
import type { BrainEdge, BrainNode, BrainNodeType } from "@/lib/types";

const VB_W = 800;
const VB_H = 600;
const PAD = 56;
const NODE_R = 9;

export interface GraphCanvasProps {
  nodes: BrainNode[];
  edges: BrainEdge[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** When provided, only nodes whose type is in the set are shown. */
  visibleTypes?: Set<BrainNodeType>;
}

/**
 * SVG knowledge-graph canvas: radial lavender glow background, edge lines
 * between laid-out node positions, then type-colored node circles with labels.
 */
export function GraphCanvas({
  nodes,
  edges,
  selectedId,
  onSelect,
  visibleTypes,
}: GraphCanvasProps) {
  const visibleNodes = React.useMemo(
    () =>
      visibleTypes ? nodes.filter((n) => visibleTypes.has(n.type)) : nodes,
    [nodes, visibleTypes],
  );

  const laidOut = React.useMemo(
    () => layoutNodes(visibleNodes, VB_W, VB_H, PAD),
    [visibleNodes],
  );

  const posById = React.useMemo(() => {
    const m = new Map<string, { px: number; py: number }>();
    for (const n of laidOut) m.set(n.id, { px: n.px, py: n.py });
    return m;
  }, [laidOut]);

  const visibleEdges = React.useMemo(
    () => edges.filter((e) => posById.has(e.from_id) && posById.has(e.to_id)),
    [edges, posById],
  );

  return (
    <svg
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Product brain graph"
      style={{ width: "100%", height: "100%", display: "block" }}
    >
      <defs>
        <radialGradient id="brain-glow" cx="50%" cy="45%" r="55%">
          <stop offset="0%" stopColor="rgba(142,125,255,0.12)" />
          <stop offset="60%" stopColor="rgba(142,125,255,0.04)" />
          <stop offset="100%" stopColor="rgba(142,125,255,0)" />
        </radialGradient>
      </defs>

      {/* Radial lavender glow background over the canvas base. */}
      <rect x={0} y={0} width={VB_W} height={VB_H} fill="#0b0b0d" />
      <rect x={0} y={0} width={VB_W} height={VB_H} fill="url(#brain-glow)" />

      {/* Edges first so nodes draw on top. */}
      <g stroke="rgba(201,184,255,0.18)" strokeWidth={1}>
        {visibleEdges.map((e) => {
          const a = posById.get(e.from_id)!;
          const b = posById.get(e.to_id)!;
          return <line key={e.id} x1={a.px} y1={a.py} x2={b.px} y2={b.py} />;
        })}
      </g>

      {/* Nodes. */}
      <g>
        {laidOut.map((n) => {
          const color = nodeColor(n.type);
          const selected = n.id === selectedId;
          return (
            <g
              key={n.id}
              transform={`translate(${n.px}, ${n.py})`}
              onClick={() => onSelect(n.id)}
              style={{ cursor: "pointer" }}
              data-node-id={n.id}
            >
              {selected && (
                <circle
                  r={NODE_R + 5}
                  fill="none"
                  stroke={color}
                  strokeWidth={1.5}
                  opacity={0.6}
                />
              )}
              <circle
                r={NODE_R}
                fill={color}
                stroke={selected ? "#fff" : "rgba(0,0,0,0.35)"}
                strokeWidth={selected ? 1.5 : 1}
              />
              <text
                x={0}
                y={NODE_R + 14}
                textAnchor="middle"
                fontSize={11}
                fontFamily="var(--sans)"
                fill={selected ? "var(--text)" : "var(--text-3)"}
              >
                {n.label}
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}
