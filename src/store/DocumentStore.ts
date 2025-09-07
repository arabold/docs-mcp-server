import type { Document } from "@langchain/core/documents";
import type { Embeddings } from "@langchain/core/embeddings";
import Database, { type Database as DatabaseType } from "better-sqlite3";
import semver from "semver";
import * as sqliteVec from "sqlite-vec";
import type { ScraperOptions } from "../scraper/types";
import type { DocumentMetadata } from "../types";
import { EMBEDDING_BATCH_CHARS, EMBEDDING_BATCH_SIZE } from "../utils/config";
import { logger } from "../utils/logger";
import { applyMigrations } from "./applyMigrations";
import { EmbeddingConfig, type EmbeddingModelConfig } from "./embeddings/EmbeddingConfig";
import {
  createEmbeddingModel,
  ModelConfigurationError,
  UnsupportedProviderError,
} from "./embeddings/EmbeddingFactory";
import { ConnectionError, DimensionError, StoreError } from "./errors";
import { parseQuery } from "./FtsQueryParser";
import type { StoredScraperOptions } from "./types";
import {
  type DbDocument,
  type DbQueryResult,
  type DbVersion,
  type DbVersionWithLibrary,
  denormalizeVersionName,
  mapDbDocumentToDocument,
  normalizeVersionName,
  VECTOR_DIMENSION,
  type VersionScraperOptions,
  type VersionStatus,
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
  private readonly embeddingConfig?: EmbeddingModelConfig | null;
  private statements!: {
    getById: Database.Statement<[bigint]>;
    insertDocument: Database.Statement<
      [bigint, bigint, string, string, string, number, string]
    >;
    insertEmbedding: Database.Statement<[bigint, bigint, bigint, string]>;
    deleteDocuments: Database.Statement<[string, string, string]>;
    deleteDocumentsByUrl: Database.Statement<[string, string, string, string]>;
    queryVersions: Database.Statement<[string]>;
    checkExists: Database.Statement<[string, string]>;
    queryLibraryVersions: Database.Statement<[]>;
    getChildChunks: Database.Statement<
      [string, string, string, number, string, bigint, number]
    >;
    getPrecedingSiblings: Database.Statement<
      [string, string, string, bigint, string, number]
    >;
    getSubsequentSiblings: Database.Statement<
      [string, string, string, bigint, string, number]
    >;
    getParentChunk: Database.Statement<[string, string, string, string, bigint]>;
    insertLibrary: Database.Statement<[string]>;
    getLibraryIdByName: Database.Statement<[string]>;
    // New version-related statements
    insertVersion: Database.Statement<[number, string | null]>;
    resolveVersionId: Database.Statement<[number, string | null]>;
    getVersionById: Database.Statement<[number]>;
    queryVersionsByLibraryId: Database.Statement<[number]>;
    // Status tracking statements
    updateVersionStatus: Database.Statement<[string, string | null, number]>;
    updateVersionProgress: Database.Statement<[number, number, number]>;
    getVersionsByStatus: Database.Statement<string[]>;
    // Scraper options statements
    updateVersionScraperOptions: Database.Statement<[string, string, number]>;
    getVersionWithOptions: Database.Statement<[number]>;
    getVersionsBySourceUrl: Database.Statement<[string]>;
    // Version and library deletion statements
    deleteVersionById: Database.Statement<[number]>;
    deleteLibraryById: Database.Statement<[number]>;
    countVersionsByLibraryId: Database.Statement<[number]>;
    getVersionId: Database.Statement<[string, string]>;
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
      .sort((a, b) => (b.vec_score ?? 0) - (a.vec_score ?? 0))
      .forEach((result, index) => {
        vecRanks.set(Number(result.id), index + 1);
      });

    // Sort by BM25 scores and assign ranks
    results
      .filter((r) => r.fts_score !== undefined)
      .sort((a, b) => (b.fts_score ?? 0) - (a.fts_score ?? 0))
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

  constructor(dbPath: string, embeddingConfig?: EmbeddingModelConfig | null) {
    if (!dbPath) {
      throw new StoreError("Missing required database path");
    }

    // Only establish database connection in constructor
    this.db = new Database(dbPath);

    // Store embedding config for later initialization
    this.embeddingConfig = embeddingConfig;
  }

  /**
   * Sets up prepared statements for database queries
   */
  private prepareStatements(): void {
    const statements = {
      getById: this.db.prepare<[bigint]>("SELECT * FROM documents WHERE id = ?"),
      insertDocument: this.db.prepare<
        [bigint, bigint, string, string, string, number, string]
      >(
        "INSERT INTO documents (library_id, version_id, url, content, metadata, sort_order, indexed_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ),
      insertEmbedding: this.db.prepare<[bigint, bigint, bigint, string]>(
        "INSERT INTO documents_vec (rowid, library_id, version_id, embedding) VALUES (?, ?, ?, ?)",
      ),
      insertLibrary: this.db.prepare<[string]>(
        "INSERT INTO libraries (name) VALUES (?) ON CONFLICT(name) DO NOTHING",
      ),
      getLibraryIdByName: this.db.prepare<[string]>(
        "SELECT id FROM libraries WHERE name = ?",
      ),
      // New version-related statements
      insertVersion: this.db.prepare<[number, string | null]>(
        "INSERT INTO versions (library_id, name, status) VALUES (?, ?, 'not_indexed') ON CONFLICT(library_id, name) DO NOTHING",
      ),
      resolveVersionId: this.db.prepare<[number, string | null]>(
        "SELECT id FROM versions WHERE library_id = ? AND name IS ?",
      ),
      getVersionById: this.db.prepare<[number]>("SELECT * FROM versions WHERE id = ?"),
      queryVersionsByLibraryId: this.db.prepare<[number]>(
        "SELECT * FROM versions WHERE library_id = ? ORDER BY name",
      ),
      deleteLibraryDocuments: this.db.prepare<[string, string, string]>(
        `DELETE FROM documents
         WHERE library_id = (SELECT id FROM libraries WHERE name = ?)
         AND version_id = (
           SELECT v.id FROM versions v 
           WHERE v.library_id = (SELECT id FROM libraries WHERE name = ?)
           AND COALESCE(v.name, '') = COALESCE(?, '')
         )`,
      ),
      deleteDocuments: this.db.prepare<[string, string, string]>(
        `DELETE FROM documents
         WHERE library_id = (SELECT id FROM libraries WHERE name = ?)
         AND version_id = (
           SELECT v.id FROM versions v 
           WHERE v.library_id = (SELECT id FROM libraries WHERE name = ?)
           AND COALESCE(v.name, '') = COALESCE(?, '')
         )`,
      ),
      deleteDocumentsByUrl: this.db.prepare<[string, string, string, string]>(
        `DELETE FROM documents
         WHERE url = ?
         AND library_id = (SELECT id FROM libraries WHERE name = ?)
         AND version_id = (
           SELECT v.id FROM versions v 
           WHERE v.library_id = (SELECT id FROM libraries WHERE name = ?)
           AND COALESCE(v.name, '') = COALESCE(?, '')
         )`,
      ),
      getDocumentBySort: this.db.prepare<[string, string]>(
        `SELECT d.id
         FROM documents d
         JOIN versions v ON d.version_id = v.id
         JOIN libraries l ON v.library_id = l.id
         WHERE l.name = ?
         AND COALESCE(v.name, '') = COALESCE(?, '')
         LIMIT 1`,
      ),
      queryVersions: this.db.prepare<[string]>(
        `SELECT DISTINCT v.name
         FROM versions v
         JOIN libraries l ON v.library_id = l.id
         WHERE l.name = ?
         ORDER BY v.name`,
      ),
      checkExists: this.db.prepare<[string, string]>(
        `SELECT d.id FROM documents d
         JOIN versions v ON d.version_id = v.id
         JOIN libraries l ON v.library_id = l.id
         WHERE l.name = ?
         AND COALESCE(v.name, '') = COALESCE(?, '')
         LIMIT 1`,
      ),
      // Library/version aggregation including versions without documents and status/progress fields
      queryLibraryVersions: this.db.prepare<[]>(
        `SELECT
          l.name as library,
          COALESCE(v.name, '') as version,
          v.id as versionId,
          v.status as status,
          v.progress_pages as progressPages,
          v.progress_max_pages as progressMaxPages,
          v.source_url as sourceUrl,
          MIN(d.indexed_at) as indexedAt,
          COUNT(d.id) as documentCount,
          COUNT(DISTINCT d.url) as uniqueUrlCount
        FROM versions v
        JOIN libraries l ON v.library_id = l.id
        LEFT JOIN documents d ON d.version_id = v.id
        GROUP BY v.id
        ORDER BY l.name, version`,
      ),
      getChildChunks: this.db.prepare<
        [string, string, string, number, string, bigint, number]
      >(`
        SELECT d.* FROM documents d
        JOIN versions v ON d.version_id = v.id
        JOIN libraries l ON v.library_id = l.id
        WHERE l.name = ?
        AND COALESCE(v.name, '') = COALESCE(?, '')
        AND d.url = ?
        AND json_array_length(json_extract(d.metadata, '$.path')) = ?
        AND json_extract(d.metadata, '$.path') LIKE ? || '%'
        AND d.sort_order > (SELECT sort_order FROM documents WHERE id = ?)
        ORDER BY d.sort_order
        LIMIT ?
      `),
      getPrecedingSiblings: this.db.prepare<
        [string, string, string, bigint, string, number]
      >(`
        SELECT d.* FROM documents d
        JOIN versions v ON d.version_id = v.id
        JOIN libraries l ON v.library_id = l.id
        WHERE l.name = ?
        AND COALESCE(v.name, '') = COALESCE(?, '')
        AND d.url = ?
        AND d.sort_order < (SELECT sort_order FROM documents WHERE id = ?)
        AND json_extract(d.metadata, '$.path') = ?
        ORDER BY d.sort_order DESC
        LIMIT ?
      `),
      getSubsequentSiblings: this.db.prepare<
        [string, string, string, bigint, string, number]
      >(`
        SELECT d.* FROM documents d
        JOIN versions v ON d.version_id = v.id
        JOIN libraries l ON v.library_id = l.id
        WHERE l.name = ?
        AND COALESCE(v.name, '') = COALESCE(?, '')
        AND d.url = ?
        AND d.sort_order > (SELECT sort_order FROM documents WHERE id = ?)
        AND json_extract(d.metadata, '$.path') = ?
        ORDER BY d.sort_order
        LIMIT ?
      `),
      getParentChunk: this.db.prepare<[string, string, string, string, bigint]>(`
        SELECT d.* FROM documents d
        JOIN versions v ON d.version_id = v.id
        JOIN libraries l ON v.library_id = l.id
        WHERE l.name = ?
        AND COALESCE(v.name, '') = COALESCE(?, '')
        AND d.url = ?
        AND json_extract(d.metadata, '$.path') = ?
        AND d.sort_order < (SELECT sort_order FROM documents WHERE id = ?)
        ORDER BY d.sort_order DESC
        LIMIT 1
      `),
      // Status tracking statements
      updateVersionStatus: this.db.prepare<[string, string | null, number]>(
        "UPDATE versions SET status = ?, error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      ),
      updateVersionProgress: this.db.prepare<[number, number, number]>(
        "UPDATE versions SET progress_pages = ?, progress_max_pages = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      ),
      getVersionsByStatus: this.db.prepare<[string]>(
        "SELECT v.*, l.name as library_name FROM versions v JOIN libraries l ON v.library_id = l.id WHERE v.status IN (SELECT value FROM json_each(?))",
      ),
      // Scraper options statements
      updateVersionScraperOptions: this.db.prepare<[string, string, number]>(
        "UPDATE versions SET source_url = ?, scraper_options = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      ),
      getVersionWithOptions: this.db.prepare<[number]>(
        "SELECT * FROM versions WHERE id = ?",
      ),
      getVersionsBySourceUrl: this.db.prepare<[string]>(
        "SELECT v.*, l.name as library_name FROM versions v JOIN libraries l ON v.library_id = l.id WHERE v.source_url = ? ORDER BY v.created_at DESC",
      ),
      // Version and library deletion statements
      deleteVersionById: this.db.prepare<[number]>("DELETE FROM versions WHERE id = ?"),
      deleteLibraryById: this.db.prepare<[number]>("DELETE FROM libraries WHERE id = ?"),
      countVersionsByLibraryId: this.db.prepare<[number]>(
        "SELECT COUNT(*) as count FROM versions WHERE library_id = ?",
      ),
      getVersionId: this.db.prepare<[string, string]>(
        `SELECT v.id, v.library_id FROM versions v
         JOIN libraries l ON v.library_id = l.id
         WHERE l.name = ? AND COALESCE(v.name, '') = COALESCE(?, '')`,
      ),
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
   * Initialize the embeddings client using either provided config or environment variables.
   * If no embedding config is provided (null), embeddings will not be initialized.
   * This allows DocumentStore to be used without embeddings for operations that don't need them.
   *
   * Environment variables per provider:
   * - openai: OPENAI_API_KEY (and optionally OPENAI_API_BASE, OPENAI_ORG_ID)
   * - vertex: GOOGLE_APPLICATION_CREDENTIALS (path to service account JSON)
   * - gemini: GOOGLE_API_KEY
   * - aws: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION
   * - microsoft: Azure OpenAI credentials (AZURE_OPENAI_API_*)
   */
  private async initializeEmbeddings(): Promise<void> {
    // If embedding config is explicitly null, skip embedding initialization
    if (this.embeddingConfig === null) {
      logger.debug("Embedding initialization skipped (explicitly disabled)");
      return;
    }

    // Use provided config or fall back to parsing environment
    const config = this.embeddingConfig || EmbeddingConfig.parseEmbeddingConfig();

    // Create embedding model
    try {
      this.embeddings = createEmbeddingModel(config.modelSpec);

      // Use known dimensions if available, otherwise detect via test query
      if (config.dimensions !== null) {
        this.modelDimension = config.dimensions;
      } else {
        // Fallback: determine the model's actual dimension by embedding a test string
        const testVector = await this.embeddings.embedQuery("test");
        this.modelDimension = testVector.length;

        // Cache the discovered dimensions for future use
        EmbeddingConfig.setKnownModelDimensions(config.model, this.modelDimension);
      }

      if (this.modelDimension > this.dbDimension) {
        throw new DimensionError(config.modelSpec, this.modelDimension, this.dbDimension);
      }

      logger.debug(
        `Embeddings initialized: ${config.provider}:${config.model} (${this.modelDimension}d)`,
      );
    } catch (error) {
      // Handle model-related errors with helpful messages
      if (error instanceof Error) {
        if (
          error.message.includes("does not exist") ||
          error.message.includes("MODEL_NOT_FOUND")
        ) {
          throw new ModelConfigurationError(
            `❌ Invalid embedding model: ${config.model}\n` +
              `   The model "${config.model}" is not available or you don't have access to it.\n` +
              "   See README.md for supported models or run with --help for more details.",
          );
        }
        if (
          error.message.includes("API key") ||
          error.message.includes("401") ||
          error.message.includes("authentication")
        ) {
          throw new ModelConfigurationError(
            `❌ Authentication failed for ${config.provider} embedding provider\n` +
              "   Please check your API key configuration.\n" +
              "   See README.md for configuration options or run with --help for more details.",
          );
        }
      }
      // Re-throw other embedding errors (like DimensionError) as-is
      throw error;
    }
  }

  /**
   * Securely normalizes a user query string for use with SQLite FTS5 MATCH operator.
   *
   * Uses a secure parser that:
   * - Prevents FTS injection attacks by properly quoting dangerous terms
   * - Validates and preserves legitimate FTS operators (AND/OR/NOT/NEAR) when used correctly
   * - Handles edge cases (empty queries, unicode, malformed syntax) gracefully
   * - Defaults to OR behavior for multi-word queries unless explicit operators are used
   */
  private escapeFtsQuery(query: string): string {
    const normalized = parseQuery(query);

    // Handle empty queries by returning empty string - caller should handle appropriately
    if (normalized.length === 0) {
      return "";
    }

    return normalized;
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
      // Re-throw StoreError, ModelConfigurationError, and UnsupportedProviderError directly
      if (
        error instanceof StoreError ||
        error instanceof ModelConfigurationError ||
        error instanceof UnsupportedProviderError
      ) {
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
   * Resolves a library name and version string to library_id and version_id.
   * Creates library and version records if they don't exist.
   */
  async resolveLibraryAndVersionIds(
    library: string,
    version: string,
  ): Promise<{ libraryId: number; versionId: number }> {
    const normalizedLibrary = library.toLowerCase();
    const normalizedVersion = denormalizeVersionName(version.toLowerCase());

    // Insert or get library_id
    this.statements.insertLibrary.run(normalizedLibrary);
    const libraryIdRow = this.statements.getLibraryIdByName.get(normalizedLibrary) as
      | { id: number }
      | undefined;
    if (!libraryIdRow || typeof libraryIdRow.id !== "number") {
      throw new StoreError(`Failed to resolve library_id for library: ${library}`);
    }
    const libraryId = libraryIdRow.id;

    // Insert or get version_id
    // Reuse existing unversioned entry if present; storing '' ensures UNIQUE constraint applies
    this.statements.insertVersion.run(libraryId, normalizedVersion);
    const versionIdRow = this.statements.resolveVersionId.get(
      libraryId,
      normalizedVersion === null ? "" : normalizedVersion,
    ) as { id: number } | undefined;
    if (!versionIdRow || typeof versionIdRow.id !== "number") {
      throw new StoreError(
        `Failed to resolve version_id for library: ${library}, version: ${version}`,
      );
    }

    return { libraryId, versionId: versionIdRow.id };
  }

  /**
   * Retrieves all unique versions for a specific library
   */
  async queryUniqueVersions(library: string): Promise<string[]> {
    try {
      const rows = this.statements.queryVersions.all(library.toLowerCase()) as Array<{
        name: string | null;
      }>;
      return rows.map((row) => normalizeVersionName(row.name));
    } catch (error) {
      throw new ConnectionError("Failed to query versions", error);
    }
  }

  /**
   * Updates the status of a version record in the database.
   * @param versionId The version ID to update
   * @param status The new status to set
   * @param errorMessage Optional error message for failed statuses
   */
  async updateVersionStatus(
    versionId: number,
    status: VersionStatus,
    errorMessage?: string,
  ): Promise<void> {
    try {
      this.statements.updateVersionStatus.run(status, errorMessage ?? null, versionId);
    } catch (error) {
      throw new StoreError(`Failed to update version status: ${error}`);
    }
  }

  /**
   * Updates the progress counters for a version being indexed.
   * @param versionId The version ID to update
   * @param pages Current number of pages processed
   * @param maxPages Total number of pages to process
   */
  async updateVersionProgress(
    versionId: number,
    pages: number,
    maxPages: number,
  ): Promise<void> {
    try {
      this.statements.updateVersionProgress.run(pages, maxPages, versionId);
    } catch (error) {
      throw new StoreError(`Failed to update version progress: ${error}`);
    }
  }

  /**
   * Retrieves versions by their status.
   * @param statuses Array of statuses to filter by
   * @returns Array of version records matching the statuses
   */
  async getVersionsByStatus(statuses: VersionStatus[]): Promise<DbVersionWithLibrary[]> {
    try {
      const statusJson = JSON.stringify(statuses);
      const rows = this.statements.getVersionsByStatus.all(
        statusJson,
      ) as DbVersionWithLibrary[];
      return rows;
    } catch (error) {
      throw new StoreError(`Failed to get versions by status: ${error}`);
    }
  }

  /**
   * Stores scraper options for a version to enable reproducible indexing.
   * @param versionId The version ID to update
   * @param options Complete scraper options used for indexing
   */
  async storeScraperOptions(versionId: number, options: ScraperOptions): Promise<void> {
    try {
      // biome-ignore lint/correctness/noUnusedVariables: Extract source URL and exclude runtime-only fields using destructuring
      const { url: source_url, library, version, signal, ...scraper_options } = options;

      const optionsJson = JSON.stringify(scraper_options);
      this.statements.updateVersionScraperOptions.run(source_url, optionsJson, versionId);
    } catch (error) {
      throw new StoreError(`Failed to store scraper options: ${error}`);
    }
  }

  /**
   * Retrieves stored scraping configuration (source URL and options) for a version.
   * Returns null when no source URL is recorded (not re-indexable).
   */
  async getScraperOptions(versionId: number): Promise<StoredScraperOptions | null> {
    try {
      const row = this.statements.getVersionWithOptions.get(versionId) as
        | DbVersion
        | undefined;

      if (!row?.source_url) {
        return null;
      }

      let parsed: VersionScraperOptions = {} as VersionScraperOptions;
      if (row.scraper_options) {
        try {
          parsed = JSON.parse(row.scraper_options) as VersionScraperOptions;
        } catch (e) {
          logger.warn(`⚠️ Invalid scraper_options JSON for version ${versionId}: ${e}`);
          parsed = {} as VersionScraperOptions;
        }
      }

      return { sourceUrl: row.source_url, options: parsed };
    } catch (error) {
      throw new StoreError(`Failed to get scraper options: ${error}`);
    }
  }

  /**
   * Finds versions that were indexed from the same source URL.
   * Useful for finding similar configurations or detecting duplicates.
   * @param url Source URL to search for
   * @returns Array of versions with the same source URL
   */
  async findVersionsBySourceUrl(url: string): Promise<DbVersionWithLibrary[]> {
    try {
      const rows = this.statements.getVersionsBySourceUrl.all(
        url,
      ) as DbVersionWithLibrary[];
      return rows;
    } catch (error) {
      throw new StoreError(`Failed to find versions by source URL: ${error}`);
    }
  }

  /**
   * Verifies existence of documents for a specific library version
   */
  async checkDocumentExists(library: string, version: string): Promise<boolean> {
    try {
      const normalizedVersion = version.toLowerCase();
      const result = this.statements.checkExists.get(
        library.toLowerCase(),
        normalizedVersion,
      );
      return result !== undefined;
    } catch (error) {
      throw new ConnectionError("Failed to check document existence", error);
    }
  }

  /**
   * Retrieves a mapping of all libraries to their available versions with details.
   */
  async queryLibraryVersions(): Promise<
    Map<
      string,
      Array<{
        version: string;
        versionId: number;
        status: VersionStatus; // Persisted enum value
        progressPages: number;
        progressMaxPages: number;
        sourceUrl: string | null;
        documentCount: number;
        uniqueUrlCount: number;
        indexedAt: string | null;
      }>
    >
  > {
    try {
      // Define the expected row structure from the GROUP BY query (including versions without documents)
      interface LibraryVersionRow {
        library: string;
        version: string;
        versionId: number;
        status: VersionStatus;
        progressPages: number;
        progressMaxPages: number;
        sourceUrl: string | null;
        documentCount: number;
        uniqueUrlCount: number;
        indexedAt: string | null; // MIN() may return null
      }

      const rows = this.statements.queryLibraryVersions.all() as LibraryVersionRow[];
      const libraryMap = new Map<
        string,
        Array<{
          version: string;
          versionId: number;
          status: VersionStatus;
          progressPages: number;
          progressMaxPages: number;
          sourceUrl: string | null;
          documentCount: number;
          uniqueUrlCount: number;
          indexedAt: string | null;
        }>
      >();

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
          versionId: row.versionId,
          // Preserve raw string status here; DocumentManagementService will cast to VersionStatus
          status: row.status,
          progressPages: row.progressPages,
          progressMaxPages: row.progressMaxPages,
          sourceUrl: row.sourceUrl,
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
          // Both are non-empty, use semver compare with fallback to string compare
          try {
            return semver.compare(a.version, b.version);
          } catch (_error) {
            // Fallback to lexicographic comparison if semver parsing fails
            return a.version.localeCompare(b.version);
          }
        });
      }

      return libraryMap;
    } catch (error) {
      throw new ConnectionError("Failed to query library versions", error);
    }
  }

  /**
   * Stores documents with library and version metadata, generating embeddings
   * for vector similarity search. Automatically removes any existing documents
   * for the same URLs before adding new ones to prevent UNIQUE constraint violations.
   */
  async addDocuments(
    library: string,
    version: string,
    documents: Document[],
  ): Promise<void> {
    try {
      if (documents.length === 0) {
        return;
      }

      // Extract unique URLs from the documents being added
      const urls = new Set<string>();
      for (const doc of documents) {
        const url = doc.metadata.url as string;
        if (!url || typeof url !== "string" || !url.trim()) {
          throw new StoreError("Document metadata must include a valid URL");
        }
        urls.add(url);
      }

      // Generate embeddings in batch
      const texts = documents.map((doc) => {
        const header = `<title>${doc.metadata.title}</title>\n<url>${doc.metadata.url}</url>\n<path>${doc.metadata.path.join(" / ")}</path>\n`;
        return `${header}${doc.pageContent}`;
      });

      // Batch embedding creation to avoid token limit errors
      // Use size-based batching to prevent 413 errors
      const maxBatchChars =
        Number(process.env.DOCS_MCP_EMBEDDING_BATCH_CHARS) || EMBEDDING_BATCH_CHARS;
      const rawEmbeddings: number[][] = [];

      let currentBatch: string[] = [];
      let currentBatchSize = 0;
      let batchCount = 0;

      for (const text of texts) {
        const textSize = text.length;

        // If adding this text would exceed the limit, process the current batch first
        if (currentBatchSize + textSize > maxBatchChars && currentBatch.length > 0) {
          batchCount++;
          logger.debug(
            `Processing embedding batch ${batchCount}: ${currentBatch.length} texts, ${currentBatchSize} chars`,
          );
          const batchEmbeddings = await this.embeddings.embedDocuments(currentBatch);
          rawEmbeddings.push(...batchEmbeddings);
          currentBatch = [];
          currentBatchSize = 0;
        }

        // Add text to current batch
        currentBatch.push(text);
        currentBatchSize += textSize;

        // Also respect the count-based limit for APIs that have per-request item limits
        if (currentBatch.length >= EMBEDDING_BATCH_SIZE) {
          batchCount++;
          logger.debug(
            `Processing embedding batch ${batchCount}: ${currentBatch.length} texts, ${currentBatchSize} chars`,
          );
          const batchEmbeddings = await this.embeddings.embedDocuments(currentBatch);
          rawEmbeddings.push(...batchEmbeddings);
          currentBatch = [];
          currentBatchSize = 0;
        }
      }

      // Process any remaining texts in the final batch
      if (currentBatch.length > 0) {
        batchCount++;
        logger.debug(
          `Processing final embedding batch ${batchCount}: ${currentBatch.length} texts, ${currentBatchSize} chars`,
        );
        const batchEmbeddings = await this.embeddings.embedDocuments(currentBatch);
        rawEmbeddings.push(...batchEmbeddings);
      }
      const paddedEmbeddings = rawEmbeddings.map((vector) => this.padVector(vector));

      // Resolve library and version IDs (creates them if they don't exist)
      const { libraryId, versionId } = await this.resolveLibraryAndVersionIds(
        library,
        version,
      );

      // Delete existing documents for these URLs to prevent UNIQUE constraint violations
      // This must happen AFTER resolveLibraryAndVersionIds to ensure the library/version exist
      for (const url of urls) {
        const deletedCount = await this.deleteDocumentsByUrl(library, version, url);
        if (deletedCount > 0) {
          logger.debug(`Deleted ${deletedCount} existing documents for URL: ${url}`);
        }
      }

      // Insert documents in a transaction
      const transaction = this.db.transaction((docs: typeof documents) => {
        for (let i = 0; i < docs.length; i++) {
          const doc = docs[i];
          const url = doc.metadata.url as string;

          // Insert into main documents table using foreign key IDs
          const result = this.statements.insertDocument.run(
            BigInt(libraryId),
            BigInt(versionId),
            url,
            doc.pageContent,
            JSON.stringify(doc.metadata),
            i,
            new Date().toISOString(), // Pass current timestamp for indexed_at
          );
          const rowId = result.lastInsertRowid;

          // Insert into vector table using foreign key IDs
          this.statements.insertEmbedding.run(
            BigInt(rowId),
            BigInt(libraryId),
            BigInt(versionId),
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
      const normalizedVersion = version.toLowerCase();
      const result = this.statements.deleteDocuments.run(
        library.toLowerCase(),
        library.toLowerCase(), // library name appears twice in the query
        normalizedVersion,
      );
      return result.changes;
    } catch (error) {
      throw new ConnectionError("Failed to delete documents", error);
    }
  }

  /**
   * Removes documents for a specific URL within a library and version
   * @returns Number of documents deleted
   */
  async deleteDocumentsByUrl(
    library: string,
    version: string,
    url: string,
  ): Promise<number> {
    try {
      const normalizedVersion = version.toLowerCase();
      const result = this.statements.deleteDocumentsByUrl.run(
        url,
        library.toLowerCase(),
        library.toLowerCase(), // library name appears twice in the query
        normalizedVersion,
      );
      return result.changes;
    } catch (error) {
      throw new ConnectionError("Failed to delete documents by URL", error);
    }
  }

  /**
   * Completely removes a library version and all associated documents.
   * Optionally removes the library if no other versions remain.
   * @param library Library name
   * @param version Version string (empty string for unversioned)
   * @param removeLibraryIfEmpty Whether to remove the library if no versions remain
   * @returns Object with counts of deleted documents, version deletion status, and library deletion status
   */
  async removeVersion(
    library: string,
    version: string,
    removeLibraryIfEmpty = true,
  ): Promise<{
    documentsDeleted: number;
    versionDeleted: boolean;
    libraryDeleted: boolean;
  }> {
    try {
      const normalizedLibrary = library.toLowerCase();
      const normalizedVersion = version.toLowerCase();

      // First, get the version ID and library ID
      const versionResult = this.statements.getVersionId.get(
        normalizedLibrary,
        normalizedVersion,
      ) as { id: number; library_id: number } | undefined;

      if (!versionResult) {
        // Version doesn't exist, return zero counts
        return { documentsDeleted: 0, versionDeleted: false, libraryDeleted: false };
      }

      const { id: versionId, library_id: libraryId } = versionResult;

      // Delete all documents for this version
      const documentsDeleted = await this.deleteDocuments(library, version);

      // Delete the version record
      const versionDeleteResult = this.statements.deleteVersionById.run(versionId);
      const versionDeleted = versionDeleteResult.changes > 0;

      let libraryDeleted = false;

      // Check if we should remove the library
      if (removeLibraryIfEmpty && versionDeleted) {
        // Count remaining versions for this library
        const countResult = this.statements.countVersionsByLibraryId.get(libraryId) as
          | { count: number }
          | undefined;
        const remainingVersions = countResult?.count ?? 0;

        if (remainingVersions === 0) {
          // No versions left, delete the library
          const libraryDeleteResult = this.statements.deleteLibraryById.run(libraryId);
          libraryDeleted = libraryDeleteResult.changes > 0;
        }
      }

      return { documentsDeleted, versionDeleted, libraryDeleted };
    } catch (error) {
      throw new ConnectionError("Failed to remove version", error);
    }
  }

  /**
   * Retrieves a document by its ID.
   * @param id The ID of the document.
   * @returns The document, or null if not found.
   */
  async getById(id: string): Promise<Document | null> {
    try {
      const row = this.statements.getById.get(BigInt(id)) as DbQueryResult<DbDocument>;
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
      const ftsQuery = this.escapeFtsQuery(query); // Escape the query for FTS

      // Handle empty queries - return empty results
      if (ftsQuery.length === 0) {
        return [];
      }

      const rawEmbedding = await this.embeddings.embedQuery(query);
      const embedding = this.padVector(rawEmbedding);
      const normalizedVersion = version.toLowerCase();

      const stmt = this.db.prepare(`
        WITH vec_distances AS (
          SELECT
            dv.rowid as id,
            dv.distance as vec_distance
          FROM documents_vec dv
          JOIN versions v ON dv.version_id = v.id
          JOIN libraries l ON v.library_id = l.id
          WHERE l.name = ?
            AND COALESCE(v.name, '') = COALESCE(?, '')
            AND dv.embedding MATCH ?
            AND dv.k = ?
          ORDER BY dv.distance
        ),
        fts_scores AS (
          SELECT
            f.rowid as id,
            bm25(documents_fts, 10.0, 1.0, 5.0, 1.0) as fts_score
          FROM documents_fts f
          JOIN documents d ON f.rowid = d.id
          JOIN versions v ON d.version_id = v.id
          JOIN libraries l ON v.library_id = l.id
          WHERE l.name = ?
            AND COALESCE(v.name, '') = COALESCE(?, '')
            AND documents_fts MATCH ?
          ORDER BY fts_score
          LIMIT ?
        )
        SELECT
          d.id,
          d.content,
          d.metadata,
          COALESCE(1 / (1 + v.vec_distance), 0) as vec_score,
          COALESCE(-MIN(f.fts_score, 0), 0) as fts_score
        FROM documents d
        LEFT JOIN vec_distances v ON d.id = v.id
        LEFT JOIN fts_scores f ON d.id = f.id
        WHERE v.id IS NOT NULL OR f.id IS NOT NULL
      `);

      const rawResults = stmt.all(
        library.toLowerCase(),
        normalizedVersion,
        JSON.stringify(embedding),
        limit,
        library.toLowerCase(),
        normalizedVersion,
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
          id: row.id,
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
      const normalizedVersion = version.toLowerCase();

      const result = this.statements.getChildChunks.all(
        library.toLowerCase(),
        normalizedVersion,
        parentUrl,
        parentPath.length + 1,
        JSON.stringify(parentPath),
        BigInt(id),
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
      const normalizedVersion = version.toLowerCase();

      const result = this.statements.getPrecedingSiblings.all(
        library.toLowerCase(),
        normalizedVersion,
        refMetadata.url,
        BigInt(id),
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
      const normalizedVersion = version.toLowerCase();

      const result = this.statements.getSubsequentSiblings.all(
        library.toLowerCase(),
        normalizedVersion,
        refMetadata.url,
        BigInt(id),
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

      const normalizedVersion = version.toLowerCase();
      const result = this.statements.getParentChunk.get(
        library.toLowerCase(),
        normalizedVersion,
        childMetadata.url,
        JSON.stringify(parentPath),
        BigInt(id),
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
      const normalizedVersion = version.toLowerCase();
      // Use parameterized query for variable number of IDs
      const placeholders = ids.map(() => "?").join(",");
      const stmt = this.db.prepare(
        `SELECT d.* FROM documents d
         JOIN libraries l ON d.library_id = l.id
         JOIN versions v ON d.version_id = v.id
         WHERE l.name = ? 
           AND COALESCE(v.name, '') = COALESCE(?, '')
           AND d.id IN (${placeholders}) 
         ORDER BY d.sort_order`,
      );
      const rows = stmt.all(
        library.toLowerCase(),
        normalizedVersion,
        ...ids,
      ) as DbDocument[];
      return rows.map((row) => mapDbDocumentToDocument(row));
    } catch (error) {
      throw new ConnectionError("Failed to fetch documents by IDs", error);
    }
  }
}
