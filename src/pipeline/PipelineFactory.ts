import type { DocumentManagementService } from "../store";
import { DEFAULT_MAX_CONCURRENCY } from "../utils/config";
import { logger } from "../utils/logger";
import { PipelineClient } from "./PipelineClient";
import { PipelineManager } from "./PipelineManager";
import type { IPipeline, PipelineOptions } from "./trpc/interfaces";

/**
 * Factory for creating pipeline interfaces based on functionality requirements.
 */
export namespace PipelineFactory {
  /**
   * Creates the appropriate pipeline interface based on desired functionality.
   *
   * @param docService - Document management service instance
   * @param options - Pipeline configuration options
   * @returns Pipeline interface (PipelineManager or future PipelineClient)
   */
  // Overload: Local pipeline (in-process worker)
  export async function createPipeline(
    docService: DocumentManagementService,
    options?: Omit<PipelineOptions, "serverUrl">,
  ): Promise<PipelineManager>;
  // Overload: Remote pipeline client (out-of-process worker)
  export async function createPipeline(
    docService: undefined,
    options: PipelineOptions & { serverUrl: string },
  ): Promise<PipelineClient>;
  // Implementation
  export async function createPipeline(
    docService?: DocumentManagementService,
    options: PipelineOptions = {},
  ): Promise<IPipeline> {
    const {
      recoverJobs = false, // Default to false for safety
      serverUrl,
      concurrency = DEFAULT_MAX_CONCURRENCY,
    } = options;

    logger.debug(
      `Creating pipeline: recoverJobs=${recoverJobs}, serverUrl=${serverUrl || "none"}, concurrency=${concurrency}`,
    );

    if (serverUrl) {
      // External pipeline requested
      logger.debug(`Creating PipelineClient for external worker at: ${serverUrl}`);
      return new PipelineClient(serverUrl);
    }

    // Local embedded pipeline with specified behavior
    return new PipelineManager(docService as DocumentManagementService, concurrency, {
      recoverJobs,
    });
  }
}
