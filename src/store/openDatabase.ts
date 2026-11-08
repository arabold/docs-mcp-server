/**
 * Opens the SQLite database with better-sqlite3, and downloads the module's
 * compiled binary first when npm installed the package without it.
 */

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import Database, { type Database as DatabaseType } from "better-sqlite3";
import { logger } from "../utils/logger";
import { isMissingNativeBinding, NativeModuleMissingError } from "./errors";

/** How long the binary download may take before it counts as failed. */
const DOWNLOAD_TIMEOUT_MS = 120_000;

/**
 * Downloads better-sqlite3's prebuilt binary for the running Node.js. It runs
 * the prebuild-install that better-sqlite3 depends on, which is what the
 * module's own install script runs.
 *
 * @returns True when the download finished
 */
function downloadBinary(): boolean {
  try {
    const packageJson = createRequire(import.meta.url).resolve(
      "better-sqlite3/package.json",
    );
    const prebuildInstall = createRequire(packageJson).resolve("prebuild-install/bin.js");
    logger.info(
      "📦 Downloading the SQLite native module (better-sqlite3), which npm installed without its binary...",
    );
    execFileSync(process.execPath, [prebuildInstall], {
      cwd: path.dirname(packageJson),
      // stdout belongs to the MCP protocol in stdio mode
      stdio: ["ignore", "ignore", "pipe"],
      timeout: DOWNLOAD_TIMEOUT_MS,
    });
    return true;
  } catch (error) {
    logger.debug(`Failed to download the better-sqlite3 binary: ${error}`);
    return false;
  }
}

/**
 * Opens a better-sqlite3 database. npm 12 and later skip dependency install
 * scripts unless they are allowed, which leaves better-sqlite3 without its
 * compiled binary. When the binary is missing, this downloads it once and
 * opens the database again, unless npm's `ignore-scripts` is set.
 *
 * @param dbPath - Path of the database file, or `:memory:`
 * @returns The open database
 * @throws NativeModuleMissingError when the binary is missing and the download is skipped or fails
 */
export function openDatabase(dbPath: string): DatabaseType {
  try {
    return new Database(dbPath);
  } catch (error) {
    if (!isMissingNativeBinding(error)) {
      throw error;
    }
    logger.debug(`Failed to load better-sqlite3: ${error}`);
  }

  // npm exports its config to the processes it starts, including npx's
  if (process.env.npm_config_ignore_scripts === "true" || !downloadBinary()) {
    throw new NativeModuleMissingError();
  }

  try {
    return new Database(dbPath);
  } catch (error) {
    if (isMissingNativeBinding(error)) {
      throw new NativeModuleMissingError();
    }
    throw error;
  }
}
