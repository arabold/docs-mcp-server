/**
 * tRPC client for the document management API.
 * Implements IDocumentManagement and delegates to /api data router.
 */
import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import type { ScraperOptions } from "../scraper/types";
import { logger } from "../utils/logger";
import type { EmbeddingModelConfig } from "./embeddings/EmbeddingConfig";
import type { IDocumentManagement } from "./trpc/interfaces";
import type { DataRouter } from "./trpc/router";
import type {
  DbVersionWithLibrary,
  FindVersionResult,
  LibrarySummary,
  StoredScraperOptions,
  StoreSearchResult,
  VersionStatus,
} from "./types";

export class DocumentManagementClient implements IDocumentManagement {
  private readonly baseUrl: string;
  private readonly client: ReturnType<typeof createTRPCProxyClient<DataRouter>>;

  constructor(serverUrl: string) {
    this.baseUrl = serverUrl.replace(/\/$/, "");
    this.client = createTRPCProxyClient<DataRouter>({
      links: [
        httpBatchLink({
          url: this.baseUrl,
          transformer: superjson,
        }),
      ],
    });
    logger.debug(`DocumentManagementClient (tRPC) created for: ${this.baseUrl}`);
  }

  async initialize(): Promise<void> {
    // Connectivity check using ping procedure
    try {
      await this.client.ping.query();
    } catch (error) {
      logger.debug(
        `Failed to connect to DocumentManagement server at ${this.baseUrl}: ${error}`,
      );
      throw new Error(
        `Failed to connect to server at ${this.baseUrl}.\n\nPlease verify the server URL includes the correct port (default 8080) and ends with '/api' (e.g., 'http://localhost:8080/api').`,
      );
    }
  }

  async shutdown(): Promise<void> {
    // no-op for HTTP client
  }

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

  async removeVersion(library: string, version?: string | null): Promise<void> {
    await this.client.removeVersion.mutate({ library, version });
  }

  async removeAllDocuments(library: string, version?: string | null): Promise<void> {
    await this.client.removeAllDocuments.mutate({ library, version: version ?? null });
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
}
