// Enable source maps (Node.js 20+)
process.setSourceMapsEnabled(true);

import "dotenv/config";
import { sanitizeEnvironment } from "./utils/env";
import { logger } from "./utils/logger";

sanitizeEnvironment();

// Commands that can launch a browser make sure one is installed themselves.
const { runCli } = await import("./cli/main");

// Run the CLI
runCli().catch((error) => {
  logger.error(`🔥 Fatal error in main execution: ${error}`);
  process.exit(1);
});
