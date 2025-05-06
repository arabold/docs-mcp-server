// Integration test for database migrations using a real SQLite database

import Database, { type Database as DatabaseType } from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyMigrations } from "./applyMigrations";

describe("Database Migrations", () => {
  let db: DatabaseType;

  beforeEach(() => {
    db = new Database(":memory:");
    sqliteVec.load(db);
  });

  afterEach(() => {
    db.close();
  });

  it("should apply all migrations and create expected tables and columns", () => {
    expect(() => applyMigrations(db)).not.toThrow();

    // Check tables
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;")
      .all();
    interface TableRow {
      name: string;
    }
    const tableNames = (tables as TableRow[]).map((t) => t.name);
    expect(tableNames).toContain("documents");
    expect(tableNames).toContain("documents_fts");
    expect(tableNames).toContain("documents_vec");
    expect(tableNames).toContain("libraries");

    // Check columns for 'documents'
    const documentsColumns = db.prepare("PRAGMA table_info(documents);").all();
    interface ColumnInfo {
      name: string;
    }
    const documentsColumnNames = (documentsColumns as ColumnInfo[]).map(
      (col) => col.name,
    );
    expect(documentsColumnNames).toEqual(
      expect.arrayContaining([
        "id",
        "library_id",
        "version",
        "url",
        "content",
        "metadata",
        "sort_order",
        "indexed_at",
      ]),
    );

    // Check columns for 'libraries'
    const librariesColumns = db.prepare("PRAGMA table_info(libraries);").all();
    const librariesColumnNames = (librariesColumns as ColumnInfo[]).map(
      (col) => col.name,
    );
    expect(librariesColumnNames).toEqual(expect.arrayContaining(["id", "name"]));

    // Check FTS virtual table
    const ftsTableInfo = db
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='documents_fts';",
      )
      .get() as { sql: string } | undefined;
    expect(ftsTableInfo?.sql).toContain("VIRTUAL TABLE documents_fts USING fts5");

    // Check vector virtual table
    const vecTableInfo = db
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='documents_vec';",
      )
      .get() as { sql: string } | undefined;
    expect(vecTableInfo?.sql).toMatch(/CREATE VIRTUAL TABLE documents_vec USING vec0/i);
  });
});
