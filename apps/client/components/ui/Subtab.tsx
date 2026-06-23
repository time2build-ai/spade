import * as React from "react";

export interface SubtabProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
}

/** Sub-nav tab; active gets text color + 2px accent bottom border. */
export function Subtab({
  active,
  className,
  children,
  type = "button",
  ...rest
}: SubtabProps) {
  return (
    <button
      type={type}
      aria-current={active ? "page" : undefined}
      className={["subtab", active && "active", className]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      {children}
    </button>
  );
}
