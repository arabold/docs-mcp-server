import path from "node:path";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createReadOnlyMcpServer } from "./mcp/readOnlyMcpServer";
import { initializeReadOnlyTools } from "./mcp/readOnlyTools";
import { ReadOnlyDocumentManagementService } from "./store/ReadOnlyDocumentManagementService";
import { type AppConfig, defaults } from "./utils/config";
import { LogLevel, logger, setLogLevel } from "./utils/logger";
import { resolveStorePath } from "./utils/paths";

process.setSourceMapsEnabled(true);

async function main(): Promise<void> {
  setLogLevel(LogLevel.ERROR);
  const storePath = resolveStorePath(process.env.DOCS_MCP_STORE_PATH, {
    create: false,
  });
  const config: AppConfig = {
    ...defaults,
    app: {
      ...defaults.app,
      storePath,
      telemetryEnabled: false,
      readOnly: true,
    },
  };

  const service = new ReadOnlyDocumentManagementService(config);
  await service.initialize();
  const server = createReadOnlyMcpServer(initializeReadOnlyTools(service));
  await server.connect(new StdioServerTransport());

  const shutdown = async () => {
    await server.close();
    await service.shutdown();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  await new Promise(() => {});
}

main().catch((error) => {
  const entrypoint = path.basename(fileURLToPath(import.meta.url));
  logger.error(`❌ ${entrypoint} failed: ${error}`);
  process.exit(1);
});
