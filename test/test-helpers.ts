
import fs from "node:fs";
import path from "node:path";
import type { Database } from "better-sqlite3";

/**
 * Returns the command and arguments to run the CLI.
 * Prefers the built 'dist/index.js' if available for faster execution.
 * Falls back to 'npx vite-node src/index.ts' for development.
 */
export function getCliCommand(): { cmd: string; args: string[] } {
  const projectRoot = path.resolve(import.meta.dirname, "..");
  const distEntry = path.join(projectRoot, "dist", "index.js");

  // Check if dist/index.js exists
  if (fs.existsSync(distEntry)) {
    return { cmd: "node", args: [distEntry] };
  }

  // Fallback to vite-node
  const srcEntry = path.join(projectRoot, "src", "index.ts");
  return { cmd: "npx", args: ["vite-node", srcEntry] };
}

/**
 * Writes an explicit config for a spawned CLI or server, so a test does not
 * depend on the machine's own configuration: FTS-only (no embedding calls), no
 * telemetry, and unrestricted `file://` access to fixtures, including hidden
 * path segments, since the checkout may itself sit under a hidden folder (e.g. a
 * worktree).
 *
 * @param dir Directory to write `config.yaml` into.
 * @returns The config file's path.
 */
export function writeTestConfig(dir: string): string {
  const configPath = path.join(dir, "config.yaml");
  fs.writeFileSync(
    configPath,
    [
      "app:",
      '  embeddingModel: ""',
      "  telemetryEnabled: false",
      "scraper:",
      "  security:",
      "    fileAccess:",
      "      mode: unrestricted",
      "      includeHidden: true",
      "",
    ].join("\n"),
  );
  return configPath;
}

/**
 * Puts `libraries` back into its shape before migration 017 and forgets 017, so
 * the next `applyMigrations` runs 017 against rows seeded in the old shape. Call
 * on a fully migrated database, before seeding.
 */
export function restorePre017Libraries(db: Database): void {
  db.exec(`
    DROP TABLE libraries;
    CREATE TABLE libraries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX idx_libraries_lower_name ON libraries(LOWER(name));
    DELETE FROM _schema_migrations WHERE id = '017-add-library-display-name.sql';
  `);
}
