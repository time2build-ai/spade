import * as React from "react";

export type KbdProps = React.HTMLAttributes<HTMLElement>;

/** Mono keycap. */
export function Kbd({ className, children, ...rest }: KbdProps) {
  return (
    <kbd className={["kbd", className].filter(Boolean).join(" ")} {...rest}>
      {children}
    </kbd>
  );
}
