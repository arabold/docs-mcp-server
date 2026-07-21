/**
 * Shared button, matching the mockup's `.btn` family
 * (`.btn--primary` / `.btn--ghost` / `.btn--danger`, optional `.btn--sm`).
 */
import type { ButtonHTMLAttributes } from "react";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual style. @default "primary" */
  variant?: "primary" | "ghost" | "danger";
  /** Size. @default "default" */
  size?: "default" | "sm";
}

/**
 * @example <Button variant="ghost" size="sm" onClick={cancel}>Cancel</Button>
 */
export function Button({
  variant = "primary",
  size = "default",
  className,
  type = "button",
  ...rest
}: ButtonProps) {
  const classes = [
    "btn",
    variant === "primary"
      ? "btn--primary"
      : variant === "ghost"
        ? "btn--ghost"
        : "btn--danger",
    size === "sm" ? "btn--sm" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  return <button type={type} className={classes} {...rest} />;
}
