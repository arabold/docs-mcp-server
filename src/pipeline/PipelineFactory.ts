import type { EventBusService } from "../events/EventBusService";
import type { DocumentManagementService } from "../store";
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
    eventBus: EventBusService,
    options: Omit<PipelineOptions, "serverUrl">,
  ): Promise<PipelineManager>;
  // Overload: Remote pipeline client (out-of-process worker)
  export async function createPipeline(
    docService: undefined,
    eventBus: EventBusService,
    options: PipelineOptions & { serverUrl: string },
  ): Promise<PipelineClient>;
  // Implementation
  export async function createPipeline(
    docService: DocumentManagementService | undefined,
    eventBus: EventBusService | undefined,
    options: PipelineOptions,
  ): Promise<IPipeline> {
    const { recoverJobs = false, serverUrl, appConfig } = options;

    logger.debug(
      `Creating pipeline: recoverJobs=${recoverJobs}, serverUrl=${serverUrl || "none"}`,
    );

    if (serverUrl) {
      // External pipeline requested
      if (!eventBus) {
        throw new Error("Remote pipeline requires EventBusService");
      }
      logger.debug(`Creating PipelineClient for external worker at: ${serverUrl}`);
      return new PipelineClient(serverUrl, eventBus);
    }

    // Local embedded pipeline with specified behavior
    if (!docService || !eventBus) {
      throw new Error(
        "Local pipeline requires both DocumentManagementService and EventBusService",
      );
    }

    return new PipelineManager(docService, eventBus, { recoverJobs, appConfig });
  }
}
