import * as React from "react";

export type PriorityLevel = 0 | 1 | 2 | 3;

export interface PriorityProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Any int; clamped to 0–3 (API priority is an untyped int). */
  level: number;
}

/** 8px priority dot. p0 red+glow, p1 amber, p2 blue, p3 faint. */
export function Priority({ level, className, ...rest }: PriorityProps) {
  const p = Math.min(3, Math.max(0, Math.round(level)));
  return (
    <span
      className={["priority", `p${p}`, className].filter(Boolean).join(" ")}
      aria-label={`priority ${p}`}
      {...rest}
    />
  );
}
