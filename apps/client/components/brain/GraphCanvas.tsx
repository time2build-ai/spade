"use client";

import * as React from "react";
import { layoutNodes, nodeColor, nodeGlyph } from "@/lib/adapters";
import type { BrainEdge, BrainNode, BrainNodeType } from "@/lib/types";

const VB_W = 800;
const VB_H = 600;
const PAD = 64;
const PILL_H = 26;

export interface GraphCanvasProps {
  nodes: BrainNode[];
  edges: BrainEdge[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** When provided, only nodes whose type is in the set are shown. */
  visibleTypes?: Set<BrainNodeType>;
}

/** Rough pill width from label length (Inter ≈ 6.2px/char at 11.5px), plus the
 *  leading dot zone and right padding. Keeps SVG layout server-renderable. */
function pillWidth(label: string): number {
  return Math.round(label.length * 6.2) + 44;
}

/** Gentle S-curve between two points (eased horizontally) for nicer edges. */
function edgePath(a: { px: number; py: number }, b: { px: number; py: number }): string {
  const dx = (b.px - a.px) * 0.4;
  return `M${a.px},${a.py} C${a.px + dx},${a.py} ${b.px - dx},${b.py} ${b.px},${b.py}`;
}

/**
 * SVG knowledge-graph canvas (Direction A — "polished node-link"):
 * radial lavender glow, curved edges, and type-colored pill nodes carrying an
 * inline dot + label. Node dots scale with degree (importance). Hovering or
 * selecting a node focuses it: the node, its neighbors and the connecting edges
 * stay lit while everything else dims. Hover previews; click (selectedId) sticks.
 */
export function GraphCanvas({
  nodes,
  edges,
  selectedId,
  onSelect,
  visibleTypes,
}: GraphCanvasProps) {
  const [hoverId, setHoverId] = React.useState<string | null>(null);

  const visibleNodes = React.useMemo(
    () => (visibleTypes ? nodes.filter((n) => visibleTypes.has(n.type)) : nodes),
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

  // Degree per node → importance sizing of the leading dot.
  const degree = React.useMemo(() => {
    const d = new Map<string, number>();
    for (const e of visibleEdges) {
      d.set(e.from_id, (d.get(e.from_id) ?? 0) + 1);
      d.set(e.to_id, (d.get(e.to_id) ?? 0) + 1);
    }
    return d;
  }, [visibleEdges]);

  // Adjacency for focus highlighting.
  const neighbors = React.useMemo(() => {
    const m = new Map<string, Set<string>>();
    const add = (a: string, b: string) => {
      if (!m.has(a)) m.set(a, new Set());
      m.get(a)!.add(b);
    };
    for (const e of visibleEdges) {
      add(e.from_id, e.to_id);
      add(e.to_id, e.from_id);
    }
    return m;
  }, [visibleEdges]);

  // Focus source: hover wins (instant preview), else the persisted selection.
  const focusId = hoverId ?? selectedId;
  const focusSet = React.useMemo(() => {
    if (!focusId || !posById.has(focusId)) return null;
    const s = new Set<string>([focusId]);
    for (const nb of neighbors.get(focusId) ?? []) s.add(nb);
    return s;
  }, [focusId, neighbors, posById]);

  const edgeFocused = (e: BrainEdge) =>
    focusId != null && (e.from_id === focusId || e.to_id === focusId);
  const dotRadius = (id: string) => 4 + Math.min(3, degree.get(id) ?? 0); // 4..7

  // Pan/zoom: a stateful viewBox the user can drag (pan) and wheel (zoom). The
  // base view shows the whole graph; dragging empty canvas moves it, the wheel
  // zooms around the cursor, double-click resets. Node clicks are untouched —
  // panning only starts when the press lands on empty canvas.
  const DEFAULT_VIEW = { x: 0, y: 0, w: VB_W, h: VB_H };
  const [view, setView] = React.useState(DEFAULT_VIEW);
  const [dragging, setDragging] = React.useState(false);
  const svgRef = React.useRef<SVGSVGElement | null>(null);

  // Rendered scale under preserveAspectRatio="meet" (uniform; letterboxed).
  const fit = (v: typeof view, rect: DOMRect) => {
    const scale = Math.min(rect.width / v.w, rect.height / v.h);
    return {
      scale,
      offX: (rect.width - v.w * scale) / 2,
      offY: (rect.height - v.h * scale) / 2,
    };
  };

  const onCanvasMouseDown = (e: React.MouseEvent) => {
    // Let nodes handle their own clicks; only pan from empty canvas.
    if ((e.target as Element).closest("[data-node-id]")) return;
    const svg = svgRef.current;
    if (!svg) return;
    e.preventDefault();
    const rect = svg.getBoundingClientRect();
    const { scale } = fit(view, rect);
    const startX = e.clientX;
    const startY = e.clientY;
    const startView = view;
    setDragging(true);
    const move = (ev: MouseEvent) => {
      setView({
        ...startView,
        x: startView.x - (ev.clientX - startX) / scale,
        y: startView.y - (ev.clientY - startY) / scale,
      });
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      setDragging(false);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  // Wheel-zoom around the cursor. Registered natively (non-passive) so we can
  // preventDefault the page scroll.
  React.useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      setView((v) => {
        const { scale, offX, offY } = fit(v, rect);
        const cx = v.x + (e.clientX - rect.left - offX) / scale;
        const cy = v.y + (e.clientY - rect.top - offY) / scale;
        const factor = e.deltaY > 0 ? 1.12 : 1 / 1.12;
        const minW = VB_W / 2.5; // most zoomed-in
        const maxW = VB_W * 1.6; // most zoomed-out
        const nw = Math.max(minW, Math.min(maxW, v.w * factor));
        const nh = nw * (VB_H / VB_W);
        const nfit = fit({ x: 0, y: 0, w: nw, h: nh }, rect);
        // Solve new origin so the cursor stays pinned to the same graph point.
        const nx = cx - (e.clientX - rect.left - nfit.offX) / nfit.scale;
        const ny = cy - (e.clientY - rect.top - nfit.offY) / nfit.scale;
        return { x: nx, y: ny, w: nw, h: nh };
      });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  return (
    <svg
      ref={svgRef}
      viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Product brain graph"
      onMouseDown={onCanvasMouseDown}
      onDoubleClick={() => setView(DEFAULT_VIEW)}
      style={{
        width: "100%",
        height: "100%",
        display: "block",
        cursor: dragging ? "grabbing" : "grab",
        touchAction: "none",
        // Base + radial lavender glow painted on the element itself, so they
        // always fill the panel regardless of pan/zoom or the meet-letterbox
        // bars (an in-SVG rect can't cover those).
        background:
          "radial-gradient(ellipse 55% 55% at 50% 45%, rgba(142,125,255,0.12), rgba(142,125,255,0.04) 60%, rgba(142,125,255,0) 100%), #0b0b0d",
      }}
    >
      <defs>
        <filter id="node-halo" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="7" />
        </filter>
      </defs>

      {/* Edges — base layer (dimmed when a focus is active and they're off-focus). */}
      <g fill="none">
        {visibleEdges.map((e) => {
          const a = posById.get(e.from_id)!;
          const b = posById.get(e.to_id)!;
          const dim = focusSet != null && !edgeFocused(e);
          return (
            <path
              key={e.id}
              d={edgePath(a, b)}
              stroke={dim ? "rgba(201,184,255,0.05)" : "rgba(201,184,255,0.16)"}
              strokeWidth={1}
            />
          );
        })}
      </g>

      {/* Edges — focused links drawn brighter on top. */}
      {focusSet != null && (
        <g fill="none">
          {visibleEdges.filter(edgeFocused).map((e) => {
            const a = posById.get(e.from_id)!;
            const b = posById.get(e.to_id)!;
            return (
              <path
                key={e.id}
                d={edgePath(a, b)}
                stroke="rgba(201,184,255,0.7)"
                strokeWidth={1.6}
              />
            );
          })}
        </g>
      )}

      {/* Nodes. */}
      <g>
        {laidOut.map((n) => {
          const color = nodeColor(n.type);
          const selected = n.id === selectedId;
          const isFocusCenter = focusId === n.id;
          const inFocus = focusSet == null || focusSet.has(n.id);
          const w = pillWidth(n.label);
          const r = dotRadius(n.id);
          const textX = -w / 2 + 13 + r + 6;
          return (
            <g
              key={n.id}
              transform={`translate(${n.px}, ${n.py})`}
              data-node-id={n.id}
              onClick={() => onSelect(n.id)}
              onMouseEnter={() => setHoverId(n.id)}
              onMouseLeave={() =>
                setHoverId((cur) => (cur === n.id ? null : cur))
              }
              style={{
                cursor: "pointer",
                opacity: inFocus ? 1 : 0.22,
                transition: "opacity .15s ease",
              }}
            >
              {(isFocusCenter || selected) && (
                <ellipse
                  cx={0}
                  cy={0}
                  rx={w / 2 + 6}
                  ry={PILL_H}
                  fill={color}
                  opacity={0.18}
                  filter="url(#node-halo)"
                />
              )}
              <rect
                x={-w / 2}
                y={-PILL_H / 2}
                rx={PILL_H / 2}
                width={w}
                height={PILL_H}
                fill="#141418"
                stroke={color}
                strokeWidth={selected ? 1.8 : isFocusCenter ? 1.5 : 1.1}
                opacity={selected || isFocusCenter ? 1 : 0.9}
              />
              <circle cx={-w / 2 + 13} cy={0} r={r} fill={color} />
              {/* Single-letter type glyph (F/D/C/U/B/M), centered in the dot. */}
              <text
                x={-w / 2 + 13}
                y={0}
                dominantBaseline="central"
                textAnchor="middle"
                fontSize={r * 1.15}
                fontFamily="var(--mono)"
                fontWeight={700}
                fill="#0b0b0d"
                data-glyph={n.type}
                style={{ pointerEvents: "none" }}
              >
                {nodeGlyph(n.type)}
              </text>
              <text
                x={textX}
                y={4}
                fontSize={11.5}
                fontFamily="var(--sans)"
                fill={inFocus ? "var(--text)" : "var(--text-3)"}
                fontWeight={selected ? 600 : 400}
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
