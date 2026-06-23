import * as React from "react";
import { Icon, type IconName } from "../Icon";

export interface IconBtnProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Icon name from the sprite. Omit to render custom children. */
  icon?: IconName;
  iconSize?: number;
}

/** Square bordered icon button. */
export function IconBtn({
  icon,
  iconSize = 14,
  className,
  children,
  type = "button",
  ...rest
}: IconBtnProps) {
  return (
    <button
      type={type}
      className={["icon-btn", className].filter(Boolean).join(" ")}
      {...rest}
    >
      {icon ? <Icon name={icon} size={iconSize} /> : children}
    </button>
  );
}
