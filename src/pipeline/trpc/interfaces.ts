import type { ScraperOptions } from "../../scraper/types";
import type { PipelineJob, PipelineJobStatus, PipelineManagerCallbacks } from "../types";

/**
 * Options for configuring pipeline behavior.
 */
export interface PipelineOptions {
  /** Whether this pipeline should recover interrupted jobs on startup */
  recoverJobs?: boolean;
  /** URL of external pipeline server (if using remote pipeline) */
  serverUrl?: string;
  /** Maximum concurrent jobs */
  concurrency?: number;
}

/**
 * Common interface that both PipelineManager and PipelineClient implement.
 * Uses public PipelineJob interface for API consistency across implementations.
 */
export interface IPipeline {
  start(): Promise<void>;
  stop(): Promise<void>;
  enqueueScrapeJob(
    library: string,
    version: string | undefined | null,
    options: ScraperOptions,
  ): Promise<string>;
  enqueueRefreshJob(library: string, version: string | undefined | null): Promise<string>;
  getJob(jobId: string): Promise<PipelineJob | undefined>;
  getJobs(status?: PipelineJobStatus): Promise<PipelineJob[]>;
  cancelJob(jobId: string): Promise<void>;
  clearCompletedJobs(): Promise<number>;
  waitForJobCompletion(jobId: string): Promise<void>;
  setCallbacks(callbacks: PipelineManagerCallbacks): void;
}
