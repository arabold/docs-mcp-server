/**
 * Status badge matching the mockup's `.pill` family
 * (`.pill--ok` / `.pill--run` / `.pill--queued` / `.pill--err`, plain for "idle").
 */
import type { ReactNode } from "react";
import { StatusDot, type StatusVariant } from "./StatusDot";

export interface PillProps {
  /** Color variant. @default "idle" */
  variant?: StatusVariant;
  /** Renders the small leading {@link StatusDot}. @default true */
  withDot?: boolean;
  /** Pulses the leading dot (only meaningful when `withDot` and variant "run"). */
  pulse?: boolean;
  children: ReactNode;
  className?: string;
}

/**
 * @example <Pill variant="run" pulse>running</Pill>
 */
export function Pill({
  variant = "idle",
  withDot = true,
  pulse = false,
  children,
  className,
}: PillProps) {
  const classes = ["pill", variant === "idle" ? "" : `pill--${variant}`, className ?? ""]
    .filter(Boolean)
    .join(" ");
  return (
    <span className={classes}>
      {/* No color variant on the inner dot: `.pill .dot-sq` uses `background: currentColor`
          so the dot always matches the pill's own text color (see components.css). */}
      {withDot ? <StatusDot pulse={pulse} /> : null}
      {children}
    </span>
  );
}
