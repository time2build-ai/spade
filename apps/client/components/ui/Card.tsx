import * as React from "react";

export type CardProps = React.HTMLAttributes<HTMLDivElement>;

/** Base surface: bg-1 + line border + 8px radius. */
export function Card({ className, children, ...rest }: CardProps) {
  return (
    <div className={["card", className].filter(Boolean).join(" ")} {...rest}>
      {children}
    </div>
  );
}
