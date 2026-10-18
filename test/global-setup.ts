/**
 * Vitest global setup: rebuilds what the E2E suites run when it is older than
 * its sources.
 *
 * The E2E suites load the web UI shell (`public/index.html`) and its assets,
 * which are build output and not checked in. Building here keeps `npm test`
 * working in a fresh checkout and in CI, and keeps the browser tests on the
 * current UI after a change under `src/web/client` or to `vite.config.web.ts`.
 *
 * The CLI suites run `dist/index.js` whenever it exists (see `getCliCommand`),
 * so a build older than the sources would test old code. Such a build is
 * rebuilt here. Without a build they run the sources through vite-node, as in
 * CI, and nothing is built for them.
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

/** The newest modification time among `files`. */
function newest(files: string[]): number {
  return Math.max(...files.map(mtimeOf));
}

/** Everything under `dir`, subdirectories included. */
function entriesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true }).map((entry) => path.join(dir, String(entry)));
}

/** Run an npm script in the project root, with its output shown. */
function runScript(projectRoot: string, script: string): void {
  execFileSync("npm", ["run", script], { cwd: projectRoot, stdio: "inherit" });
}

/**
 * Rebuild `dist/` when it exists but is older than the CLI sources, then build
 * the web UI unless `public/index.html` is newer than every web UI source.
 */
export default function setup(): void {
  const projectRoot = path.resolve(import.meta.dirname, "..");
  const srcDir = path.join(projectRoot, "src");
  const clientDir = path.join(srcDir, "web", "client");

  // Tests and the web UI are not part of the CLI bundle
  const cliSources = [
    path.join(projectRoot, "vite.config.ts"),
    ...entriesUnder(srcDir).filter(
      (file) =>
        !file.startsWith(`${clientDir}${path.sep}`) &&
        !/\.test\.tsx?$/.test(file) &&
        statSync(file).isFile(),
    ),
  ];
  const cliBuiltAt = mtimeOf(path.join(projectRoot, "dist", "index.js"));
  if (cliBuiltAt > 0 && cliBuiltAt <= newest(cliSources)) {
    try {
      // Builds the web UI as well
      runScript(projectRoot, "build");
    } catch {
      throw new Error(
        "dist/index.js is older than src/ and `npm run build` failed, so the CLI suites " +
          "would test old code. Fix the build, or delete dist/ to run them from source.",
      );
    }
    return;
  }

  const webSources = [path.join(projectRoot, "vite.config.web.ts"), clientDir, ...entriesUnder(clientDir)];
  if (mtimeOf(path.join(projectRoot, "public", "index.html")) > newest(webSources)) {
    return;
  }
  runScript(projectRoot, "build:web");
}
