import * as React from "react";

export interface TogglePillProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> {
  on: boolean;
  /** Called with the next state when toggled. */
  onChange?: (next: boolean) => void;
  /** Larger 38x22 variant. */
  large?: boolean;
}

/** Track + thumb toggle. Controlled via `on`. */
export function TogglePill({
  on,
  onChange,
  large,
  className,
  onClick,
  type = "button",
  ...rest
}: TogglePillProps) {
  return (
    <button
      type={type}
      role="switch"
      aria-checked={on}
      data-state={on ? "on" : "off"}
      className={["toggle-pill", on && "on", large && "large", className]
        .filter(Boolean)
        .join(" ")}
      onClick={(e) => {
        onClick?.(e);
        onChange?.(!on);
      }}
      {...rest}
    >
      <span className="thumb" aria-hidden="true" />
    </button>
  );
}
