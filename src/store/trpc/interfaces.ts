/**
 * Interface for document management operations exposed externally.
 * Implemented by the local DocumentManagementService and the remote tRPC client.
 */
import type { ScraperOptions } from "../../scraper/types";
import type { EmbeddingModelConfig } from "../embeddings/EmbeddingConfig";
import type {
  ActivityHistory,
  CompactResult,
  DbVersionWithLibrary,
  EmbeddingConfigInfo,
  FindVersionResult,
  LibrarySummary,
  ListPagesOptions,
  ListPagesResult,
  ListVersionChunksOptions,
  ListVersionChunksResult,
  PageContentResult,
  StoredScraperOptions,
  StoreSearchResult,
  VersionChunkStats,
  VersionComposition,
  VersionRef,
  VersionStatus,
} from "../types";

export interface IDocumentManagement {
  // Lifecycle
  initialize(): Promise<void>;
  shutdown(): Promise<void>;

  // Library/version introspection used by tools/UI
  listLibraries(): Promise<LibrarySummary[]>;
  validateLibraryExists(library: string): Promise<void>;
  findBestVersion(library: string, targetVersion?: string): Promise<FindVersionResult>;
  listPages(
    library: string,
    version: string | null | undefined,
    options?: ListPagesOptions,
  ): Promise<ListPagesResult>;

  // Search & mutation used by tools/UI
  searchStore(
    library: string,
    version: string | null | undefined,
    query: string,
    limit?: number,
  ): Promise<StoreSearchResult[]>;
  getPageContent(
    library: string,
    version: string | null | undefined,
    pathOrUrl: string,
    options?: { maxChars?: number },
  ): Promise<PageContentResult>;
  removeAllDocuments(library: string, version?: string | null): Promise<void>;
  removeVersion(library: string, version?: string | null): Promise<void>;
  /**
   * Reclaims unused SQLite pages and truncates the WAL file.
   * VACUUM takes an exclusive lock and may block searches until it finishes.
   * @param options.force Always VACUUM even if no free pages are detected.
   * @param options.vacuum When `false`, only run a non-blocking WAL checkpoint.
   */
  compact(options?: { force?: boolean; vacuum?: boolean }): Promise<CompactResult>;

  // Minimal set used indirectly by pipeline/UI where needed
  getVersionsByStatus(statuses: VersionStatus[]): Promise<DbVersionWithLibrary[]>;
  findVersionsBySourceUrl(url: string): Promise<DbVersionWithLibrary[]>;
  getScraperOptions(versionId: number): Promise<StoredScraperOptions | null>;
  updateVersionStatus(
    versionId: number,
    status: VersionStatus,
    errorMessage?: string,
  ): Promise<void>;
  updateVersionProgress(
    versionId: number,
    pages: number,
    maxPages: number,
  ): Promise<void>;
  storeScraperOptions(versionId: number, options: ScraperOptions): Promise<void>;

  // Embedding configuration
  getActiveEmbeddingConfig(): EmbeddingModelConfig | null;
  /**
   * Serializable embedding config for the system-health snapshot. Async so a
   * remote client can fetch the worker's config over the wire (the local
   * `getActiveEmbeddingConfig` returns null for a remote worker).
   */
  getEmbeddingConfigInfo(): Promise<EmbeddingConfigInfo | null>;

  // Chunk explorer support (admin UI)
  listVersionChunks(
    ref: VersionRef,
    options?: Partial<ListVersionChunksOptions>,
  ): Promise<ListVersionChunksResult>;
  getVersionStats(ref: VersionRef): Promise<VersionChunkStats>;
  getActivityHistory(days?: number): Promise<ActivityHistory>;
  getVersionComposition(ref: VersionRef): Promise<VersionComposition>;
}
