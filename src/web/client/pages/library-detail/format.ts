/**
 * Shared formatting/derivation helpers for the Libraries list and the
 * Library Detail page (including its Chunk Explorer). Kept in this
 * page-local folder — not a generic cross-app utility — since `Libraries.tsx`
 * and everything under `pages/library-detail/` are the only consumers.
 */
import { VersionStatus } from "../../../../store/types";
import type { StatusVariant } from "../../components/StatusDot";

/** Derived display status: a color variant, a short label, and whether the dot should pulse. */
export interface StatusInfo {
  variant: StatusVariant;
  label: string;
  pulse: boolean;
}

/**
 * Derives a single display status from one or more version statuses. When
 * called with several statuses (e.g. every version of a library), the
 * worst/most-urgent one wins: running/updating &gt; failed &gt; queued &gt; indexed &gt; idle.
 */
export function aggregateStatus(statuses: VersionStatus[]): StatusInfo {
  if (
    statuses.includes(VersionStatus.RUNNING) ||
    statuses.includes(VersionStatus.UPDATING)
  ) {
    return { variant: "run", label: "indexing", pulse: true };
  }
  if (statuses.includes(VersionStatus.FAILED)) {
    return { variant: "err", label: "failed", pulse: false };
  }
  if (statuses.includes(VersionStatus.QUEUED)) {
    return { variant: "queued", label: "queued", pulse: false };
  }
  if (statuses.includes(VersionStatus.COMPLETED)) {
    return { variant: "ok", label: "indexed", pulse: false };
  }
  return { variant: "idle", label: "not indexed", pulse: false };
}

/** Formats an ISO timestamp as a short relative time (e.g. "2d ago"), or "—" for `null`. */
export function formatRelativeTime(iso: string | null): string {
  if (!iso) return "—";
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.round(diffMs / 60_000);
  if (diffMin < 1) return "now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return `${Math.round(diffDay / 7)}w ago`;
}

export { displayUrl } from "../../utils/format";

/** Labels a version for the Library Detail page's tab switcher; the empty string ("unversioned") reads as "Latest". */
export function versionTabLabel(version: string): string {
  return version || "Latest";
}

/** Labels a version for the Libraries list's version chips, matching the mockup's "unversioned" wording. */
export function versionChipLabel(version: string): string {
  return version || "unversioned";
}

/** Locale-formats a count, e.g. `14880` -&gt; `"14,880"`. */
export function formatCount(n: number): string {
  return n.toLocaleString();
}

/** Placeholder shown for a masked header value — names stay visible, values never are. */
export const MASKED_HEADER_VALUE = "••••••••";
