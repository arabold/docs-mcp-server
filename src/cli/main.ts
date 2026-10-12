/**
 * CLI main entry point with global shutdown and error handling.
 * Analytics is initialized immediately when imported for proper telemetry across all services.
 */

import {
  ModelConfigurationError,
  UnsupportedProviderError,
} from "../store/embeddings/EmbeddingFactory";
import { telemetry } from "../telemetry";
import { logger } from "../utils/logger";
import { createCli } from "./index";

// Module-level variables are now in ./services.ts
import {
  closeActiveBackend,
  getActiveAppServer,
  getActiveMcpStdioServer,
  setActiveAppServer,
  setActiveMcpStdioServer,
} from "./services";

let isShuttingDown = false;

/**
 * Graceful shutdown handler for SIGINT
 */
const sigintHandler = async (): Promise<void> => {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.debug("Received SIGINT. Shutting down gracefully...");

  try {
    const appServer = getActiveAppServer();
    if (appServer) {
      logger.debug("SIGINT: Stopping AppServer...");
      await appServer.stop();
      setActiveAppServer(null);
      logger.debug("SIGINT: AppServer stopped.");
    }

    const mcpServer = getActiveMcpStdioServer();
    if (mcpServer) {
      logger.debug("SIGINT: Stopping MCP server...");
      await mcpServer.close();
      setActiveMcpStdioServer(null);
      logger.debug("SIGINT: MCP server stopped.");
    }

    // The servers have stopped, so nothing uses the backend any more
    await closeActiveBackend();

    // Analytics shutdown is handled by AppServer.stop() above
    // Only shutdown analytics if no AppServer was running
    if (!appServer && telemetry.isEnabled()) {
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
    const cli = createCli(process.argv);

    // Track if a command was executed?? Yargs doesn't have preAction hook on instance easily.
    // But middleware runs.
    // We can rely on middleware to set tracking data.
    // commandExecuted variable was used to trigger cleanupCliCommand at end.
    // Yargs .parse() resolves when command finishes.
    // If it resolves, command executed.
    commandExecuted = true;

    await cli.parse();
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

      const appServer = getActiveAppServer();
      if (appServer) {
        shutdownPromises.push(
          appServer
            .stop()
            .then(() => {
              setActiveAppServer(null);
            })
            .catch((e) => logger.error(`❌ Error stopping AppServer: ${e}`)),
        );
      }

      const mcpServer = getActiveMcpStdioServer();
      if (mcpServer) {
        shutdownPromises.push(
          mcpServer
            .close()
            .then(() => {
              setActiveMcpStdioServer(null);
            })
            .catch((e) => logger.error(`❌ Error stopping MCP server: ${e}`)),
        );
      }

      await Promise.allSettled(shutdownPromises);

      // Close the backend once the servers that use it have stopped
      await closeActiveBackend().catch((e) =>
        logger.error(`❌ Error closing backend: ${e}`),
      );
    }
    process.exit(1);
  }

  // This block handles cleanup for CLI commands that completed successfully
  // and were not long-running servers.
  const appServer = getActiveAppServer();
  if (commandExecuted && !appServer) {
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
      const appServer = getActiveAppServer();
      if (appServer) {
        logger.debug("Shutting down AppServer...");
        // A failed stop still closes the backend below
        await appServer.stop().then(
          () => {
            setActiveAppServer(null);
            logger.debug("AppServer shut down.");
          },
          () => {},
        );
      }

      await closeActiveBackend();
      logger.debug("Active services shut down.");
    } catch (hmrError) {
      logger.error(`❌ Error during HMR cleanup: ${hmrError}`);
    } finally {
      // Reset state for the next module instantiation
      setActiveAppServer(null);
      if (!wasAlreadyShuttingDown) {
        isShuttingDown = false;
      }
    }
  });
}
