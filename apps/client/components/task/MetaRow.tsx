import * as React from "react";

export interface MetaRowProps {
  label: string;
  children: React.ReactNode;
}

/** A label/value row for the task-detail side rail (`.meta-row`). */
export function MetaRow({ label, children }: MetaRowProps) {
  return (
    <div className="meta-row">
      <span className="k">{label}</span>
      <span>{children}</span>
    </div>
  );
}
