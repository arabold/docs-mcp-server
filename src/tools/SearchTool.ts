import {
  LibraryNotFoundInStoreError,
  VersionNotFoundInStoreError,
} from "../store/errors";
import type { IDocumentManagement } from "../store/trpc/interfaces";
import type { StoreSearchResult } from "../store/types";
import { logger } from "../utils/logger";
import { ToolError, ValidationError } from "./errors";

export interface SearchToolOptions {
  library: string;
  version?: string;
  query: string;
  limit?: number;
  exactMatch?: boolean;
}

export interface SearchToolResultError {
  message: string;
  availableVersions?: Array<{
    version: string;
    documentCount: number;
    uniqueUrlCount: number;
    indexedAt: string | null;
  }>;
  suggestions?: string[]; // Specific to LibraryNotFoundInStoreError
}

export interface SearchToolResult {
  results: StoreSearchResult[];
}

/**
 * Tool for searching indexed documentation.
 * Supports exact version matches and version range patterns.
 * Returns available versions when requested version is not found.
 */
export class SearchTool {
  private docService: Pick<
    IDocumentManagement,
    "validateLibraryExists" | "listLibraries" | "findBestVersion" | "searchStore"
  >;

  constructor(
    docService: Pick<
      IDocumentManagement,
      "validateLibraryExists" | "listLibraries" | "findBestVersion" | "searchStore"
    >,
  ) {
    this.docService = docService;
  }

  async execute(options: SearchToolOptions): Promise<SearchToolResult> {
    const { library, version, query, limit = 5, exactMatch = false } = options;

    // Validate required inputs
    if (!library || typeof library !== "string" || library.trim() === "") {
      throw new ValidationError(
        "Library name is required and must be a non-empty string.",
        this.constructor.name,
      );
    }

    if (!query || typeof query !== "string" || query.trim() === "") {
      throw new ValidationError(
        "Query is required and must be a non-empty string.",
        this.constructor.name,
      );
    }

    if (limit !== undefined && (typeof limit !== "number" || limit < 1 || limit > 100)) {
      throw new ValidationError(
        "Limit must be a number between 1 and 100.",
        this.constructor.name,
      );
    }

    // Default to 'latest' only when exactMatch is false
    const resolvedVersion = version || "latest";

    logger.info(
      `🔍 Searching ${library}@${resolvedVersion}${exactMatch ? " (exact match)" : ""}`,
    );

    let failureStage = "library validation";
    try {
      // When exactMatch is true, version must be specified and not 'latest'
      if (exactMatch && (!version || version === "latest")) {
        await this.docService.validateLibraryExists(library);
        failureStage = "version resolution";
        const allLibraries = await this.docService.listLibraries();
        const libraryInfo = allLibraries.find((lib) => lib.library === library);
        const availableVersions = libraryInfo
          ? libraryInfo.versions.map((v) => v.ref.version)
          : [];
        throw new VersionNotFoundInStoreError(
          library,
          version ?? "latest",
          availableVersions,
        );
      }

      // 1. Validate library exists first
      await this.docService.validateLibraryExists(library);

      // 2. Proceed with version finding and searching
      let versionToSearch: string | null | undefined = resolvedVersion;

      if (!exactMatch) {
        failureStage = "version resolution";
        // If not exact match, find the best version (which might be null)
        const versionResult = await this.docService.findBestVersion(library, version);
        // Use the bestMatch from the result, which could be null
        versionToSearch = versionResult.bestMatch;

        // If findBestVersion returned null (no matching semver) AND unversioned docs exist,
        // should we search unversioned? The current logic passes null to searchStore,
        // which gets normalized to "" (unversioned). This seems reasonable.
        // If findBestVersion threw VersionNotFoundInStoreError, it's caught below.
      }
      // If exactMatch is true, versionToSearch remains the originally provided version.

      // Note: versionToSearch can be string | null | undefined here.
      // searchStore handles null/undefined by normalizing to "".
      failureStage = "document retrieval";
      const results = await this.docService.searchStore(
        library,
        versionToSearch,
        query,
        limit,
      );
      logger.info(`✅ Found ${results.length} matching results`);

      return { results };
    } catch (error) {
      logger.error(`❌ Search failed during ${failureStage}`);
      if (
        error instanceof LibraryNotFoundInStoreError ||
        error instanceof VersionNotFoundInStoreError
      ) {
        throw error;
      }
      throw new ToolError(`Search failed during ${failureStage}`, this.constructor.name);
    }
  }
}
