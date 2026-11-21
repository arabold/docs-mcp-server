/**
 * Opens the SQLite database with better-sqlite3. When the package's compiled
 * binary is missing or built for another Node.js version, this opens the
 * database with a binary for the running Node.js from a cache folder, and
 * downloads it there first.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import Database, { type Database as DatabaseType, type Options } from "better-sqlite3";
import envPaths from "env-paths";
import { logger } from "../utils/logger";
import {
  type NativeModuleProblem,
  NativeModuleUnavailableError,
  nativeModuleProblem,
} from "./errors";

/** How long the binary download may take before it counts as failed. */
const DOWNLOAD_TIMEOUT_MS = 120_000;

/** Where prebuild-install writes the binary, relative to the folder it runs in. */
const BINARY = path.join("build", "Release", "better_sqlite3.node");

/**
 * Returns the cache folder for better-sqlite3's binary for the running
 * Node.js. Each package version, Node.js ABI, platform and architecture has
 * its own folder, so Node.js versions never replace each other's binary.
 *
 * @param packageJson - Path of better-sqlite3's package.json
 * @returns Absolute path of the folder
 */
function cacheFolder(packageJson: string): string {
  const { version } = JSON.parse(fs.readFileSync(packageJson, "utf8")) as {
    version: string;
  };
  return path.join(
    envPaths("docs-mcp-server", { suffix: "" }).cache,
    "better-sqlite3",
    `${version}-node-v${process.versions.modules}-${process.platform}-${process.arch}`,
  );
}

/**
 * Downloads better-sqlite3's prebuilt binary for the running Node.js into
 * `folder`. It runs the prebuild-install that better-sqlite3 depends on, which
 * is what the package's own install script runs. The download goes to a
 * temporary folder that is then renamed, so a failed download leaves nothing
 * behind and servers that start at the same time do not write the same file.
 *
 * @param packageJson - Path of better-sqlite3's package.json
 * @param folder - The cache folder from `cacheFolder`
 * @returns True when `folder` holds the binary afterwards
 */
function downloadBinary(packageJson: string, folder: string): boolean {
  let staging: string | undefined;
  try {
    const prebuildInstall = createRequire(packageJson).resolve("prebuild-install/bin.js");
    fs.mkdirSync(path.dirname(folder), { recursive: true });
    staging = fs.mkdtempSync(`${folder}.download-`);
    // prebuild-install reads the package name and version from the folder it runs in
    fs.copyFileSync(packageJson, path.join(staging, "package.json"));
    logger.info(
      `📦 Downloading the SQLite native module (better-sqlite3) for Node.js ${process.version}...`,
    );
    execFileSync(process.execPath, [prebuildInstall], {
      cwd: staging,
      // stdout belongs to the MCP protocol in stdio mode
      stdio: ["ignore", "ignore", "pipe"],
      timeout: DOWNLOAD_TIMEOUT_MS,
    });
    if (!fs.existsSync(path.join(staging, BINARY))) {
      throw new Error(`prebuild-install did not write ${BINARY}`);
    }
    try {
      fs.renameSync(staging, folder);
    } catch (error) {
      // Another server finished the same download first
      if (!fs.existsSync(path.join(folder, BINARY))) {
        throw error;
      }
    }
    return true;
  } catch (error) {
    logger.debug(`Failed to download the better-sqlite3 binary: ${error}`);
    return false;
  } finally {
    if (staging) {
      fs.rmSync(staging, { recursive: true, force: true });
    }
  }
}

/**
 * Opens a better-sqlite3 database. The package's compiled binary is missing
 * when npm 12 or later skipped its install script, and built for another
 * Node.js version when an npx or global install outlives a switch of Node.js
 * versions. In both cases this opens the database with a binary for the
 * running Node.js from a cache folder, and downloads it there first, unless
 * npm's `ignore-scripts` is set. The package's own folder is never written,
 * because a process may have its binary loaded and the folder may be read-only.
 *
 * @param dbPath - Path of the database file, or `:memory:`
 * @param options - better-sqlite3 options, such as `readonly`
 * @returns The open database
 * @throws NativeModuleUnavailableError when no binary loads and the download is skipped or fails
 */
export function openDatabase(dbPath: string, options: Options = {}): DatabaseType {
  const packageJson = createRequire(import.meta.url).resolve(
    "better-sqlite3/package.json",
  );
  const folder = cacheFolder(packageJson);
  const cachedBinary = path.join(folder, BINARY);
  // A binary that failed to load once stays loaded on Linux, so a downloaded
  // one is used from then on, without trying the package's own again
  if (fs.existsSync(cachedBinary)) {
    return new Database(dbPath, { ...options, nativeBinding: cachedBinary });
  }

  let problem: NativeModuleProblem;
  try {
    return new Database(dbPath, options);
  } catch (error) {
    const found = nativeModuleProblem(error);
    if (!found) {
      throw error;
    }
    problem = found;
    logger.debug(`Failed to load better-sqlite3: ${error}`);
  }

  // npm exports its config to the processes it starts, including npx's
  if (process.env.npm_config_ignore_scripts === "true") {
    throw new NativeModuleUnavailableError({ problem, ignoreScripts: true });
  }
  if (!downloadBinary(packageJson, folder)) {
    throw new NativeModuleUnavailableError({ problem });
  }
  return new Database(dbPath, { ...options, nativeBinding: cachedBinary });
}
