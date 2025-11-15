#!/usr/bin/env vite-node

/**
 * Database Schema Comparison Tool
 * 
 * This script compares the database structure from a SQLite database file
 * against an in-memory database created by applying all migrations.
 * 
 * Usage:
 *   ./scripts/compare-schema.ts [--db <path-to-documents.db>]
 * 
 * If --db is not specified, uses the default database location logic.
 */

import path from "node:path";
import Database, { type Database as DatabaseType } from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { Command } from "commander";
import { applyMigrations } from "../src/store/applyMigrations";
import { resolveStorePath } from "../src/utils/paths";

// Schema structures
interface ColumnInfo {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

interface IndexInfo {
  seq: number;
  name: string;
  unique: number;
  origin: string;
  partial: number;
}

interface TableSchema {
  name: string;
  type: string;
  sql: string | null;
  columns: ColumnInfo[];
  indexes: IndexInfo[];
}

interface DatabaseSchema {
  tables: Map<string, TableSchema>;
}

/**
 * Extracts the complete schema from a database.
 */
function getSchemaDetails(db: DatabaseType): DatabaseSchema {
  const schema: DatabaseSchema = {
    tables: new Map(),
  };

  // Get all tables (including virtual tables)
  const tables = db
    .prepare(
      "SELECT name, type, sql FROM sqlite_master WHERE type IN ('table', 'view') ORDER BY name",
    )
    .all() as Array<{ name: string; type: string; sql: string | null }>;

  for (const table of tables) {
    // Skip internal SQLite tables
    if (table.name.startsWith("sqlite_")) {
      continue;
    }

    const tableSchema: TableSchema = {
      name: table.name,
      type: table.type,
      sql: table.sql,
      columns: [],
      indexes: [],
    };

    // Get column information (won't work for virtual tables, but we'll handle that)
    try {
      const columns = db.prepare(`PRAGMA table_info(${table.name})`).all() as ColumnInfo[];
      tableSchema.columns = columns;
    } catch (error) {
      // Virtual tables don't support PRAGMA table_info, we'll just note this
      console.log(`Note: Cannot get column info for virtual table: ${table.name}`);
    }

    // Get index information
    try {
      const indexes = db.prepare(`PRAGMA index_list(${table.name})`).all() as IndexInfo[];
      tableSchema.indexes = indexes;
    } catch (error) {
      // Some virtual tables don't support PRAGMA index_list
      console.log(`Note: Cannot get index info for table: ${table.name}`);
    }

    schema.tables.set(table.name, tableSchema);
  }

  return schema;
}

/**
 * Compares two database schemas and returns a report of differences.
 */
function compareSchemas(
  expectedSchema: DatabaseSchema,
  actualSchema: DatabaseSchema,
): { isMatch: boolean; differences: string[] } {
  const differences: string[] = [];

  // Check for missing or extra tables
  const expectedTableNames = new Set(expectedSchema.tables.keys());
  const actualTableNames = new Set(actualSchema.tables.keys());

  for (const tableName of expectedTableNames) {
    if (!actualTableNames.has(tableName)) {
      differences.push(`❌ Missing table: ${tableName}`);
    }
  }

  for (const tableName of actualTableNames) {
    if (!expectedTableNames.has(tableName)) {
      differences.push(`➕ Extra table: ${tableName}`);
    }
  }

  // Compare tables that exist in both schemas
  for (const tableName of expectedTableNames) {
    if (!actualTableNames.has(tableName)) {
      continue; // Already reported as missing
    }

    const expectedTable = expectedSchema.tables.get(tableName)!;
    const actualTable = actualSchema.tables.get(tableName)!;

    // Compare table types
    if (expectedTable.type !== actualTable.type) {
      differences.push(
        `⚠️  Table ${tableName}: type mismatch (expected: ${expectedTable.type}, actual: ${actualTable.type})`,
      );
    }

    // Compare SQL definitions for virtual tables
    if (expectedTable.type !== "table" && expectedTable.sql !== actualTable.sql) {
      differences.push(
        `⚠️  Table ${tableName}: SQL definition mismatch\n   Expected: ${expectedTable.sql}\n   Actual: ${actualTable.sql}`,
      );
    }

    // Compare columns (only for regular tables)
    if (expectedTable.columns.length > 0 || actualTable.columns.length > 0) {
      const expectedColumns = new Map(expectedTable.columns.map((col) => [col.name, col]));
      const actualColumns = new Map(actualTable.columns.map((col) => [col.name, col]));

      // Check for missing columns
      for (const [colName, expectedCol] of expectedColumns) {
        const actualCol = actualColumns.get(colName);

        if (!actualCol) {
          differences.push(
            `❌ Table ${tableName}: missing column '${colName}' (expected type: ${expectedCol.type})`,
          );
          continue;
        }

        // Detailed comparison of all column properties
        const columnDiffs: string[] = [];

        // Compare column type (case-insensitive, as SQLite is flexible with type names)
        if (expectedCol.type.toUpperCase() !== actualCol.type.toUpperCase()) {
          columnDiffs.push(
            `type mismatch (expected: '${expectedCol.type}', actual: '${actualCol.type}')`,
          );
        }

        // Compare NOT NULL constraint
        if (expectedCol.notnull !== actualCol.notnull) {
          columnDiffs.push(
            `NOT NULL mismatch (expected: ${expectedCol.notnull === 1 ? "NOT NULL" : "NULL"}, actual: ${actualCol.notnull === 1 ? "NOT NULL" : "NULL"})`,
          );
        }

        // Compare PRIMARY KEY status
        if (expectedCol.pk !== actualCol.pk) {
          columnDiffs.push(
            `PRIMARY KEY mismatch (expected: ${expectedCol.pk === 1 ? "YES" : "NO"}, actual: ${actualCol.pk === 1 ? "YES" : "NO"})`,
          );
        }

        // Compare default values (normalize NULL comparisons)
        const expectedDefault = expectedCol.dflt_value === null ? "NULL" : expectedCol.dflt_value;
        const actualDefault = actualCol.dflt_value === null ? "NULL" : actualCol.dflt_value;
        
        if (expectedDefault !== actualDefault) {
          columnDiffs.push(
            `default value mismatch (expected: ${expectedDefault}, actual: ${actualDefault})`,
          );
        }

        // Compare column order (cid)
        if (expectedCol.cid !== actualCol.cid) {
          columnDiffs.push(
            `column order mismatch (expected position: ${expectedCol.cid}, actual position: ${actualCol.cid})`,
          );
        }

        // Report all differences for this column
        if (columnDiffs.length > 0) {
          differences.push(
            `⚠️  Table ${tableName}, column '${colName}':\n      ${columnDiffs.join("\n      ")}`,
          );
        }
      }

      // Check for extra columns
      for (const colName of actualColumns.keys()) {
        if (!expectedColumns.has(colName)) {
          const actualCol = actualColumns.get(colName)!;
          differences.push(
            `➕ Table ${tableName}: extra column '${colName}' (type: ${actualCol.type}, NOT NULL: ${actualCol.notnull === 1 ? "YES" : "NO"})`,
          );
        }
      }
    }

    // Compare indexes
    const expectedIndexNames = new Set(expectedTable.indexes.map((idx) => idx.name));
    const actualIndexNames = new Set(actualTable.indexes.map((idx) => idx.name));

    for (const indexName of expectedIndexNames) {
      if (!actualIndexNames.has(indexName)) {
        differences.push(`❌ Table ${tableName}: missing index ${indexName}`);
      }
    }

    for (const indexName of actualIndexNames) {
      if (!expectedIndexNames.has(indexName)) {
        differences.push(`➕ Table ${tableName}: extra index ${indexName}`);
      }
    }
  }

  return {
    isMatch: differences.length === 0,
    differences,
  };
}

/**
 * Main function to orchestrate the schema comparison.
 */
async function main() {
  const program = new Command();

  program
    .name("validate-schema")
    .description("Validate SQLite database schema against migrations")
    .option("--db <path>", "Path to the target documents.db file")
    .parse(process.argv);

  const options = program.opts();
  
  // Determine the target database path
  let targetDbPath: string;
  if (options.db) {
    targetDbPath = path.resolve(options.db as string);
  } else {
    const storePath = resolveStorePath();
    targetDbPath = path.join(storePath, "documents.db");
  }

  console.log("🔍 Database Schema Comparison Tool");
  console.log("================================\n");
  console.log(`Target database: ${targetDbPath}\n`);

  // Create expected schema from migrations
  console.log("📝 Creating expected schema from migrations...");
  const expectedDb = new Database(":memory:");
  sqliteVec.load(expectedDb);
  
  try {
    await applyMigrations(expectedDb);
    const expectedSchema = getSchemaDetails(expectedDb);
    console.log(`   Found ${expectedSchema.tables.size} tables in expected schema\n`);

    // Get actual schema from target database
    console.log("📂 Reading actual schema from target database...");
    const actualDb = new Database(targetDbPath, { readonly: true });
    sqliteVec.load(actualDb);
    
    try {
      const actualSchema = getSchemaDetails(actualDb);
      console.log(`   Found ${actualSchema.tables.size} tables in actual schema\n`);

      // Compare schemas
      console.log("🔎 Comparing schemas...\n");
      const comparison = compareSchemas(expectedSchema, actualSchema);

      if (comparison.isMatch) {
        console.log("✅ SUCCESS: Database schemas match perfectly!");
        console.log("   The database structure is exactly as expected.\n");
        process.exit(0);
      } else {
        console.log("❌ MISMATCH: Database schemas differ!\n");
        console.log("Differences found:\n");
        for (const diff of comparison.differences) {
          console.log(`  ${diff}`);
        }
        console.log(`\nTotal differences: ${comparison.differences.length}\n`);
        process.exit(1);
      }
    } finally {
      actualDb.close();
    }
  } finally {
    expectedDb.close();
  }
}

// Run the script
main().catch((error) => {
  console.error("\n❌ Error:", error.message);
  console.error(error.stack);
  process.exit(1);
});
