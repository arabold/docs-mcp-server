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
import type { EventBusService } from "../events/EventBusService";
import { EventType } from "../events/types";
import type { ScraperOptions } from "../scraper/types";
import { logger } from "../utils/logger";
import type { IPipeline } from "./trpc/interfaces";
import type { PipelineRouter } from "./trpc/router";
import type { PipelineJob, PipelineJobStatus, PipelineManagerCallbacks } from "./types";

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

    // Extract base URL without the /api path for WebSocket connection
    // The tRPC WebSocket adapter handles the /api routing internally
    const url = new URL(this.baseUrl);
    const baseWsUrl = `${url.protocol}//${url.host}`;
    this.wsUrl = baseWsUrl.replace(/^http/, "ws");

    // Create WebSocket client for subscriptions
    this.wsClient = createWSClient({
      url: this.wsUrl,
    });

    // Create tRPC client with split link:
    // - Subscriptions use WebSocket
    // - Queries and mutations use HTTP
    // Note: transformer is configured on the server's initTRPC
    this.client = createTRPCProxyClient<PipelineRouter>({
      links: [
        splitLink({
          condition: (op) => op.type === "subscription",
          true: wsLink({ client: this.wsClient }),
          false: httpBatchLink({ url: this.baseUrl }),
        }),
      ],
    });

    logger.debug(
      `PipelineClient (tRPC) created for: ${this.baseUrl} (ws: ${this.wsUrl})`,
    );
  }

  async start(): Promise<void> {
    // Check connectivity via ping
    try {
      // Root-level ping exists on the unified router; cast for this health check only
      await (
        this.client as unknown as { ping: { query: () => Promise<unknown> } }
      ).ping.query();
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
  ): Promise<string> {
    try {
      const normalizedVersion =
        typeof version === "string" && version.trim().length === 0
          ? null
          : (version ?? null);
      const result = await this.client.enqueueScrapeJob.mutate({
        library,
        version: normalizedVersion,
        options,
      });
      logger.debug(`Job ${result.jobId} enqueued successfully`);
      return result.jobId;
    } catch (error) {
      throw new Error(
        `Failed to enqueue job: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async enqueueRefreshJob(
    library: string,
    version: string | undefined | null,
  ): Promise<string> {
    try {
      const normalizedVersion =
        typeof version === "string" && version.trim().length === 0
          ? null
          : (version ?? null);
      const result = await this.client.enqueueRefreshJob.mutate({
        library,
        version: normalizedVersion,
      });
      logger.debug(`Refresh job ${result.jobId} enqueued successfully`);
      return result.jobId;
    } catch (error) {
      throw new Error(
        `Failed to enqueue refresh job: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async getJob(jobId: string): Promise<PipelineJob | undefined> {
    try {
      // superjson automatically deserializes Date objects
      const job = await this.client.getJob.query({ id: jobId });
      return job as PipelineJob | undefined;
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
      return (result.jobs || []) as unknown as PipelineJob[];
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

  async waitForJobCompletion(jobId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // Listen for job status changes on the event bus
      // RemoteEventProxy bridges remote worker events to this local bus
      const unsubscribe = this.eventBus.on(
        EventType.JOB_STATUS_CHANGE,
        (job: PipelineJob) => {
          // Filter for the specific job we're waiting for
          if (job.id !== jobId) {
            return;
          }

          // Check if job reached a terminal state
          if (
            job.status === "completed" ||
            job.status === "failed" ||
            job.status === "cancelled"
          ) {
            unsubscribe();

            if (job.status === "failed" && job.error) {
              reject(new Error(job.error.message));
            } else {
              resolve();
            }
          }
        },
      );
    });
  }

  setCallbacks(_callbacks: PipelineManagerCallbacks): void {
    // For external pipeline, callbacks are not used since all updates come via event bus
    logger.debug("PipelineClient.setCallbacks called - no-op for external worker");
  }
}
