import type { DocumentManagementService } from "../store";
import type { LibraryVersionDetails, StoreSearchResult } from "../store/types"; // Import LibraryVersionDetails
import { logger } from "../utils/logger";
import { VersionNotFoundError } from "./errors";

export interface SearchToolOptions {
  library: string;
  version?: string;
  query: string;
  limit?: number;
  exactMatch?: boolean;
}

export interface SearchToolResultError {
  message: string;
  availableVersions?: LibraryVersionDetails[]; // Use LibraryVersionDetails
  suggestions?: string[]; // Specific to LibraryNotFoundError
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
  private docService: DocumentManagementService;

  constructor(docService: DocumentManagementService) {
    this.docService = docService;
  }

  async execute(options: SearchToolOptions): Promise<SearchToolResult> {
    const { library, version, query, limit = 5, exactMatch = false } = options;

    // When exactMatch is true, version must be specified and not 'latest'
    if (exactMatch && (!version || version === "latest")) {
      // Get available *detailed* versions for error message
      await this.docService.validateLibraryExists(library);
      // Fetch detailed versions using listLibraries and find the specific library
      const allLibraries = await this.docService.listLibraries();
      const libraryInfo = allLibraries.find((lib) => lib.library === library);
      const detailedVersions = libraryInfo ? libraryInfo.versions : [];
      throw new VersionNotFoundError(
        library,
        "latest", // Or perhaps the original 'version' if it wasn't 'latest'? Check logic.
        detailedVersions,
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
        // If not exact match, find the best version (which might be null)
        const versionResult = await this.docService.findBestVersion(library, version);
        // Use the bestMatch from the result, which could be null
        versionToSearch = versionResult.bestMatch;

        // If findBestVersion returned null (no matching semver) AND unversioned docs exist,
        // should we search unversioned? The current logic passes null to searchStore,
        // which gets normalized to "" (unversioned). This seems reasonable.
        // If findBestVersion threw VersionNotFoundError, it's caught below.
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
