import { VersionNotFoundInStoreError } from "../store";
import type { IDocumentManagement } from "../store/trpc/interfaces";
import type { StoreSearchResult } from "../store/types";
import { logger } from "../utils/logger";
import { ValidationError } from "./errors";

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
  private docService: IDocumentManagement;

  constructor(docService: IDocumentManagement) {
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

    // When exactMatch is true, version must be specified and not 'latest'
    if (exactMatch && (!version || version === "latest")) {
      // Get available *detailed* versions for error message
      await this.docService.validateLibraryExists(library);
      // Fetch detailed versions using listLibraries and find the specific library
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

    // Default to 'latest' only when exactMatch is false
    const resolvedVersion = version || "latest";

    logger.info(
      `🔍 Searching ${library}@${resolvedVersion} for: ${query}${exactMatch ? " (exact match)" : ""}`,
    );

    try {
      // 1. Validate library exists first
      await this.docService.validateLibraryExists(library);

      // 2. Proceed with version finding and searching
      let versionToSearch: string | null | undefined = resolvedVersion;

      if (!exactMatch) {
        // Resolve against what was logged as being searched, so the request the
        // resolver sees and the one reported above cannot drift apart.
        const versionResult = await this.docService.findBestVersion(
          library,
          resolvedVersion,
        );
        // bestMatch is null only when nothing resolved and unversioned content
        // exists; searchStore normalizes null to "" and searches that bucket.
        versionToSearch = versionResult.bestMatch;
      }
      // If exactMatch is true, versionToSearch remains the originally provided version.

      // Note: versionToSearch can be string | null | undefined here.
      // searchStore handles null/undefined by normalizing to "".
      const results = await this.docService.searchStore(
        library,
        versionToSearch,
        query,
        limit,
      );
      logger.info(`✅ Found ${results.length} matching results`);

      return { results };
    } catch (error) {
      logger.error(
        `❌ Search failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      throw error;
    }
  }
}
