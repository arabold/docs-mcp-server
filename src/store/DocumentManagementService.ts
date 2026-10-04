import path from "node:path";
import Fuse from "fuse.js";
import semver from "semver";
import type { EventBusService } from "../events";
import { EventType } from "../events";
import { PipelineFactory } from "../scraper/pipelines/PipelineFactory";
import type { ContentPipeline } from "../scraper/pipelines/types";
import type { ScrapeResult, ScraperOptions } from "../scraper/types";
import type { Chunk } from "../splitter/types";
import { telemetry } from "../telemetry";
import type { AppConfig } from "../utils/config";
import { logger } from "../utils/logger";
import { formatBytes } from "../utils/string";
import { normalizeUrl } from "../utils/url";
import {
  isSemanticVersion,
  type SemanticVersionCandidate,
  sortVersionsDescending,
  toVersionCandidates,
  VERSION_REQUEST_PATTERN,
  type VersionCandidate,
} from "../utils/version";
import { createContentAssemblyStrategy } from "./assembly/ContentAssemblyStrategyFactory";
import { DocumentRetrieverService } from "./DocumentRetrieverService";
import { DocumentStore } from "./DocumentStore";
import type { EmbeddingModelConfig } from "./embeddings/EmbeddingConfig";
import {
  AmbiguousPageInStoreError,
  LibraryNotFoundInStoreError,
  PageNotFoundInStoreError,
  StoreError,
  VersionNotFoundInStoreError,
} from "./errors";
import type {
  ActivityHistory,
  CompactResult,
  DbPageChunk,
  DbVersionWithLibrary,
  EmbeddingConfigInfo,
  FindVersionResult,
  LibrarySummary,
  ListPagesOptions,
  ListPagesResult,
  ListVersionChunksOptions,
  ListVersionChunksResult,
  PageContentOptions,
  PageContentResult,
  ScraperConfig,
  StoreSearchResult,
  VersionChunkStats,
  VersionComposition,
  VersionRef,
  VersionStatus,
  VersionSummary,
} from "./types";
import { normalizeVersionLabel, normalizeVersionRef } from "./types";

/** Upper bound on the pages listed when a path matches more than one. */
const MAX_AMBIGUOUS_PAGE_MATCHES = 10;

/**
 * Returns the distinct spellings a stored URL may use for `value`: as given,
 * encoded, and percent-decoded.
 */
function spellingsOf(value: string, encode: (value: string) => string): string[] {
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    // Not valid percent-encoding; the other spellings still apply.
  }
  return [...new Set([value, encode(value), decoded])];
}

/**
 * Percent-encodes a path the way URL parsing does when the scraper stores a URL.
 * Hash-only routes are left alone because they carry no path.
 */
function encodePath(path: string): string {
  if (!path.startsWith("/")) return path;
  const url = new URL(path, "http://placeholder");
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * Turns a page path into the URL ending to match: rooted at `/` (hash routes
 * excepted), without trailing slashes. Empty for the root path.
 */
function toPathSuffix(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  if (!trimmed) return "";
  return trimmed.startsWith("/") || trimmed.startsWith("#") ? trimmed : `/${trimmed}`;
}

/**
 * Provides semantic search capabilities across different versions of library documentation.
 * Uses content-type-specific pipelines for processing and splitting content.
 */
export class DocumentManagementService {
  private readonly appConfig: AppConfig;
  private readonly store: DocumentStore;
  private readonly documentRetriever: DocumentRetrieverService;
  private readonly pipelines: ContentPipeline[];
  private readonly eventBus: EventBusService;

  constructor(eventBus: EventBusService, appConfig: AppConfig) {
    this.appConfig = appConfig;
    this.eventBus = eventBus;
    const storePath = this.appConfig.app.storePath;
    if (!storePath) {
      throw new Error("storePath is required when not using a remote server");
    }
    // Handle special :memory: case for in-memory databases (primarily for testing)
    const dbPath =
      storePath === ":memory:" ? ":memory:" : path.join(storePath, "documents.db");

    logger.debug(`Using database path: ${dbPath}`);

    // Directory creation is handled by the centralized path resolution

    this.store = new DocumentStore(dbPath, this.appConfig);
    this.documentRetriever = new DocumentRetrieverService(this.store, this.appConfig);

    // Initialize content pipelines for different content types including universal TextPipeline fallback
    this.pipelines = PipelineFactory.createStandardPipelines(this.appConfig);
  }

  /**
   * Returns the active embedding configuration if vector search is enabled,
   * or null if embeddings are disabled.
   */
  getActiveEmbeddingConfig(): EmbeddingModelConfig | null {
    return this.store.getActiveEmbeddingConfig();
  }

  async getEmbeddingConfigInfo(): Promise<EmbeddingConfigInfo | null> {
    const config = this.getActiveEmbeddingConfig();
    return config
      ? {
          provider: config.provider,
          model: config.model,
          dimensions: config.dimensions,
        }
      : null;
  }

  /**
   * Initializes the underlying document store.
   */
  async initialize(): Promise<void> {
    await this.store.initialize();
  }

  /**
   * Resolves a confirmed embedding model change by invalidating all vectors
   * and completing the initialization that was interrupted by EmbeddingModelChangedError.
   */
  async resolveModelChange(): Promise<void> {
    await this.store.resolveModelChange();
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
    pagesIndexed: number | null = null,
  ): Promise<void> {
    return this.store.updateVersionProgress(versionId, pages, maxPages, pagesIndexed);
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
    const normalized = normalizeVersionRef(ref);
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
      const vs = await Promise.all(
        versions.map(async (v) => {
          const scraperOptions = await this.store.getScraperOptions(v.versionId);
          return {
            id: v.versionId,
            ref: { library, version: v.version },
            status: v.status as VersionStatus,
            errorMessage: v.errorMessage,
            // Include progress only while indexing is active; set undefined for COMPLETED
            progress:
              v.status === "completed"
                ? undefined
                : { pages: v.progressPages, maxPages: v.progressMaxPages },
            counts: { documents: v.documentCount, uniqueUrls: v.uniqueUrlCount },
            indexedAt: v.indexedAt,
            sourceUrl: v.sourceUrl ?? undefined,
            preserveHashes: scraperOptions?.options.preserveHashes,
          } satisfies VersionSummary;
        }),
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
   * Validates if a library exists in the store.
   * Checks if the library record exists in the database, regardless of whether it has versions or documents.
   * Throws LibraryNotFoundInStoreError with suggestions if the library is not found.
   * @param library The name of the library to validate.
   * @throws {LibraryNotFoundInStoreError} If the library does not exist.
   */
  async validateLibraryExists(library: string): Promise<void> {
    logger.info(`🔎 Validating existence of library: ${library}`);

    // Check if the library exists in the libraries table
    const libraryRecord = await this.store.getLibrary(library);

    if (!libraryRecord) {
      logger.warn(`⚠️  Library '${library}' not found.`);

      // Library doesn't exist, fetch all libraries to provide suggestions
      const allLibraries = await this.listLibraries();
      const libraryNames = allLibraries.map((lib) => lib.library);

      let suggestions: string[] = [];
      if (libraryNames.length > 0) {
        const fuse = new Fuse(libraryNames, {
          threshold: 0.7, // Adjust threshold for desired fuzziness (0=exact, 1=match anything)
        });
        const results = fuse.search(library.toLowerCase());
        // Take top 3 suggestions
        suggestions = results.slice(0, 3).map((result) => result.item);
        logger.info(`🔍 Found suggestions: ${suggestions.join(", ")}`);
      }

      throw new LibraryNotFoundInStoreError(library, suggestions);
    }

    logger.info(`✅ Library '${library}' confirmed to exist.`);
  }

  /**
   * Returns every label stored for a library — semantic versions and opaque tags
   * alike — in canonical display order.
   *
   * Dropping tags here is what made documentation indexed as "latest" or
   * "stable" unreachable. The empty label is excluded because it represents
   * unversioned content, which is tracked separately.
   */
  async listVersions(library: string): Promise<string[]> {
    const versions = await this.store.queryUniqueVersions(library);
    return sortVersionsDescending(versions.filter((v) => v !== ""));
  }

  /**
   * Checks if documents exist for a given library and optional version.
   * If version is omitted, checks for documents without a specific version.
   */
  async exists(library: string, version?: string | null): Promise<boolean> {
    const normalizedVersion = normalizeVersionLabel(version);
    return this.store.checkDocumentExists(library, normalizedVersion);
  }

  /**
   * Lists every label stored for a library, for inclusion in error messages.
   *
   * Unlike {@link listVersions} this is not filtered or ordered for matching —
   * it is what a caller may ask for, including opaque tags the resolver could
   * not rank.
   *
   * @param library Library name.
   * @returns Every stored label, including the empty unversioned label.
   */
  private async listAvailableLabels(library: string): Promise<string[]> {
    return this.store.queryUniqueVersions(library);
  }

  /**
   * Resolves a requested version against a library's stored labels.
   *
   * The ladder is ordered so that the most specific answer wins:
   *
   * 1. A literal match on a stored label, so any indexed bucket is always
   *    reachable by the name it was indexed under — including an opaque tag.
   * 2. Semantic version matching over the version-tier labels, ranking
   *    prereleases as ordinary versions.
   * 3. A library's single opaque tag, when it has no semantic versions at all.
   *
   * @param candidates Classified labels stored for the library.
   * @param targetVersion The version the caller requested, if any.
   * @returns The stored label to use, or `null` when nothing resolves.
   * @throws {VersionNotFoundInStoreError} When only tags exist and several are
   *   available, so no single one can be called newest.
   */
  private resolveVersionLabel(
    candidates: VersionCandidate[],
    targetVersion?: string,
  ): string | null {
    const requested = normalizeVersionLabel(targetVersion);

    // Rung 1: literal match.
    if (requested !== "") {
      const literal = candidates.find((c) => c.stored === requested);
      if (literal) {
        return literal.stored;
      }
    }

    // Rung 2: semantic version matching.
    const versions = candidates.filter(isSemanticVersion);
    if (versions.length > 0) {
      const matched = this.matchSemanticVersion(versions, requested);
      if (matched) {
        return matched;
      }
    }

    // Rung 3: a lone opaque tag, only when the caller expressed no preference
    // and there is no semantic version to rank ahead of it. With no semantic
    // versions every candidate is a tag, so one candidate means one tag.
    if (requested === "" && versions.length === 0 && candidates.length === 1) {
      return candidates[0].stored;
    }

    return null;
  }

  /**
   * Matches a request against semantic-version labels.
   *
   * A request naming a specific version matches that version or the highest one
   * below it, because older documentation is more useful than none. Prereleases
   * are ranked as ordinary versions: `includePrerelease` keeps semver from
   * skipping a prerelease that is the closest available match, which matters for
   * documentation in a way it does not for installing packages.
   *
   * @param versions Semantic-version candidates for the library.
   * @param requested Normalized request; empty means no preference.
   * @returns The stored label of the best match, or `null` when none matches.
   */
  private matchSemanticVersion(
    versions: SemanticVersionCandidate[],
    requested: string,
  ): string | null {
    const normalizedCandidates = versions.map((c) => c.normalized);
    const options: semver.RangeOptions = { includePrerelease: true };

    let range: string;
    if (requested === "" || requested === "latest") {
      range = "*";
    } else if (semver.valid(requested)) {
      // An exact version: allow matching it OR any older version
      range = `${requested} || <=${requested}`;
    } else if (VERSION_REQUEST_PATTERN.test(requested)) {
      // A partial version or X-range ("1", "1.2", "1.x"): already a valid range
      range = requested;
    } else {
      logger.warn(`⚠️  Invalid target version format: ${requested}`);
      return null;
    }

    const best = semver.maxSatisfying(normalizedCandidates, range, options);
    if (!best) {
      return null;
    }

    // Map the winning normalized version back to a stored label. Several labels
    // can normalize to the same version ("1.20" and "1.20.0"); rung 1 already
    // handled a caller asking for one by name, so prefer the strict spelling.
    const matches = versions.filter((c) => c.normalized === best);
    return (matches.find((c) => c.strict) ?? matches[0]).stored;
  }

  /**
   * Finds the most appropriate stored label for a requested version.
   *
   * Resolution itself lives in {@link resolveVersionLabel}; this adds the
   * unversioned bucket, which a resolved label always outranks, and the error
   * raised when neither produces anything.
   *
   * @param library Library name.
   * @param targetVersion The version requested, if any.
   * @returns The resolved label (or `null`) and whether unversioned docs exist.
   * @throws {VersionNotFoundInStoreError} When nothing resolves and no
   *   unversioned documentation exists.
   * @throws {LibraryNotFoundInStoreError} When the library has no content.
   */
  async findBestVersion(
    library: string,
    targetVersion?: string,
  ): Promise<FindVersionResult> {
    const libraryAndVersion = `${library}${targetVersion ? `@${targetVersion}` : ""}`;
    logger.info(`🔍 Finding best version for ${libraryAndVersion}`);

    // Unversioned content is tracked separately from labelled buckets, so check
    // for it before any label handling.
    const hasUnversioned = await this.store.checkDocumentExists(library, "");
    const labels = await this.listVersions(library);

    if (labels.length === 0) {
      if (hasUnversioned) {
        logger.info(`ℹ️ Unversioned documents exist for ${library}`);
        return { bestMatch: null, hasUnversioned: true };
      }
      logger.warn(`⚠️  No versions found for ${library}`);
      // The next line should usually throw
      await this.validateLibraryExists(library);
      // Fallback, should not reach here
      throw new LibraryNotFoundInStoreError(library, []);
    }

    const candidates = toVersionCandidates(labels);
    const bestMatch = this.resolveVersionLabel(candidates, targetVersion);

    if (bestMatch) {
      logger.info(`✅ Found best match version ${bestMatch} for ${libraryAndVersion}`);
    } else {
      logger.warn(`⚠️  No matching version found for ${libraryAndVersion}`);
    }

    // A resolved label always wins over the unversioned bucket, so indexed
    // documentation is never silently skipped. Only when nothing resolves does
    // unversioned content come into play, and failing that we report the error.
    if (!bestMatch && !hasUnversioned) {
      throw new VersionNotFoundInStoreError(
        library,
        targetVersion ?? "",
        await this.listAvailableLabels(library),
      );
    }

    return { bestMatch, hasUnversioned };
  }

  /**
   * Removes all documents for a specific library and optional version.
   * If version is omitted, removes documents without a specific version.
   */
  async removeAllDocuments(library: string, version?: string | null): Promise<void> {
    const normalizedVersion = normalizeVersionLabel(version);
    logger.info(
      `🗑️ Removing all documents from ${library}@${normalizedVersion || "latest"} store`,
    );
    const count = await this.store.deletePages(library, normalizedVersion);
    logger.info(`🗑️ Deleted ${count} documents`);
    await this.compactAfterDelete();

    // Emit library change event
    this.eventBus.emit(EventType.LIBRARY_CHANGE, undefined);
  }

  /**
   * Deletes a page and all its associated document chunks.
   * This is used during refresh operations when a page returns 404 Not Found.
   */
  async deletePage(pageId: number): Promise<void> {
    logger.debug(`Deleting page ID: ${pageId}`);
    await this.store.deletePage(pageId);

    // Emit library change event
    this.eventBus.emit(EventType.LIBRARY_CHANGE, undefined);
  }

  /**
   * Retrieves all pages for a specific version ID with their metadata.
   * Used for refresh operations to get existing pages with their ETags and depths.
   */
  async getPagesByVersionId(versionId: number): Promise<
    Array<{
      id: number;
      url: string;
      etag: string | null;
      depth: number | null;
      content_url: string | null;
    }>
  > {
    return this.store.getPagesByVersionId(versionId);
  }

  /**
   * Completely removes a library version and all associated documents.
   * Also removes the library if no other versions remain.
   * If the specified version doesn't exist but the library exists with no versions, removes the library.
   * @param library Library name
   * @param version Version string (null/undefined for unversioned)
   */
  async removeVersion(library: string, version?: string | null): Promise<void> {
    const normalizedVersion = normalizeVersionLabel(version);
    logger.debug(`Removing version: ${library}@${normalizedVersion || "latest"}`);

    const result = await this.store.removeVersion(library, normalizedVersion, true);

    logger.info(`🗑️ Removed ${result.documentsDeleted} documents`);

    if (result.versionDeleted && result.libraryDeleted) {
      logger.info(`🗑️ Completely removed library ${library} (was last version)`);
    } else if (result.versionDeleted) {
      logger.info(`🗑️ Removed version ${library}@${normalizedVersion || "latest"}`);
    } else {
      // Version not found - check if library exists but is empty (has no versions)
      logger.warn(`⚠️  Version ${library}@${normalizedVersion || "latest"} not found`);

      const libraryRecord = await this.store.getLibrary(library);
      if (libraryRecord) {
        // Library exists - check if it has any versions
        const versions = await this.store.queryUniqueVersions(library);
        if (versions.length === 0) {
          // Library exists but has no versions - delete the library itself
          logger.info(`🗑️ Library ${library} has no versions, removing library record`);
          await this.store.deleteLibrary(libraryRecord.id);
          logger.info(`🗑️ Completely removed library ${library} (had no versions)`);
        }
      }
    }

    await this.compactAfterDelete();

    // Emit library change event
    this.eventBus.emit(EventType.LIBRARY_CHANGE, undefined);
  }

  /**
   * Reclaims unused SQLite pages and truncates the WAL file.
   * VACUUM takes an exclusive lock; use the CLI/`compact` mutation when idle.
   *
   * @param options.force Always VACUUM even if no free pages are detected
   * @param options.vacuum When `false`, only run a non-blocking WAL checkpoint
   */
  async compact(options?: { force?: boolean; vacuum?: boolean }): Promise<CompactResult> {
    const result = await this.store.compact(options);
    if (result.skipped) {
      logger.info("🧹 Skipped compaction for in-memory store");
    } else if (result.vacuumed) {
      logger.info(
        `🧹 Compacted store: ${formatBytes(result.beforeBytes)} → ${formatBytes(result.afterBytes)} (reclaimed ${formatBytes(result.reclaimedBytes)})`,
      );
    } else if (result.reclaimedBytes > 0) {
      logger.info(
        `🧹 Checkpointed store: ${formatBytes(result.beforeBytes)} → ${formatBytes(result.afterBytes)} (reclaimed ${formatBytes(result.reclaimedBytes)})`,
      );
    } else if (options?.vacuum === false) {
      logger.info("🧹 Checkpointed WAL after delete");
    } else {
      logger.info("🧹 No free pages to reclaim");
    }
    return result;
  }

  /**
   * Best-effort WAL checkpoint after a bulk delete. Does not VACUUM, so readers
   * stay unblocked. Remove succeeds even if the checkpoint fails.
   */
  private async compactAfterDelete(): Promise<void> {
    try {
      await this.compact({ force: false, vacuum: false });
    } catch (error) {
      logger.error(
        `❌ Failed to checkpoint store after delete: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Records a page that exists but holds no content, replacing anything stored
   * for it previously.
   *
   * @param library Library name.
   * @param version Version string (null/undefined for unversioned).
   * @param depth Crawl depth the page was found at.
   * @param page Page identity and optional validators.
   */
  async addEmptyPage(
    library: string,
    version: string | null | undefined,
    depth: number,
    page: {
      url: string;
      contentUrl?: string;
      title: string;
      sourceContentType: string | null;
      contentType: string | null;
      etag: string | null;
      lastModified: string | null;
      isAdditionalRepresentation?: boolean;
    },
    previousPageId?: number,
  ): Promise<void> {
    if (!page.url) {
      throw new StoreError("Empty page metadata must include a valid URL");
    }
    await this.store.addEmptyPage(
      library,
      normalizeVersionLabel(version),
      depth,
      page,
      previousPageId,
    );
    this.eventBus.emit(EventType.LIBRARY_CHANGE, undefined);
  }

  /**
   * Adds pre-processed content directly to the store.
   * This method is used when content has already been processed by a pipeline,
   * avoiding redundant processing. Used primarily by the scraping pipeline.
   *
   * @param library Library name
   * @param version Version string (null/undefined for unversioned)
   * @param processed Pre-processed content with chunks already created
   * @param previousPageId Page a refresh read this content from, retired by the
   *   store when the write lands under a different row.
   */
  async addScrapeResult(
    library: string,
    version: string | null | undefined,
    depth: number,
    result: ScrapeResult,
    previousPageId?: number,
  ): Promise<void> {
    const processingStart = performance.now();
    const normalizedVersion = normalizeVersionLabel(version);
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
      await this.store.addDocuments(
        library,
        normalizedVersion,
        depth,
        result,
        previousPageId,
      );

      // Emit library change event after adding documents
      this.eventBus.emit(EventType.LIBRARY_CHANGE, undefined);
    } catch (error) {
      // Track processing failures with native error tracking
      const processingTime = performance.now() - processingStart;

      if (error instanceof Error) {
        telemetry.captureException(error, {
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
    const normalizedVersion = normalizeVersionLabel(version);
    return this.documentRetriever.search(library, normalizedVersion, query, limit);
  }

  /**
   * Reads consecutive chunks of a stored page, assembled for the page's content type.
   *
   * The page is identified by its URL, the URL its content was fetched from, or a
   * path matching the end of exactly one page URL. Only whole chunks are returned,
   * so the content never ends inside a code block; `nextChunk` tells the caller
   * where to continue.
   *
   * @param library Library name.
   * @param version Version or version range; resolved like `searchStore`.
   * @param pathOrUrl Page URL or path.
   * @param options `startChunk` to continue reading, `maxChars` to bound the size.
   * @returns The assembled window and its position within the page.
   * @throws PageNotFoundInStoreError when no page matches, with similar pages as suggestions.
   * @throws AmbiguousPageInStoreError when a path matches more than one page.
   */
  async getPageContent(
    library: string,
    version: string | null | undefined,
    pathOrUrl: string,
    options: PageContentOptions = {},
  ): Promise<PageContentResult> {
    const resolvedVersion = await this.resolvePageVersion(library, version);
    const url = await this.findPageUrl(library, resolvedVersion, pathOrUrl);
    const chunks = await this.store.findChunksByUrl(library, resolvedVersion, url);
    const contentType = chunks[0]?.content_type ?? null;
    const strategy = createContentAssemblyStrategy(contentType, this.appConfig);

    const startChunk = options.startChunk ?? 0;
    const maxChars = options.maxChars ?? Number.POSITIVE_INFINITY;
    const window: DbPageChunk[] = [];
    for (const chunk of chunks.slice(startChunk)) {
      // The first chunk is always included so every call makes progress.
      if (
        window.length > 0 &&
        strategy.assembleContent([...window, chunk]).length > maxChars
      ) {
        break;
      }
      window.push(chunk);
    }
    const end = startChunk + window.length;

    return {
      url,
      title: chunks[0]?.title ?? null,
      contentType,
      content: strategy.assembleContent(window),
      startChunk,
      totalChunks: chunks.length,
      nextChunk: end < chunks.length ? end : null,
    };
  }

  /**
   * Lists the stored pages of a library version.
   *
   * @param library Library name.
   * @param version Version or version range; resolved like `searchStore`.
   * @param options `contains` filters URLs; `limit` (default 50) and `offset` paginate.
   * @returns One page of results and whether more follow.
   */
  async listPages(
    library: string,
    version: string | null | undefined,
    options: ListPagesOptions = {},
  ): Promise<ListPagesResult> {
    const resolvedVersion = await this.resolvePageVersion(library, version);
    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;
    const { total, pages } = await this.store.listPages(library, resolvedVersion, {
      contains: options.contains,
      limit,
      offset,
    });
    return {
      library,
      version: resolvedVersion,
      total,
      pages,
      limit,
      offset,
      hasMore: offset + pages.length < total,
    };
  }

  /**
   * Validates the library and resolves the version label whose pages to read.
   */
  private async resolvePageVersion(
    library: string,
    version: string | null | undefined,
  ): Promise<string> {
    await this.validateLibraryExists(library);
    const { bestMatch } = await this.findBestVersion(library, version ?? undefined);
    return bestMatch ?? "";
  }

  /**
   * Resolves a page URL or path to the URL of exactly one stored page.
   *
   * An absolute URL must equal a stored URL; a path must match the end of one.
   * Each is tried as given, spelled the way the scraper stores URLs, and decoded,
   * and then again without its fragment and query.
   */
  private async findPageUrl(
    library: string,
    version: string,
    pathOrUrl: string,
  ): Promise<string> {
    const isAbsolute = /^[a-z][a-z\d+.-]*:\/\//i.test(pathOrUrl);
    const withoutAnchor = pathOrUrl.replace(/[?#].*$/, "");

    for (const input of new Set([pathOrUrl, withoutAnchor])) {
      if (isAbsolute) {
        const [url] = await this.store.findPageUrls(
          library,
          version,
          spellingsOf(input, (value) => normalizeUrl(value, { removeHash: false })),
        );
        if (url) return url;
        continue;
      }

      const suffix = toPathSuffix(input);
      if (!suffix) continue;
      const urls = await this.store.findPageUrlsBySuffix(
        library,
        version,
        spellingsOf(suffix, encodePath),
        MAX_AMBIGUOUS_PAGE_MATCHES,
      );
      if (urls.length === 1) return urls[0];
      if (urls.length > 1) {
        throw new AmbiguousPageInStoreError(library, version, pathOrUrl, urls);
      }
    }

    throw new PageNotFoundInStoreError(
      library,
      version,
      pathOrUrl,
      await this.suggestPages(library, version, withoutAnchor),
    );
  }

  /**
   * Suggests up to three pages for input that matched none: pages whose URL
   * contains its last path segment, or else the top-level pages.
   */
  private async suggestPages(
    library: string,
    version: string,
    input: string,
  ): Promise<string[]> {
    const keyword = input.split("/").filter(Boolean).pop() ?? "";
    if (keyword.length >= 2) {
      const { pages } = await this.store.listPages(library, version, {
        contains: keyword,
        limit: 3,
      });
      if (pages.length > 0) return pages.map((page) => page.url);
    }
    const { pages } = await this.store.listPages(library, version, { limit: 3 });
    return pages.map((page) => page.url);
  }

  // Deprecated simple listing removed: enriched listLibraries() is canonical

  /**
   * Ensures a library and version exist in the database and returns the version ID.
   * Creates the library and version records if they don't exist.
   */
  async ensureLibraryAndVersion(library: string, version: string): Promise<number> {
    // Use the same resolution logic as addDocuments but return the version ID
    const normalizedLibrary = library.toLowerCase();
    const normalizedVersion = normalizeVersionLabel(version);

    // This will create the library and version if they don't exist
    const versionId = await this.store.resolveVersionId(
      normalizedLibrary,
      normalizedVersion,
    );

    return versionId;
  }

  /**
   * Retrieves a version by its ID from the database.
   */
  async getVersionById(versionId: number) {
    return this.store.getVersionById(versionId);
  }

  /**
   * Retrieves a library by its ID from the database.
   */
  async getLibraryById(libraryId: number) {
    return this.store.getLibraryById(libraryId);
  }

  /**
   * Lists stored chunks for a library version with pagination and an optional
   * content filter. Powers the admin dashboard's chunk explorer.
   * @param ref Library/version reference; normalized before querying the store.
   * @param options Pagination (`limit`, defaults to 50; `offset`) and optional content `filter`.
   */
  async listVersionChunks(
    ref: VersionRef,
    options: Partial<ListVersionChunksOptions> = {},
  ): Promise<ListVersionChunksResult> {
    const normalized = normalizeVersionRef(ref);
    return this.store.listVersionChunks(normalized.library, normalized.version, {
      limit: options.limit ?? 50,
      offset: options.offset,
      filter: options.filter,
    });
  }

  /**
   * Computes aggregate chunk/page/embedding statistics for a library version,
   * for the chunk explorer's header strip.
   * @param ref Library/version reference; normalized before querying the store.
   */
  async getVersionStats(ref: VersionRef): Promise<VersionChunkStats> {
    const normalized = normalizeVersionRef(ref);
    return this.store.getVersionStats(normalized.library, normalized.version);
  }

  /**
   * Returns per-day indexing activity across the whole store over a trailing
   * window, derived from stored page/chunk creation timestamps. Powers the
   * Overview "Indexing activity" chart.
   * @param days Window length in days; defaults to 90, clamped to 1..366.
   */
  async getActivityHistory(days = 90): Promise<ActivityHistory> {
    return this.store.getActivityHistory(days);
  }

  /**
   * Computes a per-version content-type breakdown (pages grouped by MIME type)
   * for the library-detail Content types panel.
   * @param ref Library/version reference; normalized before querying the store.
   */
  async getVersionComposition(ref: VersionRef): Promise<VersionComposition> {
    const normalized = normalizeVersionRef(ref);
    return this.store.getVersionComposition(normalized.library, normalized.version);
  }
}
