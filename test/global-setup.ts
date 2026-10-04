/**
 * Vitest global setup: builds the web UI when it is missing or older than its
 * sources.
 *
 * The E2E suites load the web UI shell (`public/index.html`) and its assets,
 * which are build output and not checked in. Building here keeps `npm test`
 * working in a fresh checkout and in CI, and keeps the browser tests on the
 * current UI after a change under `src/web/client` or to `vite.config.web.ts`.
 */

import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

/** Modification time of `file`, or 0 when it does not exist. */
function mtimeOf(file: string): number {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

/** Build the web UI unless `public/index.html` is newer than every web UI source. */
export default function setup(): void {
  const projectRoot = path.resolve(import.meta.dirname, "..");
  const clientDir = path.join(projectRoot, "src", "web", "client");
  const sources = [
    path.join(projectRoot, "vite.config.web.ts"),
    clientDir,
    ...readdirSync(clientDir, { recursive: true }).map((entry) =>
      path.join(clientDir, String(entry)),
    ),
  ];
  const builtAt = mtimeOf(path.join(projectRoot, "public", "index.html"));
  if (builtAt > Math.max(...sources.map(mtimeOf))) {
    return;
  }
  execFileSync("npm", ["run", "build:web"], { cwd: projectRoot, stdio: "inherit" });
}
