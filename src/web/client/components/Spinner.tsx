/**
 * Small spinning loading indicator (`.spinner`, a design-system addition —
 * the mockup has no loading state since it's static markup). Respects
 * `prefers-reduced-motion` via the global rule in `theme.css`.
 */
export interface SpinnerProps {
  /** Diameter in pixels. @default 18 */
  size?: number;
  className?: string;
}

/**
 * @example <Spinner size={14} />
 */
export function Spinner({ size = 18, className }: SpinnerProps) {
  const classes = className ? `spinner ${className}` : "spinner";
  return (
    <span
      className={classes}
      role="status"
      aria-label="Loading"
      style={{ width: size, height: size }}
    />
  );
}

/**
 * Centered spinner + label, for whole-panel/page loading states.
 * @example <Loading label="Loading libraries…" />
 */
export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "24px",
        color: "var(--text-muted)",
      }}
    >
      <Spinner />
      <span>{label}</span>
    </div>
  );
}
