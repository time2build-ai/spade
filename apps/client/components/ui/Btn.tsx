import * as React from "react";

export type BtnVariant = "default" | "primary" | "ghost";
export type BtnSize = "sm" | "xs";

export interface BtnProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: BtnVariant;
  size?: BtnSize;
}

/** Pill button. Variants: default / primary (lavender gradient) / ghost. */
export function Btn({
  variant = "default",
  size,
  className,
  children,
  type = "button",
  ...rest
}: BtnProps) {
  const cls = [
    "btn",
    variant === "primary" && "primary",
    variant === "ghost" && "ghost",
    size,
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button type={type} className={cls} {...rest}>
      {children}
    </button>
  );
}
