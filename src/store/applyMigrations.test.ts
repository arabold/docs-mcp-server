// Integration test for database migrations using a real SQLite database

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database, { type Database as DatabaseType } from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { restorePre017Libraries } from "../../test/test-helpers";
import { logger } from "../utils/logger";
import { applyMigrations, parseMigrationSteps } from "./applyMigrations";

describe("Database Migrations", () => {
  let db: DatabaseType;

  beforeEach(() => {
    db = new Database(":memory:");
    sqliteVec.load(db);
  });

  afterEach(() => {
    db.close();
    vi.restoreAllMocks();
  });

  it("parses a migration into labelled steps", () => {
    const cases: [
      label: string,
      sql: string,
      expected: { label: string; sql: string }[],
    ][] = [
      [
        "step markers split the steps without splitting SQL statements",
        `
      CREATE TABLE first(id INTEGER);
      INSERT INTO first VALUES (1);

      -- @migration-step create trigger
      CREATE TRIGGER first_after_insert AFTER INSERT ON first BEGIN
        INSERT INTO first VALUES (NEW.id + 1);
      END;

      -- @migration-step finish
      INSERT INTO first VALUES (3);
    `,
        [
          {
            label: "prepare",
            sql: "CREATE TABLE first(id INTEGER);\n      INSERT INTO first VALUES (1);",
          },
          {
            label: "create trigger",
            sql: "CREATE TRIGGER first_after_insert AFTER INSERT ON first BEGIN\n        INSERT INTO first VALUES (NEW.id + 1);\n      END;",
          },
          {
            label: "finish",
            sql: "INSERT INTO first VALUES (3);",
          },
        ],
      ],
      [
        "an unmarked migration is a single implicit block",
        `
      -- Migration without explicit checkpoints
      CREATE TABLE unmarked(id INTEGER);
      INSERT INTO unmarked VALUES (1);
    `,
        [
          {
            label: "migration",
            sql: "-- Migration without explicit checkpoints\n      CREATE TABLE unmarked(id INTEGER);\n      INSERT INTO unmarked VALUES (1);",
          },
        ],
      ],
      [
        "a comment-only block is skipped",
        `
      -- @migration-step comment only
      -- no executable statements here

      -- @migration-step create table
      CREATE TABLE executable(id INTEGER);
    `,
        [
          {
            label: "create table",
            sql: "CREATE TABLE executable(id INTEGER);",
          },
        ],
      ],
    ];

    for (const [label, sql, expected] of cases) {
      expect.soft(parseMigrationSteps(sql), label).toEqual(expected);
    }
  });

  it("should apply all migrations and create expected tables and columns", async () => {
    const infoSpy = vi.spyOn(logger, "info");

    await expect(applyMigrations(db)).resolves.toBeUndefined();

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
    // documents_vec is created by migrations with a fixed 1536 dimension;
    // DocumentStore.ensureVectorTable() reconciles it at runtime if the configured dimension differs
    expect(tableNames).toContain("documents_vec");
    expect(tableNames).toContain("libraries");
    expect(tableNames).toContain("metadata");
    expect(tableNames).toContain("pages");

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
        "page_id",
        "content",
        "metadata",
        "sort_order",
        "embedding",
      ]),
    );

    // Ensure the old library and version columns are removed after complete normalization
    expect(documentsColumnNames).not.toContain("library");
    expect(documentsColumnNames).not.toContain("version");
    expect(documentsColumnNames).not.toContain("library_id");
    expect(documentsColumnNames).not.toContain("version_id");
    expect(documentsColumnNames).not.toContain("url");

    // Check columns for 'pages'
    const pagesColumns = db.prepare("PRAGMA table_info(pages);").all();
    const pagesColumnNames = (pagesColumns as ColumnInfo[]).map((col) => col.name);
    expect(pagesColumnNames).toEqual(
      expect.arrayContaining([
        "id",
        "version_id",
        "url",
        "title",
        "etag",
        "last_modified",
        "source_content_type",
        "content_type",
        "created_at",
      ]),
    );

    // Check columns for 'libraries'
    const librariesColumns = db.prepare("PRAGMA table_info(libraries);").all();
    const librariesColumnNames = (librariesColumns as ColumnInfo[]).map(
      (col) => col.name,
    );
    expect(librariesColumnNames).toEqual(expect.arrayContaining(["id", "name"]));

    // Check versions table exists and has correct schema
    expect(tableNames).toContain("versions");
    const versionsColumns = db.prepare("PRAGMA table_info(versions);").all();
    const versionsColumnNames = (versionsColumns as ColumnInfo[]).map((col) => col.name);
    expect(versionsColumnNames).toEqual(
      expect.arrayContaining(["id", "library_id", "name", "created_at"]),
    );

    // Check FTS virtual table
    const ftsTableInfo = db
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='documents_fts';",
      )
      .get() as { sql: string } | undefined;
    expect(ftsTableInfo?.sql).toContain("VIRTUAL TABLE documents_fts USING fts5");

    // documents_vec is created by migrations with fixed 1536 dimension and partition keys.
    // DocumentStore.ensureVectorTable() reconciles it at runtime if needed.
    const vecTableInfo = db
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='documents_vec';",
      )
      .get() as { sql: string } | undefined;
    expect(vecTableInfo).toBeDefined();
    expect(vecTableInfo?.sql).toContain("library_id INTEGER partition key");
    expect(vecTableInfo?.sql).toContain("version_id INTEGER partition key");

    const infoMessages = infoSpy.mock.calls.map(([message]) => message).join("\n");
    expect(infoMessages).toMatch(/Applying migration 1\/\d+ 000-initial-schema\.sql/);
    expect(infoMessages).toContain("  . migration");
    expect(infoMessages).toMatch(
      /Applying migration \d+\/\d+ 014-rebuild-vector-partition-keys\.sql/,
    );
    expect(infoMessages).toContain("  . preserve existing vectors");
    expect(infoMessages).toContain("  . cleanup staging data");
    expect(infoMessages).toMatch(/Completed migration \d+\/\d+ .* in \d+\.\d+s/);
  });

  it("should preserve and backfill vectors when migrating to partition keys", async () => {
    await expect(applyMigrations(db)).resolves.toBeUndefined();

    const ddl = db
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='documents_vec';",
      )
      .get() as { sql: string };
    expect(ddl.sql).toContain("library_id INTEGER partition key");
    expect(ddl.sql).toContain("version_id INTEGER partition key");

    db.prepare("INSERT INTO libraries (name, display_name) VALUES (?, ?)").run(
      "partition-lib",
      "partition-lib",
    );
    const { id: libraryId } = db
      .prepare("SELECT id FROM libraries WHERE name = ?")
      .get("partition-lib") as { id: number };
    db.prepare("INSERT INTO versions (library_id, name) VALUES (?, ?)").run(
      libraryId,
      "1.0.0",
    );
    db.prepare("INSERT INTO versions (library_id, name) VALUES (?, ?)").run(
      libraryId,
      "2.0.0",
    );
    const { id: versionId } = db
      .prepare("SELECT id FROM versions WHERE library_id = ? AND name = ?")
      .get(libraryId, "1.0.0") as { id: number };
    const { id: staleVersionId } = db
      .prepare("SELECT id FROM versions WHERE library_id = ? AND name = ?")
      .get(libraryId, "2.0.0") as { id: number };

    const pageId = db
      .prepare("INSERT INTO pages (version_id, url, title) VALUES (?, ?, ?)")
      .run(versionId, "https://example.com/partition", "Partitioned").lastInsertRowid as
      | number
      | bigint;
    const preservedVector = new Array(1536)
      .fill(0)
      .map((_, index) => (index === 0 ? 1 : 0));
    const backfillVector = new Array(1536)
      .fill(0)
      .map((_, index) => (index === 1 ? 1 : 0));
    const preservedDocId = db
      .prepare(
        "INSERT INTO documents (page_id, content, metadata, sort_order) VALUES (?, ?, ?, ?)",
      )
      .run(pageId, "Preserved vector content", JSON.stringify({ path: "/partition" }), 0)
      .lastInsertRowid as number | bigint;
    const backfilledDocId = db
      .prepare(
        "INSERT INTO documents (page_id, content, metadata, sort_order, embedding) VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        pageId,
        "Backfilled vector content",
        JSON.stringify({ path: "/partition" }),
        1,
        JSON.stringify(backfillVector),
      ).lastInsertRowid as number | bigint;

    db.exec(`
      CREATE TABLE _test_existing_vectors AS
      SELECT rowid, library_id, version_id, embedding FROM documents_vec;
      DROP TABLE documents_vec;
      CREATE VIRTUAL TABLE documents_vec USING vec0(
        library_id INTEGER NOT NULL,
        version_id INTEGER NOT NULL,
        embedding FLOAT[1536]
      );
      INSERT INTO documents_vec (rowid, library_id, version_id, embedding)
      SELECT rowid, library_id, version_id, embedding FROM _test_existing_vectors;
      DROP TABLE _test_existing_vectors;
      DELETE FROM documents_vec;
    `);
    db.prepare(
      "INSERT INTO documents_vec (rowid, library_id, version_id, embedding) VALUES (?, ?, ?, ?)",
    ).run(
      BigInt(preservedDocId),
      BigInt(libraryId),
      BigInt(staleVersionId),
      JSON.stringify(preservedVector),
    );

    db.prepare("DELETE FROM _schema_migrations WHERE id = ?").run(
      "014-rebuild-vector-partition-keys.sql",
    );

    await expect(applyMigrations(db)).resolves.toBeUndefined();

    const migratedDdl = db
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='documents_vec';",
      )
      .get() as { sql: string };
    expect(migratedDdl.sql).toContain("library_id INTEGER partition key");
    expect(migratedDdl.sql).toContain("version_id INTEGER partition key");

    const vectorRows = db
      .prepare("SELECT COUNT(*) as cnt FROM documents_vec WHERE rowid = ?")
      .get(preservedDocId) as { cnt: number };
    expect(vectorRows.cnt).toBe(1);

    const partitionKeys = db
      .prepare("SELECT library_id, version_id FROM documents_vec WHERE rowid = ?")
      .get(preservedDocId) as { library_id: number; version_id: number };
    expect(partitionKeys.library_id).toBe(libraryId);
    expect(partitionKeys.version_id).toBe(versionId);

    const backfilledVectorRows = db
      .prepare("SELECT COUNT(*) as cnt FROM documents_vec WHERE rowid = ?")
      .get(backfilledDocId) as { cnt: number };
    expect(backfilledVectorRows.cnt).toBe(1);

    const result = db
      .prepare(`
        SELECT rowid, distance
        FROM documents_vec
        WHERE library_id = ?
          AND version_id = ?
          AND embedding MATCH ?
          AND k = 1
      `)
      .get(libraryId, versionId, JSON.stringify(preservedVector)) as
      | { rowid: number; distance: number }
      | undefined;

    expect(result?.rowid).toBe(Number(preservedDocId));
    expect(result?.distance).toBeCloseTo(0, 6);
  });

  it("should keep a custom vector dimension when rebuilding partition keys", async () => {
    await expect(applyMigrations(db)).resolves.toBeUndefined();

    db.prepare("INSERT INTO libraries (name, display_name) VALUES (?, ?)").run(
      "custom-dim-lib",
      "custom-dim-lib",
    );
    const { id: libraryId } = db
      .prepare("SELECT id FROM libraries WHERE name = ?")
      .get("custom-dim-lib") as { id: number };
    db.prepare("INSERT INTO versions (library_id, name) VALUES (?, ?)").run(
      libraryId,
      "1.0.0",
    );
    const { id: versionId } = db
      .prepare("SELECT id FROM versions WHERE library_id = ? AND name = ?")
      .get(libraryId, "1.0.0") as { id: number };
    const pageId = db
      .prepare("INSERT INTO pages (version_id, url, title) VALUES (?, ?, ?)")
      .run(versionId, "https://example.com/custom-dim", "Custom Dimension")
      .lastInsertRowid as number | bigint;

    db.exec(`
      DROP TABLE documents_vec;
      CREATE VIRTUAL TABLE documents_vec USING vec0(
        library_id INTEGER NOT NULL,
        version_id INTEGER NOT NULL,
        embedding FLOAT[4]
      );
    `);

    const preservedVector = [1, 0, 0, 0];
    const backfillVector = [0, 1, 0, 0];
    const preservedDocId = db
      .prepare(
        "INSERT INTO documents (page_id, content, metadata, sort_order) VALUES (?, ?, ?, ?)",
      )
      .run(
        pageId,
        "Preserved custom vector content",
        JSON.stringify({ path: "/custom-preserved" }),
        0,
      ).lastInsertRowid as number | bigint;
    const backfilledDocId = db
      .prepare(
        "INSERT INTO documents (page_id, content, metadata, sort_order, embedding) VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        pageId,
        "Backfilled custom vector content",
        JSON.stringify({ path: "/custom-backfilled" }),
        1,
        JSON.stringify(backfillVector),
      ).lastInsertRowid as number | bigint;

    db.prepare(
      "INSERT INTO documents_vec (rowid, library_id, version_id, embedding) VALUES (?, ?, ?, ?)",
    ).run(
      BigInt(preservedDocId),
      BigInt(libraryId),
      BigInt(versionId),
      JSON.stringify(preservedVector),
    );
    db.prepare("DELETE FROM documents_vec WHERE rowid = ?").run(backfilledDocId);
    db.prepare("DELETE FROM _schema_migrations WHERE id = ?").run(
      "014-rebuild-vector-partition-keys.sql",
    );

    await expect(applyMigrations(db)).resolves.toBeUndefined();

    const migratedDdl = db
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='documents_vec';",
      )
      .get() as { sql: string };
    expect(migratedDdl.sql).toContain("embedding FLOAT[4]");
    expect(migratedDdl.sql).toContain("library_id INTEGER partition key");
    expect(migratedDdl.sql).toContain("version_id INTEGER partition key");

    for (const docId of [preservedDocId, backfilledDocId]) {
      const vectorRows = db
        .prepare("SELECT COUNT(*) as cnt FROM documents_vec WHERE rowid = ?")
        .get(docId) as { cnt: number };
      expect(vectorRows.cnt).toBe(1);
    }

    const result = db
      .prepare(`
        SELECT rowid, distance
        FROM documents_vec
        WHERE library_id = ?
          AND version_id = ?
          AND embedding MATCH ?
          AND k = 1
      `)
      .get(libraryId, versionId, JSON.stringify(preservedVector)) as
      | { rowid: number; distance: number }
      | undefined;

    expect(result?.rowid).toBe(Number(preservedDocId));
    expect(result?.distance).toBeCloseTo(0, 6);
  });

  it("should preserve the old vector table if partition migration fails", async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "docs-mcp-migration-"));
    const dbPath = path.join(tempDir, "migration.sqlite");
    const migrationDb = new Database(dbPath);
    sqliteVec.load(migrationDb);

    try {
      await expect(applyMigrations(migrationDb)).resolves.toBeUndefined();

      migrationDb
        .prepare("INSERT INTO libraries (name, display_name) VALUES (?, ?)")
        .run("rollback-lib", "rollback-lib");
      const { id: libraryId } = migrationDb
        .prepare("SELECT id FROM libraries WHERE name = ?")
        .get("rollback-lib") as { id: number };
      migrationDb
        .prepare("INSERT INTO versions (library_id, name) VALUES (?, ?)")
        .run(libraryId, "1.0.0");
      const { id: versionId } = migrationDb
        .prepare("SELECT id FROM versions WHERE library_id = ? AND name = ?")
        .get(libraryId, "1.0.0") as { id: number };
      const pageId = migrationDb
        .prepare("INSERT INTO pages (version_id, url, title) VALUES (?, ?, ?)")
        .run(versionId, "https://example.com/rollback", "Rollback").lastInsertRowid as
        | number
        | bigint;
      const preservedVector = new Array(1536)
        .fill(0)
        .map((_, index) => (index === 0 ? 1 : 0));
      const preservedDocId = migrationDb
        .prepare(
          "INSERT INTO documents (page_id, content, metadata, sort_order) VALUES (?, ?, ?, ?)",
        )
        .run(pageId, "Preserved vector content", JSON.stringify({ path: "/rollback" }), 0)
        .lastInsertRowid as number | bigint;

      migrationDb.exec(`
        CREATE TABLE _test_existing_vectors AS
        SELECT rowid, library_id, version_id, embedding FROM documents_vec;
        DROP TABLE documents_vec;
        CREATE VIRTUAL TABLE documents_vec USING vec0(
          library_id INTEGER NOT NULL,
          version_id INTEGER NOT NULL,
          embedding FLOAT[1536]
        );
        INSERT INTO documents_vec (rowid, library_id, version_id, embedding)
        SELECT rowid, library_id, version_id, embedding FROM _test_existing_vectors;
        DROP TABLE _test_existing_vectors;
        DELETE FROM documents_vec;
        DROP TRIGGER IF EXISTS documents_vec_after_insert;
        DROP TRIGGER IF EXISTS documents_vec_after_update;
        DROP TRIGGER IF EXISTS documents_vec_after_delete;
      `);
      migrationDb
        .prepare(
          "INSERT INTO documents_vec (rowid, library_id, version_id, embedding) VALUES (?, ?, ?, ?)",
        )
        .run(
          BigInt(preservedDocId),
          BigInt(libraryId),
          BigInt(versionId),
          JSON.stringify(preservedVector),
        );
      migrationDb
        .prepare(
          "INSERT INTO documents (page_id, content, metadata, sort_order, embedding) VALUES (?, ?, ?, ?, ?)",
        )
        .run(
          pageId,
          "Malformed embedding content",
          JSON.stringify({ path: "/rollback-malformed" }),
          1,
          "not-json",
        );
      migrationDb
        .prepare("DELETE FROM _schema_migrations WHERE id = ?")
        .run("014-rebuild-vector-partition-keys.sql");

      const errorSpy = vi.spyOn(logger, "error");
      await expect(applyMigrations(migrationDb)).rejects.toThrow(
        "Migration failed: 014-rebuild-vector-partition-keys.sql",
      );
      const errorMessages = errorSpy.mock.calls.map(([message]) => message).join("\n");
      expect(errorMessages).toMatch(
        /Failed migration 1\/1 014-rebuild-vector-partition-keys\.sql after \d+\.\d+s/,
      );

      const migrationMarker = migrationDb
        .prepare("SELECT id FROM _schema_migrations WHERE id = ?")
        .get("014-rebuild-vector-partition-keys.sql");
      expect(migrationMarker).toBeUndefined();

      const ddl = migrationDb
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type='table' AND name='documents_vec';",
        )
        .get() as { sql: string };
      expect(ddl.sql).not.toContain("partition key");

      const vectorRows = migrationDb
        .prepare("SELECT COUNT(*) as cnt FROM documents_vec WHERE rowid = ?")
        .get(preservedDocId) as { cnt: number };
      expect(vectorRows.cnt).toBe(1);

      const stagingTable = migrationDb
        .prepare("SELECT name FROM sqlite_master WHERE name = ?")
        .get("_documents_vec_partition_migration");
      expect(stagingTable).toBeUndefined();

      migrationDb
        .prepare("UPDATE documents SET embedding = NULL WHERE content = ?")
        .run("Malformed embedding content");

      await expect(applyMigrations(migrationDb)).resolves.toBeUndefined();
      const retriedMigrationMarker = migrationDb
        .prepare("SELECT id FROM _schema_migrations WHERE id = ?")
        .get("014-rebuild-vector-partition-keys.sql");
      expect(retriedMigrationMarker).toEqual({
        id: "014-rebuild-vector-partition-keys.sql",
      });
    } finally {
      migrationDb.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("embedding storage", () => {
    const vector = new Array(1536).fill(0).map((_, index) => (index === 2 ? 1 : 0));

    /** Inserts one document on a fresh library, version and page. */
    function insertDocument(content: string, embedding: string | null = null) {
      db.prepare("INSERT INTO libraries (name, display_name) VALUES (?, ?)").run(
        "blob-lib",
        "blob-lib",
      );
      const { id: libraryId } = db
        .prepare("SELECT id FROM libraries WHERE name = ?")
        .get("blob-lib") as { id: number };
      db.prepare("INSERT INTO versions (library_id, name) VALUES (?, ?)").run(
        libraryId,
        "1.0.0",
      );
      const { id: versionId } = db
        .prepare("SELECT id FROM versions WHERE library_id = ?")
        .get(libraryId) as { id: number };
      const pageId = db
        .prepare("INSERT INTO pages (version_id, url, title) VALUES (?, ?, ?)")
        .run(versionId, "https://example.com/blob", "Blob").lastInsertRowid;
      const docId = db
        .prepare(
          "INSERT INTO documents (page_id, content, metadata, sort_order, embedding) VALUES (?, ?, ?, ?, ?)",
        )
        .run(
          pageId,
          content,
          JSON.stringify({ path: "/blob" }),
          0,
          embedding,
        ).lastInsertRowid;
      return { libraryId, versionId, docId: Number(docId) };
    }

    it("should convert JSON embeddings to float32 blobs and keep them searchable", async () => {
      await expect(applyMigrations(db)).resolves.toBeUndefined();
      // Rows written before migration 018 hold JSON text
      const { libraryId, versionId, docId } = insertDocument(
        "Stored as JSON",
        JSON.stringify(vector),
      );
      db.prepare("DELETE FROM _schema_migrations WHERE id = ?").run(
        "018-store-embeddings-as-blobs.sql",
      );

      await expect(applyMigrations(db)).resolves.toBeUndefined();

      const { embedding } = db
        .prepare("SELECT embedding FROM documents WHERE id = ?")
        .get(docId) as { embedding: Buffer };
      expect(Buffer.isBuffer(embedding)).toBe(true);
      expect(Array.from(new Float32Array(Uint8Array.from(embedding).buffer))).toEqual(
        vector,
      );

      const nearest = db
        .prepare(`
          SELECT rowid, distance
          FROM documents_vec
          WHERE library_id = ? AND version_id = ? AND embedding MATCH ? AND k = 1
        `)
        .get(libraryId, versionId, JSON.stringify(vector)) as
        | { rowid: number; distance: number }
        | undefined;
      expect(nearest?.rowid).toBe(docId);
      expect(nearest?.distance).toBeCloseTo(0, 6);
    });

    it("should reindex full text when document content changes", async () => {
      await expect(applyMigrations(db)).resolves.toBeUndefined();
      const { docId } = insertDocument("original wording");

      db.prepare("UPDATE documents SET content = ? WHERE id = ?").run(
        "revised wording",
        docId,
      );

      const matches = (term: string) =>
        db
          .prepare("SELECT rowid FROM documents_fts WHERE documents_fts MATCH ?")
          .all(term);
      expect(matches("revised")).toEqual([{ rowid: docId }]);
      expect(matches("original")).toEqual([]);
    });
  });

  describe("020 page chunk counts", () => {
    /** Each page's stored count beside the count of its documents. */
    function counts() {
      return db
        .prepare(
          `SELECT p.chunk_count AS stored,
            (SELECT COUNT(*) FROM documents d WHERE d.page_id = p.id) AS actual
          FROM pages p ORDER BY p.id`,
        )
        .all() as Array<{ stored: number; actual: number }>;
    }

    it("backfills existing pages and keeps counts through inserts, deletes and moves", async () => {
      await applyMigrations(db);
      db.exec(`
        DROP INDEX idx_pages_version_listing;
        DROP TRIGGER pages_chunk_count_after_insert;
        DROP TRIGGER pages_chunk_count_after_delete;
        DROP TRIGGER pages_chunk_count_after_update;
        ALTER TABLE pages DROP COLUMN chunk_count;
        DELETE FROM _schema_migrations WHERE id = '020-add-page-chunk-count.sql';
      `);
      db.prepare(
        "INSERT INTO libraries (name, display_name) VALUES ('lib', 'lib')",
      ).run();
      db.prepare(
        "INSERT INTO versions (library_id, name) SELECT id, '1.0.0' FROM libraries",
      ).run();
      const addPage = db.prepare(
        "INSERT INTO pages (version_id, url, title) SELECT id, ?, 'T' FROM versions",
      );
      const first = Number(addPage.run("https://example.com/a").lastInsertRowid);
      const second = Number(addPage.run("https://example.com/b").lastInsertRowid);
      const addChunk = db.prepare(
        "INSERT INTO documents (page_id, content, metadata, sort_order) VALUES (?, 'c', '{}', ?)",
      );
      for (const order of [0, 1, 2]) addChunk.run(first, order);
      addChunk.run(second, 0);

      await expect(applyMigrations(db)).resolves.toBeUndefined();
      expect(counts()).toEqual([
        { stored: 3, actual: 3 },
        { stored: 1, actual: 1 },
      ]);

      addChunk.run(second, 1);
      db.prepare("DELETE FROM documents WHERE page_id = ? AND sort_order = 0").run(first);
      db.prepare(
        "UPDATE documents SET page_id = ? WHERE page_id = ? AND sort_order = 1",
      ).run(second, first);
      expect(counts()).toEqual([
        { stored: 1, actual: 1 },
        { stored: 3, actual: 3 },
      ]);
    });
  });

  it("should cap the WAL file size kept after checkpoints", async () => {
    await expect(applyMigrations(db)).resolves.toBeUndefined();

    expect(db.pragma("journal_size_limit", { simple: true })).toBe(64 * 1024 * 1024);
  });

  describe("017 library display names", () => {
    const MIGRATION_017 = "017-add-library-display-name.sql";

    /**
     * Applies every migration, then puts `libraries` back into its pre-017 shape and forgets 017, so the
     * next `applyMigrations` call runs 017 against rows seeded in the old shape.
     */
    async function prepareLegacyLibraries(): Promise<void> {
      await applyMigrations(db);
      restorePre017Libraries(db);
    }

    function seedLibrary(name: string, versions: string[] = []): number {
      const id = Number(
        db.prepare("INSERT INTO libraries (name) VALUES (?)").run(name).lastInsertRowid,
      );
      for (const version of versions) {
        db.prepare("INSERT INTO versions (library_id, name) VALUES (?, ?)").run(
          id,
          version,
        );
      }
      return id;
    }

    function libraryRows() {
      return db
        .prepare("SELECT id, name, display_name, created_at FROM libraries ORDER BY id")
        .all() as Array<{
        id: number;
        name: string;
        display_name: string;
        created_at: string;
      }>;
    }

    it("backfills display names, keeps ids and version references, and prunes empty libraries", async () => {
      await prepareLegacyLibraries();
      const reactId = seedLibrary("react", ["18.0.0", ""]);
      const vueId = seedLibrary("vue", ["3.0.0"]);
      seedLibrary("ghost");
      const versionId = (
        db
          .prepare("SELECT id FROM versions WHERE library_id = ? AND name = ?")
          .get(reactId, "18.0.0") as { id: number }
      ).id;
      db.prepare("INSERT INTO pages (version_id, url, title) VALUES (?, ?, ?)").run(
        versionId,
        "https://example.com/react",
        "React",
      );
      const before = db
        .prepare("SELECT id, created_at FROM libraries WHERE id IN (?, ?) ORDER BY id")
        .all(reactId, vueId);

      await expect(applyMigrations(db)).resolves.toBeUndefined();

      const rows = libraryRows();
      expect(rows.map(({ id, created_at }) => ({ id, created_at }))).toEqual(before);
      expect(rows.map((row) => [row.name, row.display_name])).toEqual([
        ["react", "react"],
        ["vue", "vue"],
      ]);
      const versionOwners = db
        .prepare("SELECT DISTINCT library_id FROM versions ORDER BY library_id")
        .all() as Array<{ library_id: number }>;
      expect(versionOwners.map((row) => row.library_id)).toEqual([reactId, vueId]);
      expect(db.pragma("foreign_key_check")).toEqual([]);
    });

    it("requires a display name and keeps foreign keys enforced", async () => {
      await prepareLegacyLibraries();
      const reactId = seedLibrary("react", ["1.0.0"]);
      await applyMigrations(db);

      // Deferred foreign-key checks are turned off again
      expect(db.pragma("defer_foreign_keys", { simple: true })).toBe(0);
      expect(() =>
        db.prepare("INSERT INTO libraries (name) VALUES (?)").run("no-display"),
      ).toThrow(expect.objectContaining({ code: "SQLITE_CONSTRAINT_NOTNULL" }));
      expect(() => db.prepare("DELETE FROM libraries WHERE id = ?").run(reactId)).toThrow(
        expect.objectContaining({ code: "SQLITE_CONSTRAINT_FOREIGNKEY" }),
      );
    });

    it("preserves the id sequence so deleted library ids are never reused", async () => {
      await prepareLegacyLibraries();
      seedLibrary("kept", ["1.0.0"]);
      const deletedId = seedLibrary("deleted", ["1.0.0"]);
      db.prepare("DELETE FROM versions WHERE library_id = ?").run(deletedId);
      db.prepare("DELETE FROM libraries WHERE id = ?").run(deletedId);
      await applyMigrations(db);

      const newId = Number(
        db
          .prepare("INSERT INTO libraries (name, display_name) VALUES (?, ?)")
          .run("new", "new").lastInsertRowid,
      );
      expect(newId).toBeGreaterThan(deletedId);
    });

    it("preserves the id sequence when the prune leaves the table empty", async () => {
      await prepareLegacyLibraries();
      const ghostId = seedLibrary("ghost");
      await applyMigrations(db);

      expect(libraryRows()).toEqual([]);
      const newId = Number(
        db
          .prepare("INSERT INTO libraries (name, display_name) VALUES (?, ?)")
          .run("new", "new").lastInsertRowid,
      );
      expect(newId).toBeGreaterThan(ghostId);
    });

    it("rolls back the rebuild when a later step fails", async () => {
      await prepareLegacyLibraries();
      seedLibrary("react", ["1.0.0"]);
      const originalExec = db.exec.bind(db);
      vi.spyOn(db, "exec").mockImplementation((sql: string) => {
        if (sql.includes("CREATE UNIQUE INDEX idx_libraries_lower_name ON libraries")) {
          throw new Error("injected failure after the rebuild");
        }
        return originalExec(sql);
      });

      await expect(applyMigrations(db)).rejects.toThrow(
        `Migration failed: ${MIGRATION_017}`,
      );

      const columns = (
        db.prepare("PRAGMA table_info(libraries)").all() as Array<{ name: string }>
      ).map((column) => column.name);
      expect(columns).not.toContain("display_name");
      expect(db.prepare("SELECT name FROM libraries").all()).toEqual([{ name: "react" }]);
      expect(
        db.prepare("SELECT id FROM _schema_migrations WHERE id = ?").get(MIGRATION_017),
      ).toBeUndefined();
    });

    it("keeps an empty legacy name instead of failing the upgrade", async () => {
      await prepareLegacyLibraries();
      seedLibrary("", ["1.0.0"]);

      await expect(applyMigrations(db)).resolves.toBeUndefined();

      expect(libraryRows().map((row) => [row.name, row.display_name])).toEqual([
        ["", ""],
      ]);
    });

    it("re-keys padded legacy names unless the trimmed key is taken", async () => {
      await prepareLegacyLibraries();
      seedLibrary(" react ", ["1.0.0"]);
      seedLibrary(" vue ", ["1.0.0"]);
      seedLibrary("vue", ["2.0.0"]);
      // Padding the lookup key also trims: NBSP, an ideographic space, a BOM
      seedLibrary("\u00a0svelte\u3000\ufeff", ["1.0.0"]);

      await expect(applyMigrations(db)).resolves.toBeUndefined();

      expect(libraryRows().map((row) => [row.name, row.display_name])).toEqual([
        ["react", "react"],
        [" vue ", " vue "],
        ["vue", "vue"],
        ["svelte", "svelte"],
      ]);
    });

    it("re-keys only the oldest of several padded names that share a free trimmed key", async () => {
      await prepareLegacyLibraries();
      seedLibrary(" react ", ["1.0.0"]);
      seedLibrary("react ", ["2.0.0"]);

      await expect(applyMigrations(db)).resolves.toBeUndefined();

      expect(libraryRows().map((row) => [row.name, row.display_name])).toEqual([
        ["react", "react"],
        ["react ", "react "],
      ]);
    });
  });
});
