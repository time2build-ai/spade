import * as React from "react";

/** Tiny line sparkline (reference Sparkline). */
export function Sparkline({ pts, color = "var(--red)" }: { pts: number[]; color?: string }) {
  const max = Math.max(...pts);
  const min = Math.min(...pts);
  const w = 220;
  const h = 36;
  const pad = 2;
  const sx = (i: number) => pad + (i / (pts.length - 1)) * (w - pad * 2);
  const sy = (v: number) => pad + (1 - (v - min) / (max - min || 1)) * (h - pad * 2);
  const d = pts.map((v, i) => (i ? "L" : "M") + sx(i).toFixed(1) + "," + sy(v).toFixed(1)).join(" ");
  return (
    <svg width={w} height={h} style={{ marginTop: 6, display: "block", maxWidth: "100%" }} data-testid="sparkline">
      <path d={d} fill="none" stroke={color} strokeWidth="1.4" />
      <circle cx={sx(pts.length - 1)} cy={sy(pts[pts.length - 1])} r="2.5" fill={color} />
    </svg>
  );
}
