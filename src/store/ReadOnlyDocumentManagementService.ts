import path from "node:path";
import Fuse from "fuse.js";
import semver from "semver";
import type { AppConfig } from "../utils/config";
import { logger } from "../utils/logger";
import { sortVersionsDescending } from "../utils/version";
import { DocumentRetrieverService } from "./DocumentRetrieverService";
import { DocumentStore } from "./DocumentStore";
import { LibraryNotFoundInStoreError, VersionNotFoundInStoreError } from "./errors";
import type {
  FindVersionResult,
  LibrarySummary,
  StoreSearchResult,
  VersionStatus,
  VersionSummary,
} from "./types";

/** Read operations required by the read-only MCP extension. */
export interface ReadOnlyDocumentManagement {
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  listLibraries(): Promise<LibrarySummary[]>;
  validateLibraryExists(library: string): Promise<void>;
  findBestVersion(library: string, targetVersion?: string): Promise<FindVersionResult>;
  searchStore(
    library: string,
    version: string | null | undefined,
    query: string,
    limit?: number,
  ): Promise<StoreSearchResult[]>;
}

/**
 * Provides indexed-document reads without importing scraper pipelines or opening SQLite
 * with write access.
 */
export class ReadOnlyDocumentManagementService implements ReadOnlyDocumentManagement {
  private readonly store: DocumentStore;
  private readonly retriever: DocumentRetrieverService;

  constructor(appConfig: AppConfig) {
    const storePath = appConfig.app.storePath;
    if (!storePath) {
      throw new Error("storePath is required for the read-only MCP extension");
    }
    const dbPath = path.join(storePath, "documents.db");
    this.store = new DocumentStore(dbPath, appConfig, { readOnly: true });
    this.retriever = new DocumentRetrieverService(this.store, appConfig);
  }

  async initialize(): Promise<void> {
    await this.store.initialize();
  }

  async shutdown(): Promise<void> {
    await this.store.shutdown();
  }

  async listLibraries(): Promise<LibrarySummary[]> {
    const libraryVersions = await this.store.queryLibraryVersions();
    const summaries: LibrarySummary[] = [];
    for (const [library, versions] of libraryVersions) {
      const versionSummaries = await Promise.all(
        versions.map(async (version) => {
          const scraperOptions = await this.store.getScraperOptions(version.versionId);
          return {
            id: version.versionId,
            ref: { library, version: version.version },
            status: version.status as VersionStatus,
            errorMessage: version.errorMessage,
            progress:
              version.status === "completed"
                ? undefined
                : {
                    pages: version.progressPages,
                    maxPages: version.progressMaxPages,
                  },
            counts: {
              documents: version.documentCount,
              uniqueUrls: version.uniqueUrlCount,
            },
            indexedAt: version.indexedAt,
            sourceUrl: version.sourceUrl ?? undefined,
            preserveHashes: scraperOptions?.options.preserveHashes,
          } satisfies VersionSummary;
        }),
      );
      summaries.push({ library, versions: versionSummaries });
    }
    return summaries;
  }

  async validateLibraryExists(library: string): Promise<void> {
    if (await this.store.getLibrary(library)) return;

    const names = (await this.listLibraries()).map((entry) => entry.library);
    const suggestions = new Fuse(names, { threshold: 0.7 })
      .search(library.toLowerCase())
      .slice(0, 3)
      .map((result) => result.item);
    throw new LibraryNotFoundInStoreError(library, suggestions);
  }

  async findBestVersion(
    library: string,
    targetVersion?: string,
  ): Promise<FindVersionResult> {
    const hasUnversioned = await this.store.checkDocumentExists(library, "");
    const versions = sortVersionsDescending(
      (await this.store.queryUniqueVersions(library)).filter((version) =>
        semver.valid(version),
      ),
    );

    if (versions.length === 0) {
      if (hasUnversioned) return { bestMatch: null, hasUnversioned: true };
      await this.validateLibraryExists(library);
      throw new LibraryNotFoundInStoreError(library, []);
    }

    let bestMatch: string | null = null;
    if (!targetVersion || targetVersion === "latest") {
      bestMatch = semver.maxSatisfying(versions, "*");
    } else {
      const versionRegex = /^(\d+)(?:\.(?:x(?:\.x)?|\d+(?:\.(?:x|\d+))?))?$|^$/;
      if (semver.valid(targetVersion) || versionRegex.test(targetVersion)) {
        let range = targetVersion;
        if (!semver.validRange(targetVersion)) range = `~${targetVersion}`;
        else if (semver.valid(targetVersion)) range = `${range} || <=${targetVersion}`;
        bestMatch = semver.maxSatisfying(versions, range);
      }
    }

    if (!bestMatch && !hasUnversioned) {
      const details = (await this.store.queryLibraryVersions()).get(library) ?? [];
      throw new VersionNotFoundInStoreError(
        library,
        targetVersion ?? "",
        details.map((version) => version.version),
      );
    }

    return { bestMatch, hasUnversioned };
  }

  async searchStore(
    library: string,
    version: string | null | undefined,
    query: string,
    limit = 5,
  ): Promise<StoreSearchResult[]> {
    logger.debug(`Read-only search in ${library}`);
    return this.retriever.search(library, (version ?? "").toLowerCase(), query, limit);
  }
}
