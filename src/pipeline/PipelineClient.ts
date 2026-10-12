/**
 * Pipeline backed by a remote worker: every operation calls the worker's
 * application API through a shared {@link ApiClient}.
 */

import { TRPCError } from "@trpc/server";
import type { EventBusService } from "../events/EventBusService";
import type { RemoteEventProxy } from "../events/RemoteEventProxy";
import { EventType } from "../events/types";
import type { ScraperOptions } from "../scraper/types";
import type { ApiClient } from "../services/apiClient";
import { normalizeVersionLabel } from "../store/types";
import { logger } from "../utils/logger";
import {
  type EnqueueScrapeOptions,
  type IPipeline,
  RELAYED_ENQUEUE_ERROR_CODES,
  type RelayedEnqueueErrorCode,
} from "./trpc/interfaces";
import { type PipelineJob, PipelineJobStatus } from "./types";

/**
 * How long submitting the first job waits for the worker's event stream, so the
 * job's first events reach this process.
 */
export const EVENTS_CONNECT_TIMEOUT_MS = 5000;

/**
 * How often `waitForJobCompletion` asks the worker for the job's state while
 * the worker's events reach this process. The lookup only catches an event lost
 * around a reconnect.
 */
const JOB_SAFETY_LOOKUP_INTERVAL_MS = 10_000;

/** How often `waitForJobCompletion` asks while the worker's events do not arrive. */
const JOB_POLL_INTERVAL_MS = 1000;

/** How long job lookups may keep failing before `waitForJobCompletion` gives up. */
const JOB_LOOKUP_GIVE_UP_MS = 30_000;

/**
 * Re-raises a worker's enqueue error as a `TRPCError` with the same code and
 * message, so this process's own router relays it unchanged (the web UI then
 * sees the same 409/400/404 as in front of a local pipeline). The worker's router
 * already decided which errors a caller can act on; anything it left as an
 * internal error, or a failure that never reached it, is wrapped as a plain
 * error prefixed with `failure`.
 *
 * @returns The error to rethrow.
 */
function toEnqueueError(error: unknown, failure: string): Error {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as { data?: { code?: unknown } } | null)?.data?.code;
  return RELAYED_ENQUEUE_ERROR_CODES.includes(code as RelayedEnqueueErrorCode)
    ? new TRPCError({ code: code as RelayedEnqueueErrorCode, message, cause: error })
    : new Error(`${failure}: ${message}`);
}

/**
 * Implements {@link IPipeline} by delegating every operation to a remote worker.
 */
export class PipelineClient implements IPipeline {
  /**
   * @param client The worker's API client. Whoever created it closes it.
   * @param eventBus The local bus that the worker's relayed job events arrive on.
   * @param relay The relay that brings those events; whoever created it disconnects it.
   */
  constructor(
    private readonly client: ApiClient,
    private readonly eventBus: EventBusService,
    private readonly relay: RemoteEventProxy,
  ) {}

  /** The first job submission's wait for the event stream, shared by later ones. */
  private eventsReady: Promise<void> | undefined;

  /**
   * Waits, once, for the worker's event stream before the first job is
   * submitted, so a job that starts at once does not lose its first events.
   * When the stream is not live in time, warns once and lets jobs go ahead;
   * waits then rely on asking the worker.
   */
  private waitForEvents(): Promise<void> {
    this.eventsReady ??= this.relay.connect(EVENTS_CONNECT_TIMEOUT_MS).then((live) => {
      if (!live) {
        logger.warn(
          "⚠️  Live job updates from the worker are unavailable; progress is not shown and waits check the job's state instead",
        );
      }
    });
    return this.eventsReady;
  }

  async enqueueScrapeJob(
    library: string,
    version: string | undefined | null,
    options: ScraperOptions,
    enqueue?: EnqueueScrapeOptions,
  ): Promise<string> {
    await this.waitForEvents();
    try {
      const normalizedVersion = normalizeVersionLabel(version) || null;
      const result = await this.client.enqueueScrapeJob.mutate({
        library,
        version: normalizedVersion,
        options,
        onExisting: enqueue?.onExisting,
      });
      logger.debug(`Job ${result.jobId} enqueued successfully`);
      return result.jobId;
    } catch (error) {
      throw toEnqueueError(error, "Failed to enqueue job");
    }
  }

  async enqueueRefreshJob(
    library: string,
    version: string | undefined | null,
    options?: { preserveHashes?: boolean },
  ): Promise<string> {
    await this.waitForEvents();
    try {
      const normalizedVersion = normalizeVersionLabel(version) || null;
      const result = await this.client.enqueueRefreshJob.mutate({
        library,
        version: normalizedVersion,
        options,
      });
      logger.debug(`Refresh job ${result.jobId} enqueued successfully`);
      return result.jobId;
    } catch (error) {
      throw toEnqueueError(error, "Failed to enqueue refresh job");
    }
  }

  async getJob(jobId: string): Promise<PipelineJob | undefined> {
    try {
      // superjson automatically deserializes Date objects
      return await this.client.getJob.query({ id: jobId });
    } catch (error) {
      throw new Error(
        `Failed to get job ${jobId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async getJobs(status?: PipelineJobStatus): Promise<PipelineJob[]> {
    try {
      // superjson automatically deserializes Date objects
      const result = await this.client.getJobs.query({ status });
      return result.jobs || [];
    } catch (error) {
      logger.error(`❌ Failed to get jobs from external worker: ${error}`);
      throw error;
    }
  }

  async cancelJob(jobId: string): Promise<void> {
    try {
      await this.client.cancelJob.mutate({ id: jobId });
      logger.debug(`Job cancelled via external worker: ${jobId}`);
    } catch (error) {
      logger.error(`❌ Failed to cancel job ${jobId} via external worker: ${error}`);
      throw error;
    }
  }

  async clearCompletedJobs(): Promise<number> {
    try {
      const result = await this.client.clearCompletedJobs.mutate();
      logger.debug(`Cleared ${result.count} completed jobs via external worker`);
      return result.count || 0;
    } catch (error) {
      logger.error(`❌ Failed to clear completed jobs via external worker: ${error}`);
      throw error;
    }
  }

  /**
   * Waits until the worker reports the job as completed, failed, or cancelled.
   * Like `PipelineManager.waitForJobCompletion`, it resolves for completed and
   * cancelled jobs and rejects for failed ones.
   *
   * The relayed status events settle the wait. It also asks the worker for the
   * job right away, which covers a job that finished before the wait began,
   * and then again: every few seconds while events arrive, to catch one lost
   * around a reconnect, and every second while they do not.
   *
   * @param jobId The job to wait for.
   * @throws Error if the job failed, the worker does not know it, or the worker
   * stays unreachable beyond a bounded period.
   */
  async waitForJobCompletion(jobId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let pollTimer: ReturnType<typeof setTimeout> | undefined;
      let lastAnswerAt = Date.now();

      const finish = (error?: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        unsubscribe();
        clearTimeout(pollTimer);
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };

      const settleIfDone = (
        job: Pick<PipelineJob, "status" | "error" | "errorMessage">,
      ) => {
        switch (job.status) {
          case PipelineJobStatus.COMPLETED:
          case PipelineJobStatus.CANCELLED:
            finish();
            break;
          case PipelineJobStatus.FAILED:
            // The worker emits the FAILED status before it sets `error`, so a
            // relayed event carries the text only in `errorMessage`
            finish(
              new Error(job.error?.message || job.errorMessage || `Job ${jobId} failed`),
            );
            break;
        }
      };

      const unsubscribe = this.eventBus.on(EventType.JOB_STATUS_CHANGE, (job) => {
        if (job.id === jobId) {
          settleIfDone(job);
        }
      });

      const poll = async () => {
        try {
          const job = await this.getJob(jobId);
          lastAnswerAt = Date.now();
          if (!job) {
            // Clearing finished jobs or restarting the worker drops the record
            finish(
              new Error(
                `Job not found: ${jobId}. The worker no longer knows it; it may have been cleared or the worker restarted.`,
              ),
            );
            return;
          }
          settleIfDone(job);
        } catch (error) {
          // getJob only throws Error instances
          if (Date.now() - lastAnswerAt >= JOB_LOOKUP_GIVE_UP_MS) {
            finish(error as Error);
            return;
          }
          logger.debug(`Job lookup for ${jobId} failed: ${error}`);
        }
        if (!settled) {
          const interval = this.relay.isActive()
            ? JOB_SAFETY_LOOKUP_INTERVAL_MS
            : JOB_POLL_INTERVAL_MS;
          pollTimer = setTimeout(poll, interval);
        }
      };

      void poll();
    });
  }

  /** Removes the version on the worker, which cancels its own job for it first. */
  async removeVersion(
    library: string,
    version: string | undefined | null,
  ): Promise<void> {
    await this.client.removeDocs.mutate({ library, version: version ?? null });
  }
}
