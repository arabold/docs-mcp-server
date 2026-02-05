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
    // documents_vec is dropped by migration 012 and created at runtime by DocumentStore.ensureVectorTable()
    expect(tableNames).not.toContain("documents_vec");
    expect(tableNames).toContain("libraries");
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

    // documents_vec is created at runtime by DocumentStore.ensureVectorTable() with config dimension; not present after migrations
    const vecTableInfo = db
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='documents_vec';",
      )
      .get() as { sql: string } | undefined;
    expect(vecTableInfo).toBeUndefined();
  });

  /** Create documents_vec with fixed dimension for tests that need vector search without full DocumentStore init */
  function createVectorTableForTest(testDb: DatabaseType, dimension: number): void {
    testDb.exec(`
      CREATE VIRTUAL TABLE documents_vec USING vec0(
        library_id INTEGER NOT NULL,
        version_id INTEGER NOT NULL,
        embedding FLOAT[${dimension}]
      );
    `);
  }

  it("should handle vector search with empty results gracefully", () => {
    // Apply all migrations (documents_vec is dropped by 012; create it for this test)
    expect(() => applyMigrations(db)).not.toThrow();
    createVectorTableForTest(db, 1536);

    // Insert a library and version but no documents
    db.prepare("INSERT INTO libraries (name) VALUES (?)").run("empty-lib");
    const emptyLibraryIdResult = db
      .prepare("SELECT id FROM libraries WHERE name = ?")
      .get("empty-lib") as { id: number } | undefined;
    expect(emptyLibraryIdResult).toBeDefined();
    const emptyLibraryId = emptyLibraryIdResult!.id;

    // Insert a version for this library
    db.prepare("INSERT INTO versions (library_id, name) VALUES (?, ?)").run(
      emptyLibraryId,
      "1.0.0",
    );
    const versionResult = db
      .prepare("SELECT id FROM versions WHERE library_id = ? AND name = ?")
      .get(emptyLibraryId, "1.0.0") as { id: number } | undefined;
    expect(versionResult).toBeDefined();
    const _versionId = versionResult!.id;

    // Search for vectors in empty library with k constraint
    const searchVector = new Array(1536).fill(0.5);
    const vectorSearchQuery = `
      SELECT 
        dv.rowid,
        d.content,
        dv.distance
      FROM documents_vec dv
      JOIN documents d ON dv.rowid = d.id
      JOIN versions v ON dv.version_id = v.id
      JOIN libraries l ON v.library_id = l.id
      WHERE dv.embedding MATCH ?
      AND l.name = ?
      AND v.name = ?
      AND k = 5
      ORDER BY dv.distance ASC
    `;

    const searchResults = db
      .prepare(vectorSearchQuery)
      .all(JSON.stringify(searchVector), "empty-lib", "1.0.0");

    // Should return empty array, not throw an error
    expect(searchResults).toEqual([]);
  });

  it("should perform vector search and return similar vectors correctly", () => {
    // Apply all migrations (documents_vec is dropped by 012; create it for this test)
    expect(() => applyMigrations(db)).not.toThrow();
    createVectorTableForTest(db, 1536);

    // Insert test library and version
    db.prepare("INSERT INTO libraries (name) VALUES (?)").run("test-lib");
    const libraryResult = db
      .prepare("SELECT id FROM libraries WHERE name = ?")
      .get("test-lib") as { id: number } | undefined;
    expect(libraryResult).toBeDefined();
    const libraryId = libraryResult!.id;

    db.prepare("INSERT INTO versions (library_id, name) VALUES (?, ?)").run(
      libraryId,
      "1.0.0",
    );
    const versionResult = db
      .prepare("SELECT id FROM versions WHERE library_id = ? AND name = ?")
      .get(libraryId, "1.0.0") as { id: number } | undefined;
    expect(versionResult).toBeDefined();
    const versionId = versionResult!.id;

    // Insert test pages first
    const insertPage = db.prepare(`
      INSERT INTO pages (version_id, url, title, etag, last_modified, content_type)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const page1Id = insertPage.run(
      versionId,
      "https://example.com/doc1",
      "AI Basics",
      null,
      null,
      "text/html",
    ).lastInsertRowid as number;

    const page2Id = insertPage.run(
      versionId,
      "https://example.com/doc2",
      "Neural Networks",
      null,
      null,
      "text/html",
    ).lastInsertRowid as number;

    const page3Id = insertPage.run(
      versionId,
      "https://example.com/doc3",
      "Cooking Guide",
      null,
      null,
      "text/html",
    ).lastInsertRowid as number;

    // Insert test documents
    const insertDoc = db.prepare(`
      INSERT INTO documents (page_id, content, metadata, sort_order)
      VALUES (?, ?, ?, ?)
    `);

    const doc1Id = insertDoc.run(
      page1Id,
      "This is about machine learning and artificial intelligence",
      JSON.stringify({ title: "AI Basics", path: "/ai-basics" }),
      1,
    ).lastInsertRowid as number;

    const doc2Id = insertDoc.run(
      page2Id,
      "This document discusses neural networks and deep learning",
      JSON.stringify({ title: "Neural Networks", path: "/neural-networks" }),
      2,
    ).lastInsertRowid as number;

    const doc3Id = insertDoc.run(
      page3Id,
      "Cooking recipes and food preparation techniques",
      JSON.stringify({ title: "Cooking Guide", path: "/cooking" }),
      3,
    ).lastInsertRowid as number;

    // Create test vectors (similar vectors for AI-related docs, different for cooking)
    const aiVector1 = new Array(1536)
      .fill(0)
      .map((_, i) => (i < 100 ? Math.random() * 0.1 + 0.8 : Math.random() * 0.2));
    const aiVector2 = new Array(1536)
      .fill(0)
      .map((_, i) => (i < 100 ? Math.random() * 0.1 + 0.75 : Math.random() * 0.2));
    const cookingVector = new Array(1536)
      .fill(0)
      .map((_, i) =>
        i >= 100 && i < 200 ? Math.random() * 0.1 + 0.9 : Math.random() * 0.2,
      );

    // Insert vectors
    const insertVector = db.prepare(`
      INSERT INTO documents_vec (rowid, library_id, version_id, embedding)
      VALUES (?, ?, ?, ?)
    `);

    insertVector.run(
      BigInt(doc1Id),
      BigInt(libraryId),
      BigInt(versionId),
      JSON.stringify(aiVector1),
    );
    insertVector.run(
      BigInt(doc2Id),
      BigInt(libraryId),
      BigInt(versionId),
      JSON.stringify(aiVector2),
    );
    insertVector.run(
      BigInt(doc3Id),
      BigInt(libraryId),
      BigInt(versionId),
      JSON.stringify(cookingVector),
    );

    // Search with a vector similar to AI vectors
    const searchVector = new Array(1536)
      .fill(0)
      .map((_, i) => (i < 100 ? Math.random() * 0.1 + 0.77 : Math.random() * 0.2));

    const vectorSearchQuery = `
      SELECT 
        dv.rowid,
        d.content,
        dv.distance
      FROM documents_vec dv
      JOIN documents d ON dv.rowid = d.id
      JOIN versions v ON dv.version_id = v.id
      JOIN libraries l ON v.library_id = l.id
      WHERE dv.embedding MATCH ?
      AND l.name = ?
      AND v.name = ?
      AND k = 3
      ORDER BY dv.distance ASC
    `;

    interface VectorSearchResult {
      rowid: number;
      content: string;
      distance: number;
    }

    const searchResults = db
      .prepare(vectorSearchQuery)
      .all(JSON.stringify(searchVector), "test-lib", "1.0.0") as VectorSearchResult[];

    // Should return 3 results ordered by similarity
    expect(searchResults).toHaveLength(3);

    // Results should be ordered by distance (most similar first)
    expect(searchResults[0].distance).toBeLessThan(searchResults[1].distance);
    expect(searchResults[1].distance).toBeLessThan(searchResults[2].distance);

    // AI-related documents should be more similar (lower distance) than cooking document
    const aiResults = searchResults.filter(
      (r) =>
        r.content.includes("machine learning") || r.content.includes("neural networks"),
    );
    const cookingResults = searchResults.filter(
      (r) => r.content.includes("cooking") || r.content.includes("recipes"),
    );

    expect(aiResults).toHaveLength(2);
    expect(cookingResults).toHaveLength(1);

    // AI documents should have lower distances than cooking document
    const maxAiDistance = Math.max(...aiResults.map((r) => r.distance));
    const cookingDistance = cookingResults[0].distance;
    expect(maxAiDistance).toBeLessThan(cookingDistance);

    // Validate actual distance behavior: sqlite-vec uses Euclidean distance (L2 norm)
    // - Distance 0 = identical vectors (closest match)
    // - Higher distances = less similar vectors (farther match)
    // - No upper bound (unlike cosine similarity which ranges 0-1)
    // NOTE: This is OPPOSITE to cosine similarity where 1=closest, 0=farthest
    for (const result of searchResults) {
      expect(result.distance).toBeGreaterThanOrEqual(0); // Distances are non-negative
      expect(result.distance).toBeLessThan(50); // Should be reasonable for our test vectors (relaxed bound)
    }

    // Test identical vector search should return distance ≈ 0
    const identicalSearchResults = db
      .prepare(vectorSearchQuery)
      .all(JSON.stringify(aiVector1), "test-lib", "1.0.0") as VectorSearchResult[];

    expect(identicalSearchResults).toHaveLength(3);

    // Find the result that matches our exact vector (should be doc1)
    const exactMatch = identicalSearchResults.find((r) =>
      r.content.includes("machine learning"),
    );
    expect(exactMatch).toBeDefined();
    expect(exactMatch!.distance).toBeCloseTo(0, 6); // Very close to 0 for identical vectors

    // Demonstrate distance semantics: lower distance = higher similarity
    const allDistances = searchResults.map((r) => r.distance).sort((a, b) => a - b);
    expect(allDistances[0]).toBeLessThan(allDistances[1]); // Best match has lowest distance
    expect(allDistances[1]).toBeLessThan(allDistances[2]); // Worst match has highest distance
  });

  it("should perform FTS search and return relevant text matches correctly", () => {
    // Apply all migrations (documents_vec dropped by 012; create it so triggers from 011 can run on document insert)
    expect(() => applyMigrations(db)).not.toThrow();
    createVectorTableForTest(db, 1536);

    // Insert test library and version
    db.prepare("INSERT INTO libraries (name) VALUES (?)").run("docs-lib");
    const libraryResult = db
      .prepare("SELECT id FROM libraries WHERE name = ?")
      .get("docs-lib") as { id: number } | undefined;
    expect(libraryResult).toBeDefined();
    const libraryId = libraryResult!.id;

    db.prepare("INSERT INTO versions (library_id, name) VALUES (?, ?)").run(
      libraryId,
      "1.0.0",
    );
    const versionResult = db
      .prepare("SELECT id FROM versions WHERE library_id = ? AND name = ?")
      .get(libraryId, "1.0.0") as { id: number } | undefined;
    expect(versionResult).toBeDefined();
    const versionId = versionResult!.id;

    // Insert test pages first
    const insertPage = db.prepare(`
      INSERT INTO pages (version_id, url, title, etag, last_modified, content_type)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const reactPageId = insertPage.run(
      versionId,
      "https://example.com/react-hooks",
      "React Hooks Guide",
      null,
      null,
      "text/html",
    ).lastInsertRowid as number;

    const vuePageId = insertPage.run(
      versionId,
      "https://example.com/vue-composition",
      "Vue Composition API",
      null,
      null,
      "text/html",
    ).lastInsertRowid as number;

    const angularPageId = insertPage.run(
      versionId,
      "https://example.com/angular-services",
      "Angular Services",
      null,
      null,
      "text/html",
    ).lastInsertRowid as number;

    const dbPageId = insertPage.run(
      versionId,
      "https://example.com/database-design",
      "Database Design",
      null,
      null,
      "text/html",
    ).lastInsertRowid as number;

    // Insert test documents with diverse content
    const insertDoc = db.prepare(`
      INSERT INTO documents (page_id, content, metadata, sort_order)
      VALUES (?, ?, ?, ?)
    `);

    insertDoc.run(
      reactPageId,
      "React hooks are a powerful feature that allows you to use state and lifecycle methods in functional components. The useState hook manages component state.",
      JSON.stringify({
        title: "React Hooks Guide",
        path: "/react/hooks",
      }),
      1,
    );

    insertDoc.run(
      vuePageId,
      "Vue composition API provides a way to organize component logic. It offers reactive state management and computed properties for building dynamic applications.",
      JSON.stringify({
        title: "Vue Composition API",
        path: "/vue/composition",
      }),
      2,
    );

    insertDoc.run(
      angularPageId,
      "Angular services are singleton objects that provide functionality across the application. Dependency injection makes services available to components.",
      JSON.stringify({
        title: "Angular Services",
        path: "/angular/services",
      }),
      3,
    );

    insertDoc.run(
      dbPageId,
      "Database normalization reduces redundancy and improves data integrity. Primary keys uniquely identify records in relational databases.",
      JSON.stringify({
        title: "Database Design",
        path: "/database/design",
      }),
      4,
    );

    // Test 1: Search for React-specific content
    interface FTSSearchResult {
      id: number;
      content: string;
      title: string;
      url: string;
      path: string;
      rank: number;
    }

    const reactSearchQuery = `
      SELECT 
        d.id,
        d.content,
        json_extract(d.metadata, '$.title') as title,
        p.url,
        json_extract(d.metadata, '$.path') as path,
        fts.rank
      FROM documents_fts fts
      JOIN documents d ON fts.rowid = d.id
      JOIN pages p ON d.page_id = p.id
      JOIN versions v ON p.version_id = v.id
      JOIN libraries l ON v.library_id = l.id
      WHERE documents_fts MATCH ?
      AND l.name = ?
      AND v.name = ?
      ORDER BY fts.rank
    `;

    const reactResults = db
      .prepare(reactSearchQuery)
      .all("react hooks", "docs-lib", "1.0.0") as FTSSearchResult[];

    expect(reactResults).toHaveLength(1);
    expect(reactResults[0].content).toContain("React hooks");
    expect(reactResults[0].title).toBe("React Hooks Guide");

    // Test 2: Search for state management across frameworks
    const stateResults = db
      .prepare(reactSearchQuery)
      .all("state", "docs-lib", "1.0.0") as FTSSearchResult[];

    expect(stateResults.length).toBeGreaterThanOrEqual(2);

    // Should find both React (useState) and Vue (reactive state) content
    const contentTexts = stateResults.map((r) => r.content);
    const hasReactState = contentTexts.some((content) => content.includes("useState"));
    const hasVueState = contentTexts.some((content) =>
      content.includes("reactive state"),
    );

    expect(hasReactState || hasVueState).toBe(true);

    // Test 3: Search with phrase matching
    const phraseResults = db
      .prepare(reactSearchQuery)
      .all('"dependency injection"', "docs-lib", "1.0.0") as FTSSearchResult[];

    expect(phraseResults).toHaveLength(1);
    expect(phraseResults[0].content).toContain("Dependency injection");
    expect(phraseResults[0].title).toBe("Angular Services");

    // Test 4: Search in metadata fields (title and path)
    const titleSearchQuery = `
      SELECT 
        d.id,
        d.content,
        json_extract(d.metadata, '$.title') as title,
        p.url,
        json_extract(d.metadata, '$.path') as path,
        fts.rank
      FROM documents_fts fts
      JOIN documents d ON fts.rowid = d.id
      JOIN pages p ON d.page_id = p.id
      JOIN versions v ON p.version_id = v.id
      JOIN libraries l ON v.library_id = l.id
      WHERE fts.title MATCH ?
      AND l.name = ?
      AND v.name = ?
      ORDER BY fts.rank
    `;

    const titleResults = db
      .prepare(titleSearchQuery)
      .all("Database", "docs-lib", "1.0.0") as FTSSearchResult[];

    expect(titleResults).toHaveLength(1);
    expect(titleResults[0].title).toBe("Database Design");

    // Test 5: Test empty search results
    const emptyResults = db
      .prepare(reactSearchQuery)
      .all("nonexistent term", "docs-lib", "1.0.0") as FTSSearchResult[];

    expect(emptyResults).toHaveLength(0);

    // Test 6: Test ranking (more relevant results should have better rank)
    const multiResults = db
      .prepare(reactSearchQuery)
      .all("component", "docs-lib", "1.0.0") as FTSSearchResult[];

    if (multiResults.length > 1) {
      // Results should be ordered by relevance (rank)
      for (let i = 1; i < multiResults.length; i++) {
        expect(multiResults[i].rank).toBeGreaterThanOrEqual(multiResults[i - 1].rank);
      }
    }

    // Test 7: Validate FTS scoring behavior - BM25 rank semantics
    // Get BM25 scores using the same query pattern as DocumentStore
    const bm25SearchQuery = `
      SELECT 
        d.id,
        d.content,
        json_extract(d.metadata, '$.title') as title,
        bm25(documents_fts, 10.0, 1.0, 5.0, 1.0) as bm25_score
      FROM documents_fts fts
      JOIN documents d ON fts.rowid = d.id
      JOIN pages p ON d.page_id = p.id
      JOIN versions v ON p.version_id = v.id
      JOIN libraries l ON v.library_id = l.id
      WHERE documents_fts MATCH ?
      AND l.name = ?
      AND v.name = ?
      ORDER BY bm25_score ASC
    `;

    const bm25Results = db
      .prepare(bm25SearchQuery)
      .all("state", "docs-lib", "1.0.0") as Array<{
      id: number;
      content: string;
      title: string;
      bm25_score: number;
    }>;

    expect(bm25Results.length).toBeGreaterThanOrEqual(2);

    // Validate BM25 score behavior: lower scores = better matches (more relevant)
    // This is OPPOSITE to similarity scores where higher = better
    // NOTE: BM25 scores is internally multiplied by -1 to ensure good matches rank higher in default sorting
    for (const result of bm25Results) {
      expect(result.bm25_score).toBeGreaterThan(-100); // BM25 can be negative but should be reasonable
      expect(result.bm25_score).toBeLessThan(100); // Should be reasonable for our test content
    }

    // Results should be ordered by BM25 score (best matches first)
    for (let i = 1; i < bm25Results.length; i++) {
      expect(bm25Results[i].bm25_score).toBeGreaterThanOrEqual(
        bm25Results[i - 1].bm25_score,
      );
    }

    // Test exact phrase match vs partial match scoring
    const exactPhraseResults = db
      .prepare(bm25SearchQuery)
      .all('"component state"', "docs-lib", "1.0.0") as Array<{
      id: number;
      bm25_score: number;
    }>;

    const partialMatchResults = db
      .prepare(bm25SearchQuery)
      .all("component", "docs-lib", "1.0.0") as Array<{ id: number; bm25_score: number }>;

    if (exactPhraseResults.length > 0 && partialMatchResults.length > 0) {
      // Exact phrase matches should have better (lower) BM25 scores than partial matches
      const bestExactScore = Math.min(...exactPhraseResults.map((r) => r.bm25_score));
      const bestPartialScore = Math.min(...partialMatchResults.map((r) => r.bm25_score));
      expect(bestExactScore).toBeLessThanOrEqual(bestPartialScore);
    }
  });
});
