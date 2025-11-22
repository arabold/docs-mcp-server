/**
 * CLI main entry point with global shutdown and error handling.
 * Analytics is initialized immediately when imported for proper telemetry across all services.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppServer } from "../app";
import type { IPipeline } from "../pipeline";
import {
  ModelConfigurationError,
  UnsupportedProviderError,
} from "../store/embeddings/EmbeddingFactory";
import type { IDocumentManagement } from "../store/trpc/interfaces";
import { type TelemetryService, telemetry } from "../telemetry";
import { logger } from "../utils/logger";
import { createCliProgram } from "./index";

// Module-level variables for active services and shutdown state
let activeAppServer: AppServer | null = null;
let activeMcpStdioServer: McpServer | null = null;
let activeDocService: IDocumentManagement | null = null;
let activePipelineManager: IPipeline | null = null;
let activeTelemetryService: TelemetryService | null = null;
let isShuttingDown = false;

/**
 * Graceful shutdown handler for SIGINT
 */
const sigintHandler = async (): Promise<void> => {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.debug("Received SIGINT. Shutting down gracefully...");

  try {
    if (activeAppServer) {
      logger.debug("SIGINT: Stopping AppServer...");
      await activeAppServer.stop();
      activeAppServer = null;
      logger.debug("SIGINT: AppServer stopped.");
    }

    if (activeMcpStdioServer) {
      logger.debug("SIGINT: Stopping MCP server...");
      await activeMcpStdioServer.close();
      activeMcpStdioServer = null;
      logger.debug("SIGINT: MCP server stopped.");
    }

    // Shutdown active services
    logger.debug("SIGINT: Shutting down active services...");
    // Only shutdown pipeline if not managed by AppServer (e.g., in stdio mode)
    if (activePipelineManager && !activeAppServer) {
      await activePipelineManager.stop();
      activePipelineManager = null;
      logger.debug("SIGINT: PipelineManager stopped.");
    }

    if (activeDocService) {
      await activeDocService.shutdown();
      activeDocService = null;
      logger.debug("SIGINT: DocumentManagementService shut down.");
    }

    // Cleanup TelemetryService (removes event listeners)
    if (activeTelemetryService) {
      activeTelemetryService.shutdown();
      activeTelemetryService = null;
      logger.debug("SIGINT: TelemetryService shut down.");
    }

    // Analytics shutdown is handled by AppServer.stop() above
    // Only shutdown analytics if no AppServer was running
    if (!activeAppServer && telemetry.isEnabled()) {
      await telemetry.shutdown();
      logger.debug("SIGINT: Analytics shut down.");
    }

    logger.info("✅ Graceful shutdown completed");
    process.exit(0);
  } catch (error) {
    logger.error(`❌ Error during graceful shutdown: ${error}`);
    process.exit(1);
  }
};

/**
 * Performs cleanup for CLI commands that don't start long-running services.
 * This ensures proper analytics shutdown and process exit to prevent hanging.
 */
export async function cleanupCliCommand(): Promise<void> {
  if (!isShuttingDown) {
    logger.debug("CLI command executed. Cleaning up...");

    // Remove SIGINT handler since command completed successfully
    process.removeListener("SIGINT", sigintHandler);

    // Shutdown analytics for non-server CLI commands to ensure clean exit
    await telemetry.shutdown();

    // Avoid hanging processes by explicitly exiting
    process.exit(0);
  }
}

/**
 * Registers global services for shutdown handling
 */
export function registerGlobalServices(services: {
  appServer?: AppServer;
  mcpStdioServer?: McpServer;
  docService?: IDocumentManagement;
  pipeline?: IPipeline;
  telemetryService?: TelemetryService;
}): void {
  if (services.appServer) activeAppServer = services.appServer;
  if (services.mcpStdioServer) activeMcpStdioServer = services.mcpStdioServer;
  if (services.docService) activeDocService = services.docService;
  if (services.pipeline) activePipelineManager = services.pipeline;
  if (services.telemetryService) activeTelemetryService = services.telemetryService;
}

/**
 * Main CLI execution function
 */
export async function runCli(): Promise<void> {
  let commandExecuted = false;

  // Reset shutdown state for new execution
  isShuttingDown = false;

  // Ensure only one SIGINT handler is active
  process.removeListener("SIGINT", sigintHandler);
  process.on("SIGINT", sigintHandler);

  try {
    const program = createCliProgram();

    // Track if a command was executed
    program.hook("preAction", () => {
      commandExecuted = true;
    });

    await program.parseAsync(process.argv);
  } catch (error) {
    // Handle embedding configuration errors with clean, helpful messages
    if (
      error instanceof ModelConfigurationError ||
      error instanceof UnsupportedProviderError
    ) {
      // These errors already have properly formatted messages
      logger.error(error.message);
    } else {
      logger.error(`❌ Error in CLI: ${error}`);
    }

    if (!isShuttingDown) {
      isShuttingDown = true;

      // Shutdown active services on error
      const shutdownPromises: Promise<void>[] = [];

      if (activeAppServer) {
        shutdownPromises.push(
          activeAppServer
            .stop()
            .then(() => {
              activeAppServer = null;
            })
            .catch((e) => logger.error(`❌ Error stopping AppServer: ${e}`)),
        );
      }

      if (activeMcpStdioServer) {
        shutdownPromises.push(
          activeMcpStdioServer
            .close()
            .then(() => {
              activeMcpStdioServer = null;
            })
            .catch((e) => logger.error(`❌ Error stopping MCP server: ${e}`)),
        );
      }

      if (activePipelineManager && !activeAppServer) {
        shutdownPromises.push(
          activePipelineManager
            .stop()
            .then(() => {
              activePipelineManager = null;
            })
            .catch((e) => logger.error(`❌ Error stopping pipeline: ${e}`)),
        );
      }

      if (activeDocService) {
        shutdownPromises.push(
          activeDocService
            .shutdown()
            .then(() => {
              activeDocService = null;
            })
            .catch((e) => logger.error(`❌ Error shutting down doc service: ${e}`)),
        );
      }

      await Promise.allSettled(shutdownPromises);
    }
    process.exit(1);
  }

  // This block handles cleanup for CLI commands that completed successfully
  // and were not long-running servers.
  if (commandExecuted && !activeAppServer) {
    await cleanupCliCommand();
  }
}

// Handle HMR for vite-node --watch
if (import.meta.hot) {
  import.meta.hot.on("vite:beforeFullReload", async () => {
    logger.info("🔥 Hot reload detected");
    process.removeListener("SIGINT", sigintHandler);

    const wasAlreadyShuttingDown = isShuttingDown;
    isShuttingDown = true;

    try {
      const shutdownPromises: Promise<void>[] = [];

      if (activeAppServer) {
        logger.debug("Shutting down AppServer...");
        shutdownPromises.push(
          activeAppServer.stop().then(() => {
            activeAppServer = null;
            logger.debug("AppServer shut down.");
          }),
        );
      }

      if (activePipelineManager && !activeAppServer) {
        shutdownPromises.push(
          activePipelineManager.stop().then(() => {
            activePipelineManager = null;
            logger.debug("PipelineManager stopped.");
          }),
        );
      }

      if (activeDocService) {
        shutdownPromises.push(
          activeDocService.shutdown().then(() => {
            activeDocService = null;
            logger.debug("DocumentManagementService shut down.");
          }),
        );
      }

      await Promise.allSettled(shutdownPromises);
      logger.debug("Active services shut down.");
    } catch (hmrError) {
      logger.error(`❌ Error during HMR cleanup: ${hmrError}`);
    } finally {
      // Reset state for the next module instantiation
      activeAppServer = null;
      if (!wasAlreadyShuttingDown) {
        isShuttingDown = false;
      }
    }
  });
}
