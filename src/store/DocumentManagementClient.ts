/**
 * Document management backed by a remote worker: every operation calls the
 * worker's application API through a shared {@link ApiClient}.
 */
import type { ScraperOptions } from "../scraper/types";
import type { ApiClient } from "../services/apiClient";
import type { EmbeddingModelConfig } from "./embeddings/EmbeddingConfig";
import type { IDocumentManagement } from "./trpc/interfaces";
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
  PageContentOptions,
  PageContentResult,
  StoredScraperOptions,
  StoreSearchResult,
  VersionChunkStats,
  VersionComposition,
  VersionRef,
  VersionStatus,
} from "./types";

/**
 * Implements {@link IDocumentManagement} by delegating every operation to a
 * remote worker.
 */
export class DocumentManagementClient implements IDocumentManagement {
  /** The worker's last reported embedding config; `undefined` until it answers once. */
  private lastEmbeddingConfig: EmbeddingConfigInfo | null | undefined;

  /** @param client The worker's API client. Whoever created it checks and closes it. */
  constructor(private readonly client: ApiClient) {}

  async listLibraries(): Promise<LibrarySummary[]> {
    return this.client.listLibraries.query();
  }

  async validateLibraryExists(library: string): Promise<void> {
    await this.client.validateLibraryExists.mutate({ library });
  }

  async findBestVersion(
    library: string,
    targetVersion?: string,
  ): Promise<FindVersionResult> {
    return this.client.findBestVersion.query({ library, targetVersion });
  }

  async searchStore(
    library: string,
    version: string | null | undefined,
    query: string,
    limit?: number,
  ): Promise<StoreSearchResult[]> {
    return this.client.search.query({ library, version: version ?? null, query, limit });
  }

  async getPageContent(
    library: string,
    version: string | null | undefined,
    pathOrUrl: string,
    options?: PageContentOptions,
  ): Promise<PageContentResult> {
    return this.client.getPageContent.query({
      library,
      version: version ?? null,
      pathOrUrl,
      options,
    });
  }

  async listPages(
    library: string,
    version: string | null | undefined,
    options?: ListPagesOptions,
  ): Promise<ListPagesResult> {
    return this.client.listPages.query({
      library,
      version: version ?? null,
      options,
    });
  }

  /**
   * Removes the version on the worker the way every entry point removes one:
   * the worker first cancels a queued or running job of its own for it.
   */
  async removeVersion(library: string, version?: string | null): Promise<void> {
    await this.client.removeDocs.mutate({ library, version });
  }

  async removeAllDocuments(library: string, version?: string | null): Promise<void> {
    await this.client.removeAllDocuments.mutate({ library, version: version ?? null });
  }

  async compact(options?: { force?: boolean; vacuum?: boolean }): Promise<CompactResult> {
    return this.client.compact.mutate(options ?? {});
  }

  async getVersionsByStatus(statuses: VersionStatus[]): Promise<DbVersionWithLibrary[]> {
    return this.client.getVersionsByStatus.query({
      statuses: statuses as unknown as string[],
    });
  }

  async findVersionsBySourceUrl(url: string): Promise<DbVersionWithLibrary[]> {
    return this.client.findVersionsBySourceUrl.query({ url });
  }

  async getScraperOptions(versionId: number): Promise<StoredScraperOptions | null> {
    return this.client.getScraperOptions.query({ versionId });
  }

  async updateVersionStatus(
    versionId: number,
    status: VersionStatus,
    errorMessage?: string,
  ): Promise<void> {
    await this.client.updateVersionStatus.mutate({ versionId, status, errorMessage });
  }

  async updateVersionProgress(
    versionId: number,
    pages: number,
    maxPages: number,
  ): Promise<void> {
    await this.client.updateVersionProgress.mutate({ versionId, pages, maxPages });
  }

  async storeScraperOptions(versionId: number, options: ScraperOptions): Promise<void> {
    await this.client.storeScraperOptions.mutate({ versionId, options });
  }

  getActiveEmbeddingConfig(): EmbeddingModelConfig | null {
    // For remote client, embedding config is not available locally.
    // The remote server's embedding status cannot be synchronously queried.
    // Return null to indicate embeddings status is unknown/unavailable.
    return null;
  }

  /**
   * The worker's embedding config, fetched over the wire because that is where
   * embeddings live; the local `getActiveEmbeddingConfig` (null) would misreport
   * "FTS only". The config is fixed for the worker's lifetime, so while the
   * worker does not answer, the last value it reported stands in.
   *
   * @throws Error when the worker does not answer and never has.
   */
  async getEmbeddingConfigInfo(): Promise<EmbeddingConfigInfo | null> {
    try {
      this.lastEmbeddingConfig = await this.client.getEmbeddingConfig.query();
    } catch (error) {
      if (this.lastEmbeddingConfig === undefined) {
        throw error;
      }
    }
    return this.lastEmbeddingConfig;
  }

  async listVersionChunks(
    ref: VersionRef,
    options?: Partial<ListVersionChunksOptions>,
  ): Promise<ListVersionChunksResult> {
    return this.client.listVersionChunks.query({
      library: ref.library,
      version: ref.version,
      limit: options?.limit,
      offset: options?.offset,
      filter: options?.filter,
    });
  }

  async getVersionStats(ref: VersionRef): Promise<VersionChunkStats> {
    return this.client.getVersionStats.query({
      library: ref.library,
      version: ref.version,
    });
  }

  async getActivityHistory(days?: number): Promise<ActivityHistory> {
    return this.client.getActivityHistory.query({ days });
  }

  async getVersionComposition(ref: VersionRef): Promise<VersionComposition> {
    return this.client.getVersionComposition.query({
      library: ref.library,
      version: ref.version,
    });
  }
}
