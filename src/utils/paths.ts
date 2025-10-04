import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import envPaths from "env-paths";
import { logger } from "./logger";

let projectRoot: string | null = null;

/**
 * Reset the cached project root. For testing purposes only.
 * @internal
 */
export function _resetProjectRootCache(): void {
  projectRoot = null;
}

/**
 * Finds the project root directory by searching upwards from the current file
 * for a directory containing 'package.json'. Caches the result.
 *
 * @returns {string} The absolute path to the project root.
 * @throws {Error} If package.json cannot be found.
 */
export function getProjectRoot(): string {
  // Return cached result if available
  if (projectRoot) {
    return projectRoot;
  }

  // Start from the directory of the current module
  const currentFilePath = fileURLToPath(import.meta.url);
  let currentDir = path.dirname(currentFilePath);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const packageJsonPath = path.join(currentDir, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      // Cache the found project root directory
      projectRoot = currentDir;
      return currentDir;
    }

    const parentDir = path.dirname(currentDir);
    // Check if we have reached the filesystem root
    if (parentDir === currentDir) {
      throw new Error("Could not find project root containing package.json.");
    }
    currentDir = parentDir;
  }
}

/**
 * Resolves the data storage path using the following priority:
 * 1. Provided storePath parameter
 * 2. Legacy .store directory in project root (if exists)
 * 3. Standard system data directory using env-paths
 *
 * @param storePath Optional custom storage path
 * @returns Resolved absolute path for data storage
 */
export function resolveStorePath(storePath?: string): string {
  let dbDir: string;

  // 1. Check storePath parameter
  if (storePath) {
    dbDir = path.resolve(storePath);
  } else {
    // 2. Check Old Local Path
    const projectRoot = getProjectRoot();
    const oldDbDir = path.join(projectRoot, ".store");
    const oldDbPath = path.join(oldDbDir, "documents.db");
    const oldDbExists = fs.existsSync(oldDbPath); // Check file existence specifically

    if (oldDbExists) {
      dbDir = oldDbDir;
    } else {
      // 3. Use Standard Path
      const standardPaths = envPaths("docs-mcp-server", { suffix: "" });
      dbDir = standardPaths.data;
    }
  }

  // Ensure the chosen directory exists
  try {
    fs.mkdirSync(dbDir, { recursive: true });
  } catch (error) {
    // Log potential error during directory creation but proceed
    // The DocumentStore constructor might handle DB file creation errors
    logger.warn(`⚠️  Failed to create database directory ${dbDir}: ${error}`);
  }

  return dbDir;
}
