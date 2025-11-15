/**
 * tRPC client implementation of the Pipeline interface.
 * Delegates all pipeline operations to an external worker via tRPC router.
 */

import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import type { ScraperOptions } from "../scraper/types";
import { logger } from "../utils/logger";
import type { IPipeline } from "./trpc/interfaces";
import type { PipelineRouter } from "./trpc/router";
import type { PipelineJob, PipelineJobStatus, PipelineManagerCallbacks } from "./types";

/**
 * Deserializes a job object from JSON, converting date strings back to Date objects.
 * Only includes public fields - no internal job management fields.
 */
function deserializeJob(serializedJob: Record<string, unknown>): PipelineJob {
  return {
    ...serializedJob,
    createdAt: new Date(serializedJob.createdAt as string),
    startedAt: serializedJob.startedAt
      ? new Date(serializedJob.startedAt as string)
      : null,
    finishedAt: serializedJob.finishedAt
      ? new Date(serializedJob.finishedAt as string)
      : null,
    updatedAt: serializedJob.updatedAt
      ? new Date(serializedJob.updatedAt as string)
      : undefined,
  } as PipelineJob;
}

/**
 * HTTP client that implements the IPipeline interface by delegating to external worker.
 */
export class PipelineClient implements IPipeline {
  private readonly baseUrl: string;
  private readonly client: ReturnType<typeof createTRPCProxyClient<PipelineRouter>>;
  private pollingInterval: number = 1000; // 1 second
  private activePolling = new Set<string>(); // Track jobs being polled for completion

  constructor(serverUrl: string) {
    this.baseUrl = serverUrl.replace(/\/$/, "");
    this.client = createTRPCProxyClient<PipelineRouter>({
      links: [httpBatchLink({ url: this.baseUrl })],
    });
    logger.debug(`PipelineClient (tRPC) created for: ${this.baseUrl}`);
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
    // Clear any active polling
    this.activePolling.clear();
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
      const serializedJob = await this.client.getJob.query({ id: jobId });
      return serializedJob
        ? deserializeJob(serializedJob as unknown as Record<string, unknown>)
        : undefined;
    } catch (error) {
      throw new Error(
        `Failed to get job ${jobId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async getJobs(status?: PipelineJobStatus): Promise<PipelineJob[]> {
    try {
      const result = await this.client.getJobs.query({ status });
      const serializedJobs = result.jobs || [];
      return serializedJobs.map((j) =>
        deserializeJob(j as unknown as Record<string, unknown>),
      );
    } catch (error) {
      logger.error(`Failed to get jobs from external worker: ${error}`);
      throw error;
    }
  }

  async cancelJob(jobId: string): Promise<void> {
    try {
      await this.client.cancelJob.mutate({ id: jobId });
      logger.debug(`Job cancelled via external worker: ${jobId}`);
    } catch (error) {
      logger.error(`Failed to cancel job ${jobId} via external worker: ${error}`);
      throw error;
    }
  }

  async clearCompletedJobs(): Promise<number> {
    try {
      const result = await this.client.clearCompletedJobs.mutate();
      logger.debug(`Cleared ${result.count} completed jobs via external worker`);
      return result.count || 0;
    } catch (error) {
      logger.error(`Failed to clear completed jobs via external worker: ${error}`);
      throw error;
    }
  }

  async waitForJobCompletion(jobId: string): Promise<void> {
    if (this.activePolling.has(jobId)) {
      throw new Error(`Already waiting for completion of job ${jobId}`);
    }

    this.activePolling.add(jobId);

    try {
      while (this.activePolling.has(jobId)) {
        const job = await this.getJob(jobId);
        if (!job) {
          throw new Error(`Job ${jobId} not found`);
        }

        // Check if job is in final state
        if (
          job.status === "completed" ||
          job.status === "failed" ||
          job.status === "cancelled"
        ) {
          if (job.status === "failed" && job.error) {
            // Normalize to real Error instance
            throw new Error(job.error.message);
          }
          return;
        }

        // Poll every second
        await new Promise((resolve) => setTimeout(resolve, this.pollingInterval));
      }
    } finally {
      this.activePolling.delete(jobId);
    }
  }

  setCallbacks(_callbacks: PipelineManagerCallbacks): void {
    // For external pipeline, callbacks are not used since all updates come via polling
    logger.debug("PipelineClient.setCallbacks called - no-op for external worker");
  }
}
