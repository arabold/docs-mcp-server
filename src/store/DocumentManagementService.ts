import path from "node:path";
import Fuse from "fuse.js";
import semver from "semver";
import {
  type PipelineConfiguration,
  PipelineFactory,
} from "../scraper/pipelines/PipelineFactory";
import type { ContentPipeline } from "../scraper/pipelines/types";
import type { ScrapeResult, ScraperOptions } from "../scraper/types";
import type { Chunk } from "../splitter/types";
import { analytics, extractHostname, TelemetryEvent } from "../telemetry";
import { logger } from "../utils/logger";
import { DocumentRetrieverService } from "./DocumentRetrieverService";
import { DocumentStore } from "./DocumentStore";
import type { EmbeddingModelConfig } from "./embeddings/EmbeddingConfig";
import {
  LibraryNotFoundInStoreError,
  StoreError,
  VersionNotFoundInStoreError,
} from "./errors";
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
  private readonly pipelines: ContentPipeline[];

  /**
   * Normalizes a version string, converting null or undefined to an empty string
   * and converting to lowercase.
   */
  private normalizeVersion(version?: string | null): string {
    return (version ?? "").toLowerCase();
  }

  constructor(
    storePath: string,
    embeddingConfig?: EmbeddingModelConfig | null,
    pipelineConfig?: PipelineConfiguration,
  ) {
    // Handle special :memory: case for in-memory databases (primarily for testing)
    const dbPath =
      storePath === ":memory:" ? ":memory:" : path.join(storePath, "documents.db");

    logger.debug(`Using database path: ${dbPath}`);

    // Directory creation is handled by the centralized path resolution

    this.store = new DocumentStore(dbPath, embeddingConfig);
    this.documentRetriever = new DocumentRetrieverService(this.store);

    // Initialize content pipelines for different content types including universal TextPipeline fallback
    this.pipelines = PipelineFactory.createStandardPipelines(pipelineConfig);
  }

  /**
   * Initializes the underlying document store.
   */
  async initialize(): Promise<void> {
    await this.store.initialize();
  }

  /**
   * Shuts down the underlying document store and cleans up pipeline resources.
   */

  async shutdown(): Promise<void> {
    logger.debug("Shutting down store manager");

    // Cleanup all pipelines to prevent resource leaks (e.g., browser instances)
    await Promise.allSettled(this.pipelines.map((pipeline) => pipeline.close()));

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
   * Throws LibraryNotFoundInStoreError with suggestions if the library is not found.
   * @param library The name of the library to validate.
   * @throws {LibraryNotFoundInStoreError} If the library does not exist.
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
          threshold: 0.7, // Adjust threshold for desired fuzziness (0=exact, 1=match anything)
        });
        const results = fuse.search(normalizedLibrary);
        // Take top 3 suggestions
        suggestions = results.slice(0, 3).map((result) => result.item);
        logger.info(`🔍 Found suggestions: ${suggestions.join(", ")}`);
      }

      throw new LibraryNotFoundInStoreError(library, suggestions);
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
      // The next line should usually throw
      await this.validateLibraryExists(library);
      // Fallback, should not reach here
      throw new LibraryNotFoundInStoreError(library, []);
    }

    let bestMatch: string | null = null;

    if (!targetVersion || targetVersion === "latest") {
      bestMatch = semver.maxSatisfying(versionStrings, "*");
    } else {
      const versionRegex = /^(\d+)(?:\.(?:x(?:\.x)?|\d+(?:\.(?:x|\d+))?))?$|^$/;
      if (!semver.valid(targetVersion) && !versionRegex.test(targetVersion)) {
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
      const availableVersions = libraryDetails.map((v) => v.version);
      throw new VersionNotFoundInStoreError(
        library,
        targetVersion ?? "",
        availableVersions,
      );
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
    const count = await this.store.deletePages(library, normalizedVersion);
    logger.info(`🗑️ Deleted ${count} documents`);
  }

  /**
   * Deletes a page and all its associated document chunks.
   * This is used during refresh operations when a page returns 404 Not Found.
   */
  async deletePage(pageId: number): Promise<void> {
    logger.debug(`Deleting page ID: ${pageId}`);
    await this.store.deletePage(pageId);
  }

  /**
   * Retrieves all pages for a specific version ID with their metadata.
   * Used for refresh operations to get existing pages with their ETags and depths.
   */
  async getPagesByVersionId(
    versionId: number,
  ): Promise<
    Array<{ id: number; url: string; etag: string | null; depth: number | null }>
  > {
    return this.store.getPagesByVersionId(versionId);
  }

  /**
   * Completely removes a library version and all associated documents.
   * Also removes the library if no other versions remain.
   * @param library Library name
   * @param version Version string (null/undefined for unversioned)
   */
  async removeVersion(library: string, version?: string | null): Promise<void> {
    const normalizedVersion = this.normalizeVersion(version);
    logger.debug(`Removing version: ${library}@${normalizedVersion || "[no version]"}`);

    const result = await this.store.removeVersion(library, normalizedVersion, true);

    logger.info(`🗑️ Removed ${result.documentsDeleted} documents`);

    if (result.versionDeleted && result.libraryDeleted) {
      logger.info(`🗑️ Completely removed library ${library} (was last version)`);
    } else if (result.versionDeleted) {
      logger.info(`🗑️ Removed version ${library}@${normalizedVersion || "[no version]"}`);
    } else {
      logger.warn(
        `⚠️ Version ${library}@${normalizedVersion || "[no version]"} not found`,
      );
    }
  }

  /**
   * Adds pre-processed content directly to the store.
   * This method is used when content has already been processed by a pipeline,
   * avoiding redundant processing. Used primarily by the scraping pipeline.
   *
   * @param library Library name
   * @param version Version string (null/undefined for unversioned)
   * @param processed Pre-processed content with chunks already created
   * @param pageId Optional page ID for refresh operations
   */
  async addScrapeResult(
    library: string,
    version: string | null | undefined,
    depth: number,
    result: ScrapeResult,
  ): Promise<void> {
    const processingStart = performance.now();
    const normalizedVersion = this.normalizeVersion(version);
    const { url, title, chunks, contentType } = result;
    if (!url) {
      throw new StoreError("Processed content metadata must include a valid URL");
    }

    logger.info(`📚 Adding processed content: ${title || url}`);

    if (chunks.length === 0) {
      logger.warn(`⚠️  No chunks in processed content for ${url}. Skipping.`);
      return;
    }

    try {
      logger.info(`✂️  Storing ${chunks.length} pre-split chunks`);

      // Add split documents to store
      await this.store.addDocuments(library, normalizedVersion, depth, result);

      // Track successful document processing
      const processingTime = performance.now() - processingStart;
      const totalContentSize = chunks.reduce(
        (sum: number, chunk: Chunk) => sum + chunk.content.length,
        0,
      );

      analytics.track(TelemetryEvent.DOCUMENT_PROCESSED, {
        // Content characteristics (privacy-safe)
        mimeType: contentType,
        contentSizeBytes: totalContentSize,

        // Processing metrics
        processingTimeMs: Math.round(processingTime),
        chunksCreated: chunks.length,

        // Document characteristics
        hasTitle: !!title,
        urlDomain: extractHostname(url),
        depth,

        // Library context
        library,
        libraryVersion: normalizedVersion || null,

        // Processing efficiency
        avgChunkSizeBytes: Math.round(totalContentSize / chunks.length),
        processingSpeedKbPerSec: Math.round(
          totalContentSize / 1024 / (processingTime / 1000),
        ),
      });
    } catch (error) {
      // Track processing failures with native error tracking
      const processingTime = performance.now() - processingStart;

      if (error instanceof Error) {
        analytics.captureException(error, {
          mimeType: contentType,
          contentSizeBytes: chunks.reduce(
            (sum: number, chunk: Chunk) => sum + chunk.content.length,
            0,
          ),
          processingTimeMs: Math.round(processingTime),
          library,
          libraryVersion: normalizedVersion || null,
          context: "processed_content_storage",
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
    const versionId = await this.store.resolveVersionId(
      normalizedLibrary,
      normalizedVersion,
    );

    return versionId;
  }
}
