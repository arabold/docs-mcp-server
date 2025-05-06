import type { Document } from "@langchain/core/documents";
import type { Embeddings } from "@langchain/core/embeddings";
import Database, { type Database as DatabaseType } from "better-sqlite3";
import semver from "semver";
import * as sqliteVec from "sqlite-vec";
import type { DocumentMetadata } from "../types";
import { EMBEDDING_BATCH_SIZE } from "../utils/config";
import { applyMigrations } from "./applyMigrations";
import { ConnectionError, DimensionError, StoreError } from "./errors";
import { VECTOR_DIMENSION } from "./types";
import {
  type DbDocument,
  type DbQueryResult,
  type LibraryVersionDetails,
  mapDbDocumentToDocument,
} from "./types";

interface RawSearchResult extends DbDocument {
  vec_score?: number;
  fts_score?: number;
}

interface RankedResult extends RawSearchResult {
  vec_rank?: number;
  fts_rank?: number;
  rrf_score: number;
}

/**
 * Manages document storage and retrieval using SQLite with vector and full-text search capabilities.
 * Provides direct access to SQLite with prepared statements to store and query document
 * embeddings along with their metadata. Supports versioned storage of documents for different
 * libraries, enabling version-specific document retrieval and searches.
 */
export class DocumentStore {
  private readonly db: DatabaseType;
  private embeddings!: Embeddings;
  private readonly dbDimension: number = VECTOR_DIMENSION;
  private modelDimension!: number;
  private statements!: {
    getById: Database.Statement;
    insertDocument: Database.Statement;
    insertEmbedding: Database.Statement;
    deleteDocuments: Database.Statement;
    queryVersions: Database.Statement;
    checkExists: Database.Statement;
    queryLibraryVersions: Database.Statement<[]>; // Updated type
    getChildChunks: Database.Statement;
    getPrecedingSiblings: Database.Statement;
    getSubsequentSiblings: Database.Statement;
    getParentChunk: Database.Statement;
    insertLibrary: Database.Statement;
    getLibraryIdByName: Database.Statement;
  };

  /**
   * Calculates Reciprocal Rank Fusion score for a result
   */
  private calculateRRF(vecRank?: number, ftsRank?: number, k = 60): number {
    let rrf = 0;
    if (vecRank !== undefined) {
      rrf += 1 / (k + vecRank);
    }
    if (ftsRank !== undefined) {
      rrf += 1 / (k + ftsRank);
    }
    return rrf;
  }

  /**
   * Assigns ranks to search results based on their scores
   */
  private assignRanks(results: RawSearchResult[]): RankedResult[] {
    // Create maps to store ranks
    const vecRanks = new Map<number, number>();
    const ftsRanks = new Map<number, number>();

    // Sort by vector scores and assign ranks
    results
      .filter((r) => r.vec_score !== undefined)
      .sort((a, b) => (a.vec_score ?? 0) - (b.vec_score ?? 0))
      .forEach((result, index) => {
        vecRanks.set(Number(result.id), index + 1);
      });

    // Sort by BM25 scores and assign ranks
    results
      .filter((r) => r.fts_score !== undefined)
      .sort((a, b) => (a.fts_score ?? 0) - (b.fts_score ?? 0))
      .forEach((result, index) => {
        ftsRanks.set(Number(result.id), index + 1);
      });

    // Combine results with ranks and calculate RRF
    return results.map((result) => ({
      ...result,
      vec_rank: vecRanks.get(Number(result.id)),
      fts_rank: ftsRanks.get(Number(result.id)),
      rrf_score: this.calculateRRF(
        vecRanks.get(Number(result.id)),
        ftsRanks.get(Number(result.id)),
      ),
    }));
  }

  constructor(dbPath: string) {
    if (!dbPath) {
      throw new StoreError("Missing required database path");
    }

    // Only establish database connection in constructor
    this.db = new Database(dbPath);
  }

  /**
   * Sets up prepared statements for database queries
   */
  private prepareStatements(): void {
    const statements = {
      getById: this.db.prepare("SELECT * FROM documents WHERE id = ?"),
      insertDocument: this.db.prepare(
        "INSERT INTO documents (library_id, version, url, content, metadata, sort_order, indexed_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ),
      insertEmbedding: this.db.prepare<[number, string]>(
        "INSERT INTO documents_vec (rowid, library, version, embedding) VALUES (?, ?, ?, ?)",
      ),
      insertLibrary: this.db.prepare(
        "INSERT INTO libraries (name) VALUES (?) ON CONFLICT(name) DO NOTHING",
      ),
      getLibraryIdByName: this.db.prepare("SELECT id FROM libraries WHERE name = ?"),
      deleteDocuments: this.db.prepare(
        `DELETE FROM documents
         WHERE library_id = (SELECT id FROM libraries WHERE name = ?)
         AND version = ?`,
      ),
      queryVersions: this.db.prepare(
        `SELECT DISTINCT d.version
         FROM documents d
         JOIN libraries l ON d.library_id = l.id
         WHERE l.name = ?
         ORDER BY d.version`,
      ),
      checkExists: this.db.prepare(
        `SELECT id FROM documents
         WHERE library_id = (SELECT id FROM libraries WHERE name = ?)
         AND version = ?
         LIMIT 1`,
      ),
      queryLibraryVersions: this.db.prepare(
        `SELECT
          library,
          version,
          COUNT(*) as documentCount,
          COUNT(DISTINCT url) as uniqueUrlCount,
          MIN(indexed_at) as indexedAt
        FROM documents
        GROUP BY library, version
        ORDER BY library, version`,
      ),
      getChildChunks: this.db.prepare(`
        SELECT d.* FROM documents d
        JOIN libraries l ON d.library_id = l.id
        WHERE l.name = ?
        AND d.version = ?
        AND d.url = ?
        AND json_array_length(json_extract(d.metadata, '$.path')) = ?
        AND json_extract(d.metadata, '$.path') LIKE ? || '%'
        AND d.sort_order > (SELECT sort_order FROM documents WHERE id = ?)
        ORDER BY d.sort_order
        LIMIT ?
      `),
      getPrecedingSiblings: this.db.prepare(`
        SELECT d.* FROM documents d
        JOIN libraries l ON d.library_id = l.id
        WHERE l.name = ?
        AND d.version = ?
        AND d.url = ?
        AND d.sort_order < (SELECT sort_order FROM documents WHERE id = ?)
        AND json_extract(d.metadata, '$.path') = ?
        ORDER BY d.sort_order DESC
        LIMIT ?
      `),
      getSubsequentSiblings: this.db.prepare(`
        SELECT d.* FROM documents d
        JOIN libraries l ON d.library_id = l.id
        WHERE l.name = ?
        AND d.version = ?
        AND d.url = ?
        AND d.sort_order > (SELECT sort_order FROM documents WHERE id = ?)
        AND json_extract(d.metadata, '$.path') = ?
        ORDER BY d.sort_order
        LIMIT ?
      `),
      getParentChunk: this.db.prepare(`
        SELECT d.* FROM documents d
        JOIN libraries l ON d.library_id = l.id
        WHERE l.name = ?
        AND d.version = ?
        AND d.url = ?
        AND json_extract(d.metadata, '$.path') = ?
        AND d.sort_order < (SELECT sort_order FROM documents WHERE id = ?)
        ORDER BY d.sort_order DESC
        LIMIT 1
      `),
    };
    this.statements = statements;
  }

  /**
   * Pads a vector to the fixed database dimension by appending zeros.
   * Throws an error if the input vector is longer than the database dimension.
   */
  private padVector(vector: number[]): number[] {
    if (vector.length > this.dbDimension) {
      throw new Error(
        `Vector dimension ${vector.length} exceeds database dimension ${this.dbDimension}`,
      );
    }
    if (vector.length === this.dbDimension) {
      return vector;
    }
    return [...vector, ...new Array(this.dbDimension - vector.length).fill(0)];
  }

  /**
   * Initializes embeddings client using environment variables for configuration.
   *
   * The embedding model is configured using DOCS_MCP_EMBEDDING_MODEL environment variable.
   * Format: "provider:model_name" (e.g., "google:text-embedding-004") or just "model_name"
   * for OpenAI (default).
   *
   * Supported providers and their required environment variables:
   * - openai: OPENAI_API_KEY (and optionally OPENAI_API_BASE, OPENAI_ORG_ID)
   * - google: GOOGLE_APPLICATION_CREDENTIALS (path to service account JSON)
   * - aws: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION (or BEDROCK_AWS_REGION)
   * - microsoft: Azure OpenAI credentials (AZURE_OPENAI_API_*)
   */
  private async initializeEmbeddings(): Promise<void> {
    const modelSpec = process.env.DOCS_MCP_EMBEDDING_MODEL || "text-embedding-3-small";

    // Import dynamically to avoid circular dependencies
    const { createEmbeddingModel } = await import("./embeddings/EmbeddingFactory");
    this.embeddings = createEmbeddingModel(modelSpec);

    // Determine the model's actual dimension by embedding a test string
    const testVector = await this.embeddings.embedQuery("test");
    this.modelDimension = testVector.length;

    if (this.modelDimension > this.dbDimension) {
      throw new DimensionError(modelSpec, this.modelDimension, this.dbDimension);
    }
  }

  /**
   * Escapes a query string for use with SQLite FTS5 MATCH operator.
   * Wraps the query in double quotes and escapes internal double quotes.
   */
  private escapeFtsQuery(query: string): string {
    // Escape internal double quotes by doubling them
    const escapedQuotes = query.replace(/"/g, '""');
    // Wrap the entire string in double quotes
    return `"${escapedQuotes}"`;
  }

  /**
   * Initializes database connection and ensures readiness
   */
  async initialize(): Promise<void> {
    try {
      // 1. Load extensions first (moved before migrations)
      sqliteVec.load(this.db);

      // 2. Apply migrations (after extensions are loaded)
      applyMigrations(this.db);

      // 3. Initialize prepared statements
      this.prepareStatements();

      // 4. Initialize embeddings client (await to catch errors)
      await this.initializeEmbeddings();
    } catch (error) {
      // Re-throw StoreError directly, wrap others in ConnectionError
      if (error instanceof StoreError) {
        throw error;
      }
      throw new ConnectionError("Failed to initialize database connection", error);
    }
  }

  /**
   * Gracefully closes database connections
   */
  async shutdown(): Promise<void> {
    this.db.close();
  }

  /**
   * Retrieves all unique versions for a specific library
   */
  async queryUniqueVersions(library: string): Promise<string[]> {
    try {
      const rows = this.statements.queryVersions.all(library.toLowerCase()) as Array<
        Pick<DbDocument, "version">
      >;
      return rows.map((row) => row.version);
    } catch (error) {
      throw new ConnectionError("Failed to query versions", error);
    }
  }

  /**
   * Verifies existence of documents for a specific library version
   */
  async checkDocumentExists(library: string, version: string): Promise<boolean> {
    try {
      const result = this.statements.checkExists.get(
        library.toLowerCase(),
        version.toLowerCase(),
      );
      return result !== undefined;
    } catch (error) {
      throw new ConnectionError("Failed to check document existence", error);
    }
  }

  /**
   * Retrieves a mapping of all libraries to their available versions with details.
   */
  async queryLibraryVersions(): Promise<Map<string, LibraryVersionDetails[]>> {
    try {
      // Define the expected row structure from the GROUP BY query
      interface LibraryVersionRow {
        library: string;
        version: string;
        documentCount: number;
        uniqueUrlCount: number;
        indexedAt: string | null; // SQLite MIN might return string or null
      }

      const rows = this.statements.queryLibraryVersions.all() as LibraryVersionRow[];
      const libraryMap = new Map<string, LibraryVersionDetails[]>();

      for (const row of rows) {
        // Process all rows, including those where version is "" (unversioned)
        const library = row.library;
        if (!libraryMap.has(library)) {
          libraryMap.set(library, []);
        }

        // Format indexedAt to ISO string if available
        const indexedAtISO = row.indexedAt ? new Date(row.indexedAt).toISOString() : null;

        libraryMap.get(library)?.push({
          version: row.version,
          documentCount: row.documentCount,
          uniqueUrlCount: row.uniqueUrlCount,
          indexedAt: indexedAtISO,
        });
      }

      // Sort versions within each library: unversioned first, then semantically
      for (const versions of libraryMap.values()) {
        versions.sort((a, b) => {
          if (a.version === "" && b.version !== "") {
            return -1; // a (unversioned) comes first
          }
          if (a.version !== "" && b.version === "") {
            return 1; // b (unversioned) comes first
          }
          if (a.version === "" && b.version === "") {
            return 0; // Should not happen with GROUP BY, but handle anyway
          }
          // Both are non-empty, use semver compare
          return semver.compare(a.version, b.version);
        });
      }

      return libraryMap;
    } catch (error) {
      throw new ConnectionError("Failed to query library versions", error);
    }
  }

  /**
   * Stores documents with library and version metadata, generating embeddings
   * for vector similarity search
   */
  async addDocuments(
    library: string,
    version: string,
    documents: Document[],
  ): Promise<void> {
    try {
      // Generate embeddings in batch
      const texts = documents.map((doc) => {
        const header = `<title>${doc.metadata.title}</title>\n<url>${doc.metadata.url}</url>\n<path>${doc.metadata.path.join(" / ")}</path>\n`;
        return `${header}${doc.pageContent}`;
      });

      // Batch embedding creation to avoid token limit errors
      const rawEmbeddings: number[][] = [];
      for (let i = 0; i < texts.length; i += EMBEDDING_BATCH_SIZE) {
        const batchTexts = texts.slice(i, i + EMBEDDING_BATCH_SIZE);
        const batchEmbeddings = await this.embeddings.embedDocuments(batchTexts);
        rawEmbeddings.push(...batchEmbeddings);
      }
      const paddedEmbeddings = rawEmbeddings.map((vector) => this.padVector(vector));

      // Insert or get library_id
      this.statements.insertLibrary.run(library.toLowerCase());
      const libraryIdRow = this.statements.getLibraryIdByName.get(
        library.toLowerCase(),
      ) as { id: number } | undefined;
      if (!libraryIdRow || typeof libraryIdRow.id !== "number") {
        throw new StoreError(`Failed to resolve library_id for library: ${library}`);
      }
      const libraryId = libraryIdRow.id;

      // Insert documents in a transaction
      const transaction = this.db.transaction((docs: typeof documents) => {
        for (let i = 0; i < docs.length; i++) {
          const doc = docs[i];
          const url = doc.metadata.url as string;
          if (!url || typeof url !== "string" || !url.trim()) {
            throw new StoreError("Document metadata must include a valid URL");
          }

          // Insert into main documents table
          const result = this.statements.insertDocument.run(
            libraryId,
            version.toLowerCase(),
            url,
            doc.pageContent,
            JSON.stringify(doc.metadata),
            i,
            new Date().toISOString(), // Pass current timestamp for indexed_at
          );
          const rowId = result.lastInsertRowid;

          // Insert into vector table (still uses library/version for now)
          this.statements.insertEmbedding.run(
            BigInt(rowId),
            library.toLowerCase(),
            version.toLowerCase(),
            JSON.stringify(paddedEmbeddings[i]),
          );
        }
      });

      transaction(documents);
    } catch (error) {
      throw new ConnectionError("Failed to add documents to store", error);
    }
  }

  /**
   * Removes documents matching specified library and version
   * @returns Number of documents deleted
   */
  async deleteDocuments(library: string, version: string): Promise<number> {
    try {
      const result = this.statements.deleteDocuments.run(
        library.toLowerCase(),
        version.toLowerCase(),
      );
      return result.changes;
    } catch (error) {
      throw new ConnectionError("Failed to delete documents", error);
    }
  }

  /**
   * Retrieves a document by its ID.
   * @param id The ID of the document.
   * @returns The document, or null if not found.
   */
  async getById(id: string): Promise<Document | null> {
    try {
      const row = this.statements.getById.get(id) as DbQueryResult<DbDocument>;
      if (!row) {
        return null;
      }

      return mapDbDocumentToDocument(row);
    } catch (error) {
      throw new ConnectionError(`Failed to get document by ID ${id}`, error);
    }
  }

  /**
   * Finds documents matching a text query using hybrid search.
   * Combines vector similarity search with full-text search using Reciprocal Rank Fusion.
   */
  async findByContent(
    library: string,
    version: string,
    query: string,
    limit: number,
  ): Promise<Document[]> {
    try {
      const rawEmbedding = await this.embeddings.embedQuery(query);
      const embedding = this.padVector(rawEmbedding);
      const ftsQuery = this.escapeFtsQuery(query); // Escape the query for FTS

      const stmt = this.db.prepare(`
        WITH vec_scores AS (
          SELECT
            dv.rowid as id,
            dv.distance as vec_score
          FROM documents_vec dv
          JOIN documents d ON dv.rowid = d.id
          JOIN libraries l ON d.library_id = l.id
          WHERE l.name = ?
            AND d.version = ?
            AND dv.embedding MATCH ?
            AND dv.k = ?
          ORDER BY dv.distance
        ),
        fts_scores AS (
          SELECT
            f.rowid as id,
            bm25(documents_fts, 10.0, 1.0, 5.0, 1.0) as fts_score
          FROM documents_fts f
          JOIN documents d ON f.rowid = d.rowid
          JOIN libraries l ON d.library_id = l.id
          WHERE l.name = ?
            AND d.version = ?
            AND documents_fts MATCH ?
          ORDER BY fts_score
          LIMIT ?
        )
        SELECT
          d.id,
          d.content,
          d.metadata,
          COALESCE(1 / (1 + v.vec_score), 0) as vec_score,
          COALESCE(1 / (1 + f.fts_score), 0) as fts_score
        FROM documents d
        LEFT JOIN vec_scores v ON d.id = v.id
        LEFT JOIN fts_scores f ON d.id = f.id
        WHERE v.id IS NOT NULL OR f.id IS NOT NULL
      `);

      const rawResults = stmt.all(
        library.toLowerCase(),
        version.toLowerCase(),
        JSON.stringify(embedding),
        limit,
        library.toLowerCase(),
        version.toLowerCase(),
        ftsQuery, // Use the escaped query
        limit,
      ) as RawSearchResult[];

      // Apply RRF ranking
      const rankedResults = this.assignRanks(rawResults);

      // Sort by RRF score and take top results
      const topResults = rankedResults
        .sort((a, b) => b.rrf_score - a.rrf_score)
        .slice(0, limit);

      return topResults.map((row) => ({
        ...mapDbDocumentToDocument(row),
        metadata: {
          ...JSON.parse(row.metadata),
          score: row.rrf_score,
          vec_rank: row.vec_rank,
          fts_rank: row.fts_rank,
        },
      }));
    } catch (error) {
      throw new ConnectionError(
        `Failed to find documents by content with query "${query}"`,
        error,
      );
    }
  }

  /**
   * Finds child chunks of a given document based on path hierarchy.
   */
  async findChildChunks(
    library: string,
    version: string,
    id: string,
    limit: number,
  ): Promise<Document[]> {
    try {
      const parent = await this.getById(id);
      if (!parent) {
        return [];
      }

      const parentPath = (parent.metadata as DocumentMetadata).path ?? [];
      const parentUrl = (parent.metadata as DocumentMetadata).url;

      const result = this.statements.getChildChunks.all(
        library.toLowerCase(),
        version.toLowerCase(),
        parentUrl,
        parentPath.length + 1,
        JSON.stringify(parentPath),
        id,
        limit,
      ) as Array<DbDocument>;

      return result.map((row) => mapDbDocumentToDocument(row));
    } catch (error) {
      throw new ConnectionError(`Failed to find child chunks for ID ${id}`, error);
    }
  }

  /**
   * Finds preceding sibling chunks of a given document.
   */
  async findPrecedingSiblingChunks(
    library: string,
    version: string,
    id: string,
    limit: number,
  ): Promise<Document[]> {
    try {
      const reference = await this.getById(id);
      if (!reference) {
        return [];
      }

      const refMetadata = reference.metadata as DocumentMetadata;

      const result = this.statements.getPrecedingSiblings.all(
        library.toLowerCase(),
        version.toLowerCase(),
        refMetadata.url,
        id,
        JSON.stringify(refMetadata.path),
        limit,
      ) as Array<DbDocument>;

      return result.reverse().map((row) => mapDbDocumentToDocument(row));
    } catch (error) {
      throw new ConnectionError(
        `Failed to find preceding sibling chunks for ID ${id}`,
        error,
      );
    }
  }

  /**
   * Finds subsequent sibling chunks of a given document.
   */
  async findSubsequentSiblingChunks(
    library: string,
    version: string,
    id: string,
    limit: number,
  ): Promise<Document[]> {
    try {
      const reference = await this.getById(id);
      if (!reference) {
        return [];
      }

      const refMetadata = reference.metadata;

      const result = this.statements.getSubsequentSiblings.all(
        library.toLowerCase(),
        version.toLowerCase(),
        refMetadata.url,
        id,
        JSON.stringify(refMetadata.path),
        limit,
      ) as Array<DbDocument>;

      return result.map((row) => mapDbDocumentToDocument(row));
    } catch (error) {
      throw new ConnectionError(
        `Failed to find subsequent sibling chunks for ID ${id}`,
        error,
      );
    }
  }

  /**
   * Finds the parent chunk of a given document.
   */
  async findParentChunk(
    library: string,
    version: string,
    id: string,
  ): Promise<Document | null> {
    try {
      const child = await this.getById(id);
      if (!child) {
        return null;
      }

      const childMetadata = child.metadata as DocumentMetadata;
      const path = childMetadata.path ?? [];
      const parentPath = path.slice(0, -1);

      if (parentPath.length === 0) {
        return null;
      }

      const result = this.statements.getParentChunk.get(
        library.toLowerCase(),
        version.toLowerCase(),
        childMetadata.url,
        JSON.stringify(parentPath),
        id,
      ) as DbQueryResult<DbDocument>;

      if (!result) {
        return null;
      }

      return mapDbDocumentToDocument(result);
    } catch (error) {
      throw new ConnectionError(`Failed to find parent chunk for ID ${id}`, error);
    }
  }

  /**
   * Fetches multiple documents by their IDs in a single call.
   * Returns an array of Document objects, sorted by their sort_order.
   */
  async findChunksByIds(
    library: string,
    version: string,
    ids: string[],
  ): Promise<Document[]> {
    if (!ids.length) return [];
    try {
      // Use parameterized query for variable number of IDs
      const placeholders = ids.map(() => "?").join(",");
      const stmt = this.db.prepare(
        `SELECT d.* FROM documents d
         JOIN libraries l ON d.library_id = l.id
         WHERE l.name = ? AND d.version = ? AND d.id IN (${placeholders}) ORDER BY d.sort_order`,
      );
      const rows = stmt.all(
        library.toLowerCase(),
        version.toLowerCase(),
        ...ids,
      ) as DbDocument[];
      return rows.map((row) => mapDbDocumentToDocument(row));
    } catch (error) {
      throw new ConnectionError("Failed to fetch documents by IDs", error);
    }
  }
}
