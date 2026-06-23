import * as React from "react";

export type ChipType =
  | "feature"
  | "decision"
  | "feedback"
  | "bug"
  | "metric"
  | "convention"
  | "meeting";

export interface ChipProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Optional type; omit for a neutral grey base chip. */
  type?: ChipType;
}

/** Mono badge with a leading colored dot. Type colors both dot and text. */
export function Chip({ type, className, children, ...rest }: ChipProps) {
  return (
    <span
      className={["chip", type, className].filter(Boolean).join(" ")}
      {...rest}
    >
      <span className="d" aria-hidden="true" />
      {children}
    </span>
  );
}
