/**
 * Small square-ish status indicator (`.dot-sq`), used standalone in the
 * sidebar/tables and embedded inside {@link Pill}.
 */
export type StatusVariant = "ok" | "run" | "queued" | "err" | "idle";

export interface StatusDotProps {
  /** Color variant. @default "idle" */
  variant?: StatusVariant;
  /** Animates with the `pulse` keyframe (used for actively-running states). */
  pulse?: boolean;
  className?: string;
}

/**
 * @example <StatusDot variant="run" pulse />
 */
export function StatusDot({
  variant = "idle",
  pulse = false,
  className,
}: StatusDotProps) {
  const classes = [
    "dot-sq",
    variant === "idle" ? "" : variant,
    pulse ? "pulse" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  return <span className={classes} />;
}
