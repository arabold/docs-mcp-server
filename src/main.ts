#!/usr/bin/env node
import { startServer } from "./mcp";
import { PipelineManager } from "./pipeline/PipelineManager";
import { DocumentManagementService } from "./store/DocumentManagementService";
import { logger } from "./utils/logger";
import webServer from "./web/web";

// Declare these at module level so they're accessible in shutdown
let pipelineManager: PipelineManager | undefined;
let docService: DocumentManagementService | undefined;
let mcpServerClose: (() => Promise<void>) | undefined;

async function shutdown(signal: string) {
  logger.info(`Received signal ${signal}, shutting down...`);

  try {
    // Close web server first
    await webServer.close();
    logger.info("Web server closed");

    // Close MCP server if it's running
    if (mcpServerClose) {
      await mcpServerClose();
      logger.info("MCP server closed");
    }

    // Stop pipeline manager if it exists
    if (pipelineManager) {
      await pipelineManager.stop();
      logger.info("Pipeline manager stopped");
    }

    // Shutdown document service if it exists
    if (docService) {
      await docService.shutdown();
      logger.info("Document service closed");
    }
  } catch (err: unknown) {
    logger.error(`Error during shutdown: ${(err as Error).message}`);
  }

  process.exit(0);
}

async function main() {
  try {
    // Initialize document service
    docService = new DocumentManagementService();
    await docService.initialize();

    // Initialize and start pipeline manager
    pipelineManager = new PipelineManager(docService);
    await pipelineManager.start();

    // Start MCP server and capture its close function
    mcpServerClose = await startServer();
    logger.info("MCP server started");

    await webServer.listen({ port: 3000, host: "0.0.0.0" });
    logger.info("Web server listening on port 3000");

    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
  } catch (error: unknown) {
    logger.error(`❌ Fatal Error: ${(error as Error).message}`);
    process.exit(1);
  }
}

main();
