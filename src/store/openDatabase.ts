/**
 * Opens the SQLite database with better-sqlite3. The package ships Node-API
 * binaries for Windows, macOS and Linux (glibc and musl) on x64 and arm64, so
 * the binary loads under every Node.js version from 22.14 up and under Bun,
 * without an install script or a download.
 */

import Database, { type Database as DatabaseType, type Options } from "better-sqlite3";
import { logger } from "../utils/logger";
import {
  isNativeModuleError,
  NativeModuleUnavailableError,
  NodeApiUnsupportedError,
} from "./errors";

/** The Node-API version better-sqlite3's binaries are built for. */
const REQUIRED_NODE_API = 10;

/**
 * Opens a better-sqlite3 database. Open databases only through this function,
 * so a binary that cannot load ends in one actionable error instead of a raw
 * module resolution failure or a crash.
 *
 * @param dbPath - Path of the database file, or `:memory:`
 * @param options - better-sqlite3 options, such as `readonly`
 * @returns The open database
 * @throws NodeApiUnsupportedError when the runtime provides an older Node-API version than the binary needs
 * @throws NativeModuleUnavailableError when no better-sqlite3 binary loads on this platform
 */
export function openDatabase(dbPath: string, options: Options = {}): DatabaseType {
  // An older runtime crashes the process when it loads the binary, so check first.
  // A runtime that reports no Node-API version is left to try.
  const nodeApi = process.versions.napi;
  if (nodeApi !== undefined && Number(nodeApi) < REQUIRED_NODE_API) {
    throw new NodeApiUnsupportedError(nodeApi, REQUIRED_NODE_API);
  }
  try {
    return new Database(dbPath, options);
  } catch (error) {
    if (!isNativeModuleError(error)) {
      throw error;
    }
    logger.debug(`Failed to load better-sqlite3: ${error}`);
    throw new NativeModuleUnavailableError();
  }
}
