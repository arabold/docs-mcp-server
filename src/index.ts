// Enable source maps (Node.js 20+)
process.setSourceMapsEnabled(true);

import "dotenv/config";
import { sanitizeEnvironment } from "./utils/env";

sanitizeEnvironment();

const [{ runCli }, { ensurePlaywrightBrowsersInstalled }] = await Promise.all([
  import("./cli/main"),
  import("./cli/utils"),
]);

// Ensure Playwright browsers are installed
ensurePlaywrightBrowsersInstalled();

// Run the CLI
runCli().catch((error) => {
  console.error(`🔥 Fatal error in main execution: ${error}`);
  process.exit(1);
});
