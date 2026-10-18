/**
 * App-wide live cache invalidation driven by server events.
 *
 * Mounted once in the app shell so every view stays current without a manual
 * refresh, regardless of which page is open: job events refresh the job list
 * (Jobs queue, Overview active jobs, sidebar active-job badge), while
 * `LIBRARY_CHANGE` — emitted when a job changes status or a version is removed —
 * refreshes the library list, the system-health snapshot whose totals depend
 * on the corpus (Overview KPIs, Libraries table, sidebar counts/footer), and
 * the Overview activity chart.
 *
 * Job and library invalidations are debounced independently because
 * `JOB_PROGRESS` fires once per scraped page and would otherwise trigger a
 * refetch per page.
 */
import { useCallback, useEffect, useRef } from "react";
import { EventType } from "../../../events/types";
import { useEventsSubscription } from "../api/hooks";
import { trpc } from "../api/trpc";

/** Stable subscription filter — module-level so its identity never changes across renders. */
const LIVE_EVENTS_INPUT = {
  events: [
    EventType.JOB_STATUS_CHANGE,
    EventType.JOB_PROGRESS,
    EventType.JOB_LIST_CHANGE,
    EventType.LIBRARY_CHANGE,
  ],
};

const DEBOUNCE_MS = 250;

/**
 * Subscribes to pipeline/library events and invalidates the affected queries.
 * Call once, high in the tree (see `App.tsx` `Shell`).
 */
export function useLiveInvalidation(): void {
  const utils = trpc.useUtils();

  const jobsTimer = useRef<number | null>(null);
  const libraryTimer = useRef<number | null>(null);

  const onEvent = useCallback(
    (event: { type: string; payload: unknown }) => {
      if (event.type === EventType.LIBRARY_CHANGE) {
        if (libraryTimer.current != null) return;
        libraryTimer.current = window.setTimeout(() => {
          libraryTimer.current = null;
          utils.listLibraries.invalidate();
          utils.getSystemHealth.invalidate();
          utils.getActivityHistory.invalidate();
        }, DEBOUNCE_MS);
        return;
      }
      // Every other subscribed event is job-related.
      if (jobsTimer.current != null) return;
      jobsTimer.current = window.setTimeout(() => {
        jobsTimer.current = null;
        utils.getJobs.invalidate();
      }, DEBOUNCE_MS);
    },
    [utils],
  );

  useEffect(
    () => () => {
      if (jobsTimer.current != null) window.clearTimeout(jobsTimer.current);
      if (libraryTimer.current != null) window.clearTimeout(libraryTimer.current);
    },
    [],
  );

  useEventsSubscription(LIVE_EVENTS_INPUT, onEvent);
}
