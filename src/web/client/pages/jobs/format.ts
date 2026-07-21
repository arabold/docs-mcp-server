/**
 * Formatting helpers for the Jobs & Queue page. Kept page-local (not in the
 * shared `components/` library) since they're specific to how job timestamps
 * and scraper options are displayed here.
 */

/**
 * Formats a duration in milliseconds as `"Xm Ys"` (or `"Xh Ym"` once it
 * reaches an hour), matching the mockup's job-card elapsed/duration style
 * (e.g. `"2m 14s"`, `"4m 02s"`).
 */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  }
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

/**
 * Formats the duration between two timestamps (e.g. a finished job's
 * started/finished pair). Returns `"—"` when either end is missing.
 */
export function formatDuration(
  start: Date | null | undefined,
  end: Date | null | undefined,
): string {
  if (!start || !end) return "—";
  return formatElapsed(end.getTime() - start.getTime());
}

/**
 * Formats a past timestamp as a coarse relative phrase (`"12 min ago"`,
 * `"3 hours ago"`, `"2 days ago"`), matching the mockup's job history/needs
 * attention copy. `now` is passed in explicitly so callers can drive a
 * ticking clock without each formatter reading `Date.now()` independently.
 */
export function formatRelative(now: number, date: Date | null | undefined): string {
  if (!date) return "—";
  const diffMs = Math.max(0, now - date.getTime());
  const diffMin = Math.round(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin === 1) return "1 min ago";
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr === 1) return "1 hour ago";
  if (diffHr < 24) return `${diffHr} hours ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay === 1) return "1 day ago";
  return `${diffDay} days ago`;
}

/** Strips the protocol from a URL for compact display (e.g. in job cards). */
export function displayUrl(url: string | null | undefined): string {
  if (!url) return "";
  return url.replace(/^https?:\/\//, "");
}

/** Formats a 0-100 progress percentage from raw page counts, clamped and safe against division by zero. */
export function progressPercent(
  pages: number | undefined,
  maxPages: number | undefined,
): number {
  if (!pages || !maxPages || maxPages <= 0) return 0;
  return Math.min(100, Math.round((pages / maxPages) * 100));
}
