/**
 * Worker service that enables the embedded pipeline worker functionality.
 * This service starts the pipeline and configures it for background job processing.
 */

import type { IPipeline } from "../pipeline/trpc/interfaces";
import { logger } from "../utils/logger";

/**
 * Register worker service to enable embedded pipeline processing.
 * This starts the pipeline and configures callbacks for job processing.
 *
 * Note: This function is now deprecated in favor of configuring callbacks
 * in AppServer.setupPipelineEventBridge(). Keeping telemetry/logging here
 * would overwrite the event bus callbacks, breaking SSE notifications.
 * Telemetry and logging should be integrated into the event bus listeners instead.
 */
export async function registerWorkerService(pipeline: IPipeline): Promise<void> {
  // DO NOT call pipeline.setCallbacks() here - it would overwrite the callbacks
  // set by AppServer.setupPipelineEventBridge() that emit to the event bus.
  // All callbacks (including telemetry/logging) should be configured in one place.

  // Start the pipeline for job processing
  await pipeline.start();
  logger.debug("Worker service started");
}

/**
 * Stop the worker service and cleanup resources.
 */
export async function stopWorkerService(pipeline: IPipeline): Promise<void> {
  await pipeline.stop();
  logger.debug("Worker service stopped");
}
