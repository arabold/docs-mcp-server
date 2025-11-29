import fs from "node:fs";
import path from "node:path";
import type { Database } from "better-sqlite3";
import { MIGRATION_MAX_RETRIES, MIGRATION_RETRY_DELAY_MS } from "../utils/config";
import { logger } from "../utils/logger";
import { getProjectRoot } from "../utils/paths";
import { StoreError } from "./errors";

// Construct the absolute path to the migrations directory using the project root
const MIGRATIONS_DIR = path.join(getProjectRoot(), "db", "migrations");
const MIGRATIONS_TABLE = "_schema_migrations";

/**
 * Ensures the migration tracking table exists in the database.
 * @param db The database instance.
 */
function ensureMigrationsTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      id TEXT PRIMARY KEY,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

/**
 * Retrieves the set of already applied migration IDs (filenames) from the tracking table.
 * @param db The database instance.
 * @returns A Set containing the IDs of applied migrations.
 */
function getAppliedMigrations(db: Database): Set<string> {
  const stmt = db.prepare(`SELECT id FROM ${MIGRATIONS_TABLE}`);
  const rows = stmt.all() as Array<{ id: string }>;
  return new Set(rows.map((row) => row.id));
}

/**
 * Applies pending database migrations found in the migrations directory.
 * Migrations are expected to be .sql files with sequential prefixes (e.g., 001-, 002-).
 * It tracks applied migrations in the _schema_migrations table.
 *
 * @param db The better-sqlite3 database instance.
 * @throws {StoreError} If any migration fails.
 */
export async function applyMigrations(db: Database): Promise<void> {
  // Apply performance optimizations for large dataset migrations
  try {
    db.pragma("journal_mode = OFF");
    db.pragma("synchronous = OFF");
    db.pragma("mmap_size = 268435456"); // 256MB memory mapping
    db.pragma("cache_size = -64000"); // 64MB cache (default is ~2MB)
    db.pragma("temp_store = MEMORY"); // Store temporary data in memory
    logger.debug("Applied performance optimizations for migration");
  } catch (_error) {
    logger.warn("⚠️  Could not apply all performance optimizations for migration");
  }

  const overallTransaction = db.transaction(() => {
    logger.debug("Checking database migrations...");
    ensureMigrationsTable(db);
    const appliedMigrations = getAppliedMigrations(db);

    if (!fs.existsSync(MIGRATIONS_DIR)) {
      throw new StoreError("Migrations directory not found");
    }

    const migrationFiles = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((file) => file.endsWith(".sql"))
      .sort(); // Sort alphabetically, relying on naming convention (001-, 002-)

    const pendingMigrations = migrationFiles.filter(
      (filename) => !appliedMigrations.has(filename),
    );

    if (pendingMigrations.length > 0) {
      logger.info(`🔄 Applying ${pendingMigrations.length} database migration(s)...`);
    }

    let appliedCount = 0;
    for (const filename of pendingMigrations) {
      logger.debug(`Applying migration: ${filename}`);
      const filePath = path.join(MIGRATIONS_DIR, filename);
      const sql = fs.readFileSync(filePath, "utf8");

      // Execute migration and record it directly within the overall transaction
      try {
        db.exec(sql);
        const insertStmt = db.prepare(`INSERT INTO ${MIGRATIONS_TABLE} (id) VALUES (?)`);
        insertStmt.run(filename);
        logger.debug(`Applied migration: ${filename}`);
        appliedCount++;
      } catch (error) {
        logger.error(`❌ Failed to apply migration: ${filename} - ${error}`);
        // Re-throw to ensure the overall transaction rolls back
        throw new StoreError(`Migration failed: ${filename}`, error);
      }
    }

    if (appliedCount > 0) {
      logger.info(`✅ Successfully applied ${appliedCount} migration(s)`);
    } else {
      logger.debug("Database schema is up to date");
    }

    // Return the count of applied migrations so we know if VACUUM is needed
    return appliedCount;
  });

  let retries = 0;
  let appliedMigrationsCount = 0;

  while (true) {
    try {
      // Start a single IMMEDIATE transaction for the entire migration process
      appliedMigrationsCount = overallTransaction.immediate(); // Execute the encompassing transaction
      logger.debug("Database migrations completed successfully");

      // Only run VACUUM if migrations were actually applied
      if (appliedMigrationsCount > 0) {
        try {
          logger.debug(
            `Running VACUUM after applying ${appliedMigrationsCount} migration(s)...`,
          );
          db.exec("VACUUM");
          logger.debug("Database vacuum completed successfully");
        } catch (error) {
          logger.warn(`⚠️  Could not vacuum database after migrations: ${error}`);
          // Don't fail the migration process if vacuum fails
        }
      } else {
        logger.debug("Skipping VACUUM - no migrations were applied");
      }

      break; // Success
    } catch (error) {
      // biome-ignore lint/suspicious/noExplicitAny: error can be any
      if ((error as any)?.code === "SQLITE_BUSY" && retries < MIGRATION_MAX_RETRIES) {
        retries++;
        logger.warn(
          `⚠️  Migrations busy (SQLITE_BUSY), retrying attempt ${retries}/${MIGRATION_MAX_RETRIES} in ${MIGRATION_RETRY_DELAY_MS}ms...`,
        );
        await new Promise((resolve) => setTimeout(resolve, MIGRATION_RETRY_DELAY_MS));
      } else {
        // biome-ignore lint/suspicious/noExplicitAny: error can be any
        if ((error as any)?.code === "SQLITE_BUSY") {
          logger.error(
            `❌ Migrations still busy after ${MIGRATION_MAX_RETRIES} retries. Giving up: ${error}`,
          );
        }
        // Ensure StoreError is thrown for consistent handling
        if (error instanceof StoreError) {
          throw error;
        }
        throw new StoreError("Failed during migration process", error);
      }
    }
  }

  // Configure production-ready settings after migrations
  try {
    // Enable WAL mode for better concurrency (allows readers while writing)
    db.pragma("journal_mode = WAL");

    // Configure WAL autocheckpoint to prevent unbounded growth
    db.pragma("wal_autocheckpoint = 1000"); // Checkpoint every 1000 pages (~4MB)

    // Set busy timeout for better handling of concurrent access
    db.pragma("busy_timeout = 30000"); // 30 seconds

    // Enable foreign key constraints for data integrity
    db.pragma("foreign_keys = ON");

    // Set synchronous to NORMAL for good balance of safety and performance
    db.pragma("synchronous = NORMAL");

    logger.debug(
      "Applied production database configuration (WAL mode, autocheckpoint, foreign keys, busy timeout)",
    );
  } catch (_error) {
    logger.warn("⚠️  Could not apply all production database settings");
  }
}
