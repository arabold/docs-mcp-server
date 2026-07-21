/**
 * Tiny inline trend line matching the mockup's KPI card `.spark` (a bare
 * `<polyline>` in a `0 0 100 30` viewBox, colored via `currentColor`).
 */
export interface SparklineProps {
  /** Data points, oldest to newest. Rendered evenly spaced along x. */
  values: number[];
  /** Adds the mockup's `.spark.accent` color variant. */
  accent?: boolean;
  className?: string;
}

const VIEW_WIDTH = 100;
const VIEW_HEIGHT = 30;
/** Vertical padding so peaks/troughs don't touch the viewBox edge. */
const PAD = 3;

/**
 * @example <Sparkline values={[24, 22, 23, 16, 14, 9, 6]} />
 */
export function Sparkline({ values, accent = false, className }: SparklineProps) {
  const classes = ["spark", accent ? "accent" : "", className ?? ""]
    .filter(Boolean)
    .join(" ");

  if (values.length < 2) {
    return (
      <svg
        className={classes}
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        aria-hidden="true"
      />
    );
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * VIEW_WIDTH;
      const y = VIEW_HEIGHT - PAD - ((value - min) / span) * (VIEW_HEIGHT - PAD * 2);
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg
      className={classes}
      viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polyline
        vectorEffect="non-scaling-stroke"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        points={points}
      />
    </svg>
  );
}
