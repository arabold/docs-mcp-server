/**
 * Hand-rolled area chart matching the mockup's "Indexing activity" panel
 * chart: gridlines, a gradient-filled area, a stroke line, and an
 * emphasized (larger, ringed) endpoint marker on the most recent point.
 */
import { useId } from "react";

export interface AreaChartProps {
  /** Data points, oldest to newest. */
  values: number[];
  /** Labels for the horizontal gridlines, top to bottom (e.g. `["1k", "600", "300", "0"]`). */
  yLabels?: string[];
  /** Labels evenly spaced along the x-axis (e.g. `["Jul 7", "Jul 11", "Jul 15", "Jul 19"]`). */
  xLabels?: string[];
  /** Accessible label for the chart. */
  label?: string;
  /** viewBox width. @default 760 */
  width?: number;
  /** viewBox height. @default 240 */
  height?: number;
  className?: string;
}

const MARGIN_LEFT = 40;
const MARGIN_RIGHT = 30;
const MARGIN_TOP = 30;
const MARGIN_BOTTOM = 30;
const GRIDLINE_COUNT = 4;

/**
 * @example
 * <AreaChart
 *   values={[62, 84, 66, 108, 78, 118, 128, 98, 148, 138, 118, 168, 148, 198]}
 *   yLabels={["1k", "600", "300", "0"]}
 *   xLabels={["Jul 7", "Jul 11", "Jul 15", "Jul 19"]}
 *   label="Pages processed over the last 14 days"
 * />
 */
export function AreaChart({
  values,
  yLabels,
  xLabels,
  label,
  width = 760,
  height = 240,
  className,
}: AreaChartProps) {
  const gradientId = useId();
  const classes = className ? `chart ${className}` : "chart";

  if (values.length < 2) {
    return (
      <svg
        className={classes}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={label}
      />
    );
  }

  const plotLeft = MARGIN_LEFT;
  const plotRight = width - MARGIN_RIGHT;
  const plotTop = MARGIN_TOP;
  const plotBottom = height - MARGIN_BOTTOM;

  const min = Math.min(0, ...values);
  const max = Math.max(...values);
  const span = max - min || 1;

  const coords = values.map((value, index) => {
    const x = plotLeft + (index / (values.length - 1)) * (plotRight - plotLeft);
    const y = plotBottom - ((value - min) / span) * (plotBottom - plotTop);
    return [x, y] as const;
  });

  const linePath = coords
    .map(([x, y], index) => `${index === 0 ? "M" : "L"}${x},${y}`)
    .join(" ");
  const [lastX, lastY] = coords[coords.length - 1] ?? [plotLeft, plotBottom];
  const [firstX] = coords[0] ?? [plotLeft, plotBottom];
  const areaPath = `${linePath} L${lastX},${plotBottom} L${firstX},${plotBottom} Z`;

  const gridY = Array.from(
    { length: GRIDLINE_COUNT },
    (_, i) => plotTop + (i * (plotBottom - plotTop)) / (GRIDLINE_COUNT - 1),
  );

  return (
    <svg
      className={classes}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.22" />
          <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <g stroke="var(--border)" strokeWidth="1">
        {gridY.map((y) => (
          <line key={y} x1={plotLeft} y1={y} x2={plotRight} y2={y} />
        ))}
      </g>
      {yLabels ? (
        <g
          fill="var(--text-faint)"
          fontFamily="ui-monospace, monospace"
          fontSize="10"
          textAnchor="end"
        >
          {yLabels.map((text, i) => (
            <text key={text} x={plotLeft - 8} y={(gridY[i] ?? plotTop) + 4}>
              {text}
            </text>
          ))}
        </g>
      ) : null}
      <path fill={`url(#${gradientId})`} d={areaPath} />
      <path
        fill="none"
        stroke="var(--primary)"
        strokeWidth="2.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        d={linePath}
      />
      <circle
        cx={lastX}
        cy={lastY}
        r="4.5"
        fill="var(--surface)"
        stroke="var(--primary)"
        strokeWidth="2.5"
      />
      {xLabels ? (
        <g
          fill="var(--text-faint)"
          fontFamily="ui-monospace, monospace"
          fontSize="10"
          textAnchor="middle"
        >
          {xLabels.map((text, i) => (
            <text
              key={text}
              x={plotLeft + (i / (xLabels.length - 1 || 1)) * (plotRight - plotLeft)}
              y={height - 12}
            >
              {text}
            </text>
          ))}
        </g>
      ) : null}
    </svg>
  );
}
