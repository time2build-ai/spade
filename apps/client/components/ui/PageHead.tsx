import * as React from "react";

export interface PageHeadProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  /** Title rendered as H1. Omit to provide custom left content via children. */
  title?: React.ReactNode;
  /** Right-aligned actions slot. */
  actions?: React.ReactNode;
}

/** View header bar: title/breadcrumb on the left, actions on the right. */
export function PageHead({
  title,
  actions,
  className,
  children,
  ...rest
}: PageHeadProps) {
  return (
    <div
      className={["page-head", className].filter(Boolean).join(" ")}
      {...rest}
    >
      {title !== undefined ? <h1>{title}</h1> : children}
      {actions !== undefined && <div className="page-head-right">{actions}</div>}
    </div>
  );
}
