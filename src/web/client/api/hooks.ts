/**
 * Thin React Query hooks wrapping the tRPC procedures the admin dashboard
 * consumes. Each hook is a direct, typed pass-through to `trpc.<procedure>` —
 * no business logic lives here. Add a new hook whenever a page needs a
 * procedure not yet listed below; keep it just as thin.
 */
import type { inferRouterInputs } from "@trpc/server";
import type { AppRouter } from "../../../services/appRouter";
import { trpc } from "./trpc";

type RouterInputs = inferRouterInputs<AppRouter>;

/** Lists every indexed library along with its version summaries. */
export function useListLibraries() {
  return trpc.listLibraries.useQuery();
}

/** Lists pipeline jobs, optionally filtered by status. */
export function useGetJobs(input?: RouterInputs["getJobs"]) {
  return trpc.getJobs.useQuery(input);
}

/** Searches indexed documentation for a library/version. Disabled by default until `enabled` is true. */
export function useSearch(input: RouterInputs["search"], enabled: boolean) {
  return trpc.search.useQuery(input, { enabled });
}

/** Enqueues a scrape job for a library. */
export function useEnqueueScrapeJob() {
  return trpc.enqueueScrapeJob.useMutation();
}

/** Enqueues a refresh job for an already-indexed library version. */
export function useEnqueueRefreshJob() {
  return trpc.enqueueRefreshJob.useMutation();
}

/** Cancels a running or queued pipeline job. */
export function useCancelJob() {
  return trpc.cancelJob.useMutation();
}

/** Clears completed, cancelled, and failed jobs from the queue. */
export function useClearCompletedJobs() {
  return trpc.clearCompletedJobs.useMutation();
}

/** Removes an indexed library version. */
export function useRemoveVersion() {
  return trpc.removeVersion.useMutation();
}

/** Fetches the stored scraper options for a given indexed version. */
export function useGetScraperOptions(
  input: RouterInputs["getScraperOptions"],
  enabled: boolean,
) {
  return trpc.getScraperOptions.useQuery(input, { enabled });
}

/** Lists stored chunks for a library version, paginated and optionally filtered by content. */
export function useListVersionChunks(
  input: RouterInputs["listVersionChunks"],
  enabled: boolean,
) {
  return trpc.listVersionChunks.useQuery(input, { enabled });
}

/** Fetches aggregate chunk/page/embedding statistics for a library version. */
export function useVersionStats(
  input: RouterInputs["getVersionStats"],
  enabled: boolean,
) {
  return trpc.getVersionStats.useQuery(input, { enabled });
}

/**
 * Fetches an honest snapshot of the running server's configuration (which
 * services are enabled, worker wiring, active embedding provider, MCP/auth
 * exposure, app version). Powers the Overview system-health panel, the
 * sidebar status footer, and the Settings screen.
 */
export function useSystemHealth() {
  return trpc.getSystemHealth.useQuery();
}

/**
 * Subscribes to real-time application events (job status, job progress,
 * library changes) over the WebSocket link.
 * @param input - Optional filter selecting which event types to receive; omit for all events.
 * @param onData - Callback invoked with each event as it arrives.
 */
export function useEventsSubscription(
  input: RouterInputs["events"]["subscribe"],
  onData: (event: { type: string; payload: unknown }) => void,
) {
  return trpc.events.subscribe.useSubscription(input, { onData });
}
