/**
 * Segmented control matching the mockup's `.seg` (compact, e.g. chart range)
 * and `.seg-full` (evenly-stretched, e.g. drawer scope/scrape-mode pickers)
 * variants. Fully controlled — the caller owns `value`/`onChange`.
 */
import type { ReactNode } from "react";

export interface SegmentedControlOption<T extends string> {
  value: T;
  label: ReactNode;
}

export interface SegmentedControlProps<T extends string> {
  options: ReadonlyArray<SegmentedControlOption<T>>;
  value: T;
  onChange: (value: T) => void;
  /** `"full"` stretches segments evenly (`.seg-full`); `"compact"` sizes to content (`.seg`). @default "compact" */
  variant?: "compact" | "full";
  /**
   * Optional content rendered below the control, e.g. a live-updating
   * description. Rendered as-is with no imposed styling — the mockup uses
   * this for two different looks (an informational `.note` box for the
   * scope picker, a plain `.hint` caption for scrape mode), so the caller
   * supplies the exact markup for whichever it needs.
   */
  hint?: ReactNode;
  className?: string;
  "aria-label"?: string;
}

/**
 * @example
 * <SegmentedControl
 *   variant="full"
 *   options={[{ value: "subpages", label: "Under this path" }, { value: "hostname", label: "Entire site" }]}
 *   value={scope}
 *   onChange={setScope}
 *   hint={<div className="note"><Icon name="i-globe" size="sm" /><span>Indexes only pages under /docs/ on example.com.</span></div>}
 * />
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  variant = "compact",
  hint,
  className,
  "aria-label": ariaLabel,
}: SegmentedControlProps<T>) {
  const groupClass = [variant === "full" ? "seg-full" : "seg", className ?? ""]
    .filter(Boolean)
    .join(" ");
  return (
    <div>
      <div className={groupClass} role="group" aria-label={ariaLabel}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className={option.value === value ? "is-active" : ""}
            aria-pressed={option.value === value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
      {hint ? <div style={{ marginTop: 8 }}>{hint}</div> : null}
    </div>
  );
}
