#!/usr/bin/env node
import { startServer } from "./mcp";
import { logger } from "./utils/logger";
import webServer from "./web/web";

async function main() {
  try {
    await startServer();
    logger.info("MCP server started");

    await webServer.listen({ port: 3000, host: "0.0.0.0" });
    logger.info("Web server listening on port 3000");
  } catch (error: unknown) {
    logger.error(`❌ Fatal Error: ${(error as Error).message}`);
    process.exit(1);
  }
}

main();
