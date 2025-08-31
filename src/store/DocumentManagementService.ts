import fs from "node:fs";
import path from "node:path";
import type { Document } from "@langchain/core/documents";
import envPaths from "env-paths";
import Fuse from "fuse.js";
import semver from "semver";
import { PipelineFactory } from "../scraper/pipelines/PipelineFactory";
import type { ContentPipeline } from "../scraper/pipelines/types";
import type { ScraperOptions } from "../scraper/types";
import { GreedySplitter, PassThroughSplitter } from "../splitter";
import type { ContentChunk } from "../splitter/types";
import { analytics, extractHostname, TelemetryEvent } from "../telemetry";
import { LibraryNotFoundError, VersionNotFoundError } from "../tools";
import { SPLITTER_MIN_CHUNK_SIZE, SPLITTER_PREFERRED_CHUNK_SIZE } from "../utils/config";
import { logger } from "../utils/logger";
import { getProjectRoot } from "../utils/paths";
import { DocumentRetrieverService } from "./DocumentRetrieverService";
import { DocumentStore } from "./DocumentStore";
import type { EmbeddingModelConfig } from "./embeddings/EmbeddingConfig";
import { StoreError } from "./errors";
import type {
  DbVersionWithLibrary,
  FindVersionResult,
  LibrarySummary,
  ScraperConfig,
  StoreSearchResult,
  VersionRef,
  VersionStatus,
  VersionSummary,
} from "./types";

/**
 * Provides semantic search capabilities across different versions of library documentation.
 * Uses content-type-specific pipelines for processing and splitting content.
 */
export class DocumentManagementService {
  private readonly store: DocumentStore;
  private readonly documentRetriever: DocumentRetrieverService;
  private readonly greedySplitter: GreedySplitter;
  private readonly pipelines: ContentPipeline[];

  /**
   * Normalizes a version string, converting null or undefined to an empty string
   * and converting to lowercase.
   */
  private normalizeVersion(version?: string | null): string {
    return (version ?? "").toLowerCase();
  }

  constructor(embeddingConfig?: EmbeddingModelConfig | null) {
    let dbPath: string;
    let dbDir: string;

    // 1. Check Environment Variable
    const envStorePath = process.env.DOCS_MCP_STORE_PATH;
    if (envStorePath) {
      dbDir = envStorePath;
      dbPath = path.join(dbDir, "documents.db");
      logger.debug(`Using database directory from DOCS_MCP_STORE_PATH: ${dbDir}`);
    } else {
      // 2. Check Old Local Path
      const projectRoot = getProjectRoot();
      const oldDbDir = path.join(projectRoot, ".store");
      const oldDbPath = path.join(oldDbDir, "documents.db");
      const oldDbExists = fs.existsSync(oldDbPath); // Check file existence specifically

      if (oldDbExists) {
        dbPath = oldDbPath;
        dbDir = oldDbDir;
        logger.debug(`Using legacy database path: ${dbPath}`);
      } else {
        // 3. Use Standard Path
        const standardPaths = envPaths("docs-mcp-server", { suffix: "" });
        dbDir = standardPaths.data;
        dbPath = path.join(dbDir, "documents.db");
        logger.debug(`Using standard database directory: ${dbDir}`);
      }
    }

    // Ensure the chosen directory exists
    try {
      fs.mkdirSync(dbDir, { recursive: true });
    } catch (error) {
      // Log potential error during directory creation but proceed
      // The DocumentStore constructor might handle DB file creation errors
      logger.error(`⚠️  Failed to create database directory ${dbDir}: ${error}`);
    }

    this.store = new DocumentStore(dbPath, embeddingConfig);
    this.documentRetriever = new DocumentRetrieverService(this.store);

    // Initialize content pipelines for different content types
    this.pipelines = PipelineFactory.createStandardPipelines();

    // Create GreedySplitter for size optimization (still needed for post-processing)
    this.greedySplitter = new GreedySplitter(
      new PassThroughSplitter(), // Pass-through splitter since pipelines handle initial splitting
      SPLITTER_MIN_CHUNK_SIZE,
      SPLITTER_PREFERRED_CHUNK_SIZE,
    );
  }

  /**
   * Initializes the underlying document store.
   */
  async initialize(): Promise<void> {
    await this.store.initialize();
  }

  /**
   * Shuts down the underlying document store.
   */

  async shutdown(): Promise<void> {
    logger.debug("Shutting down store manager");
    await this.store.shutdown();
  }

  // Status tracking methods for pipeline integration

  /**
   * Gets versions by their current status.
   */
  async getVersionsByStatus(statuses: VersionStatus[]): Promise<DbVersionWithLibrary[]> {
    return this.store.getVersionsByStatus(statuses);
  }

  /**
   * Updates the status of a version.
   */
  async updateVersionStatus(
    versionId: number,
    status: VersionStatus,
    errorMessage?: string,
  ): Promise<void> {
    return this.store.updateVersionStatus(versionId, status, errorMessage);
  }

  /**
   * Updates the progress of a version being indexed.
   */
  async updateVersionProgress(
    versionId: number,
    pages: number,
    maxPages: number,
  ): Promise<void> {
    return this.store.updateVersionProgress(versionId, pages, maxPages);
  }

  /**
   * Stores scraper options for a version to enable reproducible indexing.
   */
  async storeScraperOptions(versionId: number, options: ScraperOptions): Promise<void> {
    return this.store.storeScraperOptions(versionId, options);
  }

  /**
   * Retrieves stored scraper options for a version.
   */
  /**
   * Retrieves stored scraping configuration for a version.
   */
  async getScraperOptions(versionId: number): Promise<ScraperConfig | null> {
    return this.store.getScraperOptions(versionId);
  }

  /**
   * Ensures a library/version exists using a VersionRef and returns version ID.
   * Delegates to existing ensureLibraryAndVersion for storage.
   */
  async ensureVersion(ref: VersionRef): Promise<number> {
    const normalized = {
      library: ref.library.trim().toLowerCase(),
      version: (ref.version ?? "").trim().toLowerCase(),
    };
    return this.ensureLibraryAndVersion(normalized.library, normalized.version);
  }

  /**
   * Returns enriched library summaries including version status/progress and counts.
   * Uses existing store APIs; keeps DB details encapsulated.
   */
  async listLibraries(): Promise<LibrarySummary[]> {
    const libMap = await this.store.queryLibraryVersions();
    const summaries: LibrarySummary[] = [];
    for (const [library, versions] of libMap) {
      const vs = versions.map(
        (v) =>
          ({
            id: v.versionId,
            ref: { library, version: v.version },
            status: v.status as VersionStatus,
            // Include progress only while indexing is active; set undefined for COMPLETED
            progress:
              v.status === "completed"
                ? undefined
                : { pages: v.progressPages, maxPages: v.progressMaxPages },
            counts: { documents: v.documentCount, uniqueUrls: v.uniqueUrlCount },
            indexedAt: v.indexedAt,
            sourceUrl: v.sourceUrl ?? undefined,
          }) satisfies VersionSummary,
      );
      summaries.push({ library, versions: vs });
    }
    return summaries;
  }

  /**
   * Finds versions that were indexed from the same source URL.
   */
  async findVersionsBySourceUrl(url: string): Promise<DbVersionWithLibrary[]> {
    return this.store.findVersionsBySourceUrl(url);
  }

  /**
   * Validates if a library exists in the store (either versioned or unversioned).
   * Throws LibraryNotFoundError with suggestions if the library is not found.
   * @param library The name of the library to validate.
   * @throws {LibraryNotFoundError} If the library does not exist.
   */
  async validateLibraryExists(library: string): Promise<void> {
    logger.info(`🔎 Validating existence of library: ${library}`);
    const normalizedLibrary = library.toLowerCase(); // Ensure consistent casing

    // Check for both versioned and unversioned documents
    const versions = await this.listVersions(normalizedLibrary);
    const hasUnversioned = await this.exists(normalizedLibrary, ""); // Check explicitly for unversioned

    if (versions.length === 0 && !hasUnversioned) {
      logger.warn(`⚠️  Library '${library}' not found.`);

      // Library doesn't exist, fetch all libraries to provide suggestions
      const allLibraries = await this.listLibraries();
      const libraryNames = allLibraries.map((lib) => lib.library);

      let suggestions: string[] = [];
      if (libraryNames.length > 0) {
        const fuse = new Fuse(libraryNames, {
          // Configure fuse.js options if needed (e.g., threshold)
          // isCaseSensitive: false, // Handled by normalizing library names
          // includeScore: true,
          threshold: 0.4, // Adjust threshold for desired fuzziness (0=exact, 1=match anything)
        });
        const results = fuse.search(normalizedLibrary);
        // Take top 3 suggestions
        suggestions = results.slice(0, 3).map((result) => result.item);
        logger.info(`🔍 Found suggestions: ${suggestions.join(", ")}`);
      }

      throw new LibraryNotFoundError(library, suggestions);
    }

    logger.info(`✅ Library '${library}' confirmed to exist.`);
  }

  /**
   * Returns a list of all available semantic versions for a library.
   */
  async listVersions(library: string): Promise<string[]> {
    const versions = await this.store.queryUniqueVersions(library);
    return versions.filter((v) => semver.valid(v));
  }

  /**
   * Checks if documents exist for a given library and optional version.
   * If version is omitted, checks for documents without a specific version.
   */
  async exists(library: string, version?: string | null): Promise<boolean> {
    const normalizedVersion = this.normalizeVersion(version);
    return this.store.checkDocumentExists(library, normalizedVersion);
  }

  /**
   * Finds the most appropriate version of documentation based on the requested version.
   * When no target version is specified, returns the latest version.
   *
   * Version matching behavior:
   * - Exact versions (e.g., "18.0.0"): Matches that version or any earlier version
   * - X-Range patterns (e.g., "5.x", "5.2.x"): Matches within the specified range
   * - "latest" or no version: Returns the latest available version
   *
   * For documentation, we prefer matching older versions over no match at all,
   * since older docs are often still relevant and useful.
   * Also checks if unversioned documents exist for the library.
   */
  async findBestVersion(
    library: string,
    targetVersion?: string,
  ): Promise<FindVersionResult> {
    const libraryAndVersion = `${library}${targetVersion ? `@${targetVersion}` : ""}`;
    logger.info(`🔍 Finding best version for ${libraryAndVersion}`);

    // Check if unversioned documents exist *before* filtering for valid semver
    const hasUnversioned = await this.store.checkDocumentExists(library, "");
    const versionStrings = await this.listVersions(library);

    if (versionStrings.length === 0) {
      if (hasUnversioned) {
        logger.info(`ℹ️ Unversioned documents exist for ${library}`);
        return { bestMatch: null, hasUnversioned: true };
      }
      // Throw error only if NO versions (semver or unversioned) exist
      logger.warn(`⚠️  No valid versions found for ${library}`);
      // Fetch detailed versions to pass to the error constructor
      const allLibraryDetails = await this.store.queryLibraryVersions();
      const libraryDetails = allLibraryDetails.get(library) ?? [];
      throw new VersionNotFoundError(library, targetVersion ?? "", libraryDetails);
    }

    let bestMatch: string | null = null;

    if (!targetVersion || targetVersion === "latest") {
      bestMatch = semver.maxSatisfying(versionStrings, "*");
    } else {
      const versionRegex = /^(\d+)(?:\.(?:x(?:\.x)?|\d+(?:\.(?:x|\d+))?))?$|^$/;
      if (!versionRegex.test(targetVersion)) {
        logger.warn(`⚠️  Invalid target version format: ${targetVersion}`);
        // Don't throw yet, maybe unversioned exists
      } else {
        // Restore the previous logic with fallback
        let range = targetVersion;
        if (!semver.validRange(targetVersion)) {
          // If it's not a valid range (like '1.2' or '1'), treat it like a tilde range
          range = `~${targetVersion}`;
        } else if (semver.valid(targetVersion)) {
          // If it's an exact version, allow matching it OR any older version
          range = `${range} || <=${targetVersion}`;
        }
        // If it was already a valid range (like '1.x'), use it directly
        bestMatch = semver.maxSatisfying(versionStrings, range);
      }
    }

    if (bestMatch) {
      logger.info(`✅ Found best match version ${bestMatch} for ${libraryAndVersion}`);
    } else {
      logger.warn(`⚠️  No matching semver version found for ${libraryAndVersion}`);
    }

    // If no semver match found, but unversioned exists, return that info.
    // If a semver match was found, return it along with unversioned status.
    // If no semver match AND no unversioned, throw error.
    if (!bestMatch && !hasUnversioned) {
      // Fetch detailed versions to pass to the error constructor
      const allLibraryDetails = await this.store.queryLibraryVersions();
      const libraryDetails = allLibraryDetails.get(library) ?? [];
      throw new VersionNotFoundError(library, targetVersion ?? "", libraryDetails);
    }

    return { bestMatch, hasUnversioned };
  }

  /**
   * Removes all documents for a specific library and optional version.
   * If version is omitted, removes documents without a specific version.
   */
  async removeAllDocuments(library: string, version?: string | null): Promise<void> {
    const normalizedVersion = this.normalizeVersion(version);
    logger.info(
      `🗑️ Removing all documents from ${library}@${normalizedVersion || "[no version]"} store`,
    );
    const count = await this.store.deleteDocuments(library, normalizedVersion);
    logger.info(`🗑️ Deleted ${count} documents`);
  }

  /**
   * Completely removes a library version and all associated documents.
   * Also removes the library if no other versions remain.
   * @param library Library name
   * @param version Version string (null/undefined for unversioned)
   */
  async removeVersion(library: string, version?: string | null): Promise<void> {
    const normalizedVersion = this.normalizeVersion(version);
    logger.info(`🗑️ Removing version: ${library}@${normalizedVersion || "[no version]"}`);

    const result = await this.store.removeVersion(library, normalizedVersion, true);

    logger.info(
      `🗑️ Removed ${result.documentsDeleted} documents, version: ${result.versionDeleted}, library: ${result.libraryDeleted}`,
    );

    if (result.versionDeleted && result.libraryDeleted) {
      logger.info(`✅ Completely removed library ${library} (was last version)`);
    } else if (result.versionDeleted) {
      logger.info(`✅ Removed version ${library}@${normalizedVersion || "[no version]"}`);
    } else {
      logger.warn(
        `⚠️ Version ${library}@${normalizedVersion || "[no version]"} not found`,
      );
    }
  }

  /**
   * Adds a document to the store, splitting it into smaller chunks for better search results.
   * Uses SemanticMarkdownSplitter to maintain markdown structure and content types during splitting.
   * Preserves hierarchical structure of documents and distinguishes between text and code segments.
   * If version is omitted, the document is added without a specific version.
   */
  async addDocument(
    library: string,
    version: string | null | undefined,
    document: Document,
  ): Promise<void> {
    const processingStart = performance.now();
    const normalizedVersion = this.normalizeVersion(version);
    const url = document.metadata.url as string;

    if (!url || typeof url !== "string" || !url.trim()) {
      throw new StoreError("Document metadata must include a valid URL");
    }

    logger.info(`📚 Adding document: ${document.metadata.title}`);

    if (!document.pageContent.trim()) {
      throw new Error("Document content cannot be empty");
    }

    const contentType = document.metadata.mimeType as string | undefined;

    try {
      // Create a mock RawContent for pipeline selection
      const rawContent = {
        source: url,
        content: document.pageContent,
        mimeType: contentType || "text/plain",
      };

      // Find appropriate pipeline for content type
      const pipeline = this.pipelines.find((p) => p.canProcess(rawContent));

      let chunks: ContentChunk[];
      if (pipeline?.split) {
        // Use content-type-specific pipeline with built-in GreedySplitter optimization
        chunks = await pipeline.split(document.pageContent, contentType);
      } else {
        // Fallback to GreedySplitter for unknown content types
        chunks = await this.greedySplitter.splitText(document.pageContent);
      }

      // Convert semantic chunks to documents
      const splitDocs = chunks.map((chunk: ContentChunk) => ({
        pageContent: chunk.content,
        metadata: {
          ...document.metadata,
          level: chunk.section.level,
          path: chunk.section.path,
        },
      }));
      logger.info(`✂️  Split document into ${splitDocs.length} chunks`);

      // Add split documents to store
      await this.store.addDocuments(library, normalizedVersion, splitDocs);

      // Track successful document processing
      const processingTime = performance.now() - processingStart;
      analytics.track(TelemetryEvent.DOCUMENT_PROCESSED, {
        // Content characteristics (privacy-safe)
        mimeType: contentType || "unknown",
        contentSizeBytes: document.pageContent.length,

        // Processing metrics
        processingTimeMs: Math.round(processingTime),
        chunksCreated: splitDocs.length,

        // Document characteristics
        hasTitle: !!document.metadata.title,
        hasDescription: !!document.metadata.description,
        urlDomain: extractHostname(url),
        depth: document.metadata.depth,

        // Library context
        library,
        libraryVersion: normalizedVersion || null,

        // Processing efficiency
        avgChunkSizeBytes: Math.round(document.pageContent.length / splitDocs.length),
        processingSpeedKbPerSec: Math.round(
          document.pageContent.length / 1024 / (processingTime / 1000),
        ),
      });
    } catch (error) {
      // Track processing failures with native error tracking
      const processingTime = performance.now() - processingStart;

      if (error instanceof Error) {
        analytics.captureException(error, {
          mimeType: contentType || "unknown",
          contentSizeBytes: document.pageContent.length,
          processingTimeMs: Math.round(processingTime),
          library,
          libraryVersion: normalizedVersion || null,
          context: "document_processing",
          component: DocumentManagementService.constructor.name,
        });
      }

      throw error;
    }
  }

  /**
   * Searches for documentation content across versions.
   * Uses hybrid search (vector + FTS).
   * If version is omitted, searches documents without a specific version.
   */
  async searchStore(
    library: string,
    version: string | null | undefined,
    query: string,
    limit = 5,
  ): Promise<StoreSearchResult[]> {
    const normalizedVersion = this.normalizeVersion(version);
    return this.documentRetriever.search(library, normalizedVersion, query, limit);
  }

  // Deprecated simple listing removed: enriched listLibraries() is canonical

  /**
   * Ensures a library and version exist in the database and returns the version ID.
   * Creates the library and version records if they don't exist.
   */
  async ensureLibraryAndVersion(library: string, version: string): Promise<number> {
    // Use the same resolution logic as addDocuments but return the version ID
    const normalizedLibrary = library.toLowerCase();
    const normalizedVersion = this.normalizeVersion(version);

    // This will create the library and version if they don't exist
    const { versionId } = await this.store.resolveLibraryAndVersionIds(
      normalizedLibrary,
      normalizedVersion,
    );

    return versionId;
  }
}
