import * as React from "react";

export interface AvatarProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** AI agent variant: lavender gradient + dark text. */
  ai?: boolean;
}

/** 22px circle avatar with initials. */
export function Avatar({ ai, className, children, ...rest }: AvatarProps) {
  return (
    <span
      className={["avatar", ai && "ai", className].filter(Boolean).join(" ")}
      {...rest}
    >
      {children}
    </span>
  );
}
