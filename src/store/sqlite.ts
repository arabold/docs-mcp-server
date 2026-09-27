import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { StoreError } from "./errors";

const MAC_SQLITE_PATHS = [
  "/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib",
  "/usr/local/opt/sqlite/lib/libsqlite3.dylib",
];

const SQLITE_CONFIGURED_KEY = "__docsMcpSqliteConfigured";

function getSqliteState(): { [SQLITE_CONFIGURED_KEY]?: boolean } {
  return globalThis as typeof globalThis & { [SQLITE_CONFIGURED_KEY]?: boolean };
}

/**
 * Configures Bun's SQLite library before opening the first database.
 * macOS requires a Homebrew SQLite build to load sqlite-vec extensions.
 */
export function configureSqlite(): void {
  const state = getSqliteState();
  if (state[SQLITE_CONFIGURED_KEY]) {
    return;
  }

  if (process.platform === "darwin") {
    const configuredPath = process.env.DOCS_MCP_SQLITE_LIBRARY;
    const sqlitePath = configuredPath ?? MAC_SQLITE_PATHS.find(existsSync);

    if (!sqlitePath || !existsSync(sqlitePath)) {
      throw new StoreError(
        "Bun on macOS needs an extension-enabled SQLite library to load sqlite-vec. " +
          "Install one with `brew install sqlite` or set DOCS_MCP_SQLITE_LIBRARY to its dylib path.",
      );
    }

    try {
      Database.setCustomSQLite(sqlitePath);
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("SQLite already loaded")) {
        throw error;
      }
    }
  }

  state[SQLITE_CONFIGURED_KEY] = true;
}

/**
 * Opens a SQLite database after applying Bun's platform-specific setup.
 */
export function openSqliteDatabase(
  filename: string,
  options?: { readonly?: boolean; create?: boolean; readwrite?: boolean },
): Database {
  configureSqlite();
  return new Database(filename, options);
}

/**
 * Executes a fixed SQLite PRAGMA statement.
 */
export function setPragma(database: Database, statement: string): void {
  database.exec(`PRAGMA ${statement}`);
}

/**
 * Reads a numeric SQLite PRAGMA value.
 */
export function getPragmaNumber(database: Database, name: string): number {
  const row = database.query<[], Record<string, unknown>>(`PRAGMA ${name}`).get();
  const value = row ? Object.values(row)[0] : undefined;
  return value === undefined || value === null ? 0 : Number(value);
}
