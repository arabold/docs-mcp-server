/**
 * Vitest global setup: builds the web UI once when it has not been built yet.
 *
 * The E2E suites load the web UI shell (`public/index.html`) and its assets,
 * which are build output and not checked in. Building here keeps `npm test`
 * working in a fresh checkout and in CI without a separate build step.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

/** Build the web UI unless `public/index.html` already exists. */
export default function setup(): void {
  const projectRoot = path.resolve(import.meta.dirname, "..");
  if (existsSync(path.join(projectRoot, "public", "index.html"))) {
    return;
  }
  execFileSync("npx", ["vite", "build", "--config", "vite.config.web.ts"], {
    cwd: projectRoot,
    stdio: "inherit",
  });
}
