// Enable source maps (Node.js 20+)
process.setSourceMapsEnabled(true);

import "dotenv/config";
import { runCli } from "./cli/main";
import { ensurePlaywrightBrowsersInstalled } from "./cli/utils";

// Ensure Playwright browsers are installed
ensurePlaywrightBrowsersInstalled();

// Run the CLI
runCli().catch((error) => {
  console.error(`🔥 Fatal error in main execution: ${error}`);
  process.exit(1);
});
