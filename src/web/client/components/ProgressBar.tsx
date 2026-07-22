/**
 * Progress bar matching the mockup's `.bar`/`.bar__fill` (used for job
 * progress, with `ok`/`queued`/`err` fill color variants).
 */
export interface ProgressBarProps {
  /** 0-100. Clamped into range. */
  value: number;
  /** Fill color variant. @default "run" (the unmodified `--run` blue) */
  variant?: "run" | "ok" | "queued" | "err";
  className?: string;
}

/**
 * @example <ProgressBar value={64} />
 */
export function ProgressBar({ value, variant = "run", className }: ProgressBarProps) {
  const pct = Math.min(100, Math.max(0, value));
  const classes = ["bar__fill", variant === "run" ? "" : variant, className ?? ""]
    .filter(Boolean)
    .join(" ");
  return (
    <div
      className="bar"
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className={classes} style={{ width: `${pct}%` }} />
    </div>
  );
}
