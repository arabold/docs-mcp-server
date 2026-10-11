/**
 * tRPC client implementation of the Pipeline interface.
 * Delegates all pipeline operations to an external worker via tRPC router.
 * Uses WebSocket link for subscriptions and HTTP for queries/mutations.
 */

import {
  createTRPCProxyClient,
  createWSClient,
  httpBatchLink,
  splitLink,
  wsLink,
} from "@trpc/client";
import { TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { EventBusService } from "../events/EventBusService";
import { EventType } from "../events/types";
import type { ScraperOptions } from "../scraper/types";
import { normalizeVersionLabel } from "../store/types";
import { logger } from "../utils/logger";
import { toWebSocketUrl } from "../utils/url";
import {
  type EnqueueScrapeOptions,
  type IPipeline,
  RELAYED_ENQUEUE_ERROR_CODES,
  type RelayedEnqueueErrorCode,
} from "./trpc/interfaces";
import type { PipelineRouter } from "./trpc/router";
import {
  type PipelineJob,
  PipelineJobStatus,
  type PipelineManagerCallbacks,
} from "./types";

/** How often `waitForJobCompletion` asks the worker for the job's state. */
const JOB_POLL_INTERVAL_MS = 1000;

/** Consecutive failed job lookups after which `waitForJobCompletion` gives up. */
const MAX_FAILED_JOB_POLLS = 5;

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
 * HTTP client that implements the IPipeline interface by delegating to external worker.
 */
export class PipelineClient implements IPipeline {
  private readonly baseUrl: string;
  private readonly wsUrl: string;
  private readonly client: ReturnType<typeof createTRPCProxyClient<PipelineRouter>>;
  private readonly wsClient: ReturnType<typeof createWSClient>;
  private readonly eventBus: EventBusService;

  constructor(serverUrl: string, eventBus: EventBusService) {
    this.baseUrl = serverUrl.replace(/\/$/, "");
    this.eventBus = eventBus;

    // The WebSocket uses the same URL as HTTP, so it reaches a worker that a
    // reverse proxy serves under a path.
    this.wsUrl = toWebSocketUrl(this.baseUrl);

    // Create WebSocket client for subscriptions
    this.wsClient = createWSClient({
      url: this.wsUrl,
    });

    // Create tRPC client with split link:
    // - Subscriptions use WebSocket
    // - Queries and mutations use HTTP
    this.client = createTRPCProxyClient<PipelineRouter>({
      links: [
        splitLink({
          condition: (op) => op.type === "subscription",
          true: wsLink({ client: this.wsClient, transformer: superjson }),
          false: httpBatchLink({ url: this.baseUrl, transformer: superjson }),
        }),
      ],
    });

    logger.debug(
      `PipelineClient (tRPC) created for: ${this.baseUrl} (ws: ${this.wsUrl})`,
    );
  }

  async start(): Promise<void> {
    // Check connectivity via ping procedure
    try {
      await this.client.ping.query();
      logger.debug("PipelineClient connected to external worker via tRPC");
    } catch (error) {
      throw new Error(
        `Failed to connect to external worker at ${this.baseUrl}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async stop(): Promise<void> {
    // Close WebSocket connection
    this.wsClient.close();

    logger.debug("PipelineClient stopped");
  }

  async enqueueScrapeJob(
    library: string,
    version: string | undefined | null,
    options: ScraperOptions,
    enqueue?: EnqueueScrapeOptions,
  ): Promise<string> {
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
   * Status events on the local bus settle the wait as soon as a
   * `RemoteEventProxy` relays them, but only the server sets one up. The wait
   * therefore also asks the worker for the job right away and then every
   * second, which serves the CLI and covers a job that finished before the
   * listener was attached.
   *
   * @param jobId The job to wait for.
   * @throws Error if the job failed, the worker does not know it, or the worker
   * stays unreachable for several lookups in a row.
   */
  async waitForJobCompletion(jobId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let pollTimer: ReturnType<typeof setTimeout> | undefined;
      let failedPolls = 0;

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

      const settleIfDone = (job: Pick<PipelineJob, "status" | "error">) => {
        switch (job.status) {
          case PipelineJobStatus.COMPLETED:
          case PipelineJobStatus.CANCELLED:
            finish();
            break;
          case PipelineJobStatus.FAILED:
            finish(new Error(job.error?.message ?? `Job ${jobId} failed`));
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
          failedPolls = 0;
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
          failedPolls++;
          if (failedPolls >= MAX_FAILED_JOB_POLLS) {
            finish(error as Error);
            return;
          }
          logger.debug(
            `Job lookup ${failedPolls}/${MAX_FAILED_JOB_POLLS} for ${jobId} failed: ${error}`,
          );
        }
        if (!settled) {
          pollTimer = setTimeout(poll, JOB_POLL_INTERVAL_MS);
        }
      };

      void poll();
    });
  }

  setCallbacks(_callbacks: PipelineManagerCallbacks): void {
    // For external pipeline, callbacks are not used since all updates come via event bus
    logger.debug("PipelineClient.setCallbacks called - no-op for external worker");
  }
}
