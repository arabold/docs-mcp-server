/**
 * Interface for document management operations exposed externally.
 * Implemented by the local DocumentManagementService and the remote tRPC client.
 */
import type { Document } from "@langchain/core/documents";
import type { ScraperOptions } from "../../scraper/types";
import type {
  DbVersionWithLibrary,
  FindVersionResult,
  LibrarySummary,
  StoredScraperOptions,
  StoreSearchResult,
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

  // Search & mutation used by tools/UI
  searchStore(
    library: string,
    version: string | null | undefined,
    query: string,
    limit?: number,
  ): Promise<StoreSearchResult[]>;
  removeAllDocuments(library: string, version?: string | null): Promise<void>;
  removeVersion(library: string, version?: string | null): Promise<void>;
  addDocument(
    library: string,
    version: string | null | undefined,
    document: Document,
  ): Promise<void>;

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
}
