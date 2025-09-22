import type { IDocumentManagement } from "../store/trpc/interfaces";
import { logger } from "../utils/logger";
import { VersionNotFoundError } from "./errors";

export interface FindVersionToolOptions {
  library: string;
  targetVersion?: string;
}

/**
 * Tool for finding the best matching version of a library in the store.
 * Supports exact version matches and X-Range patterns (e.g., '5.x', '5.2.x').
 */
export class FindVersionTool {
  private docService: IDocumentManagement;

  constructor(docService: IDocumentManagement) {
    this.docService = docService;
  }

  /**
   * Executes the tool to find the best matching version and checks for unversioned docs.
   * @returns A descriptive string indicating the best match and unversioned status, or an error message.
   */
  async execute(options: FindVersionToolOptions): Promise<string> {
    const { library, targetVersion } = options;
    const libraryAndVersion = `${library}${targetVersion ? `@${targetVersion}` : ""}`;

    try {
      const { bestMatch, hasUnversioned } = await this.docService.findBestVersion(
        library,
        targetVersion,
      );

      let message = "";
      if (bestMatch) {
        message = `Best match: ${bestMatch}.`;
        if (hasUnversioned) {
          message += " Unversioned docs also available.";
        }
      } else if (hasUnversioned) {
        message = `No matching version found for ${libraryAndVersion}, but unversioned docs exist.`;
      } else {
        // This case should ideally be caught by VersionNotFoundError below,
        // but added for completeness.
        message = `No matching version or unversioned documents found for ${libraryAndVersion}.`;
      }

      return message;
    } catch (error) {
      if (error instanceof VersionNotFoundError) {
        // This error is thrown when no semver versions AND no unversioned docs exist.
        logger.info(`ℹ️ Version not found: ${error.message}`);
        const message = `No matching version or unversioned documents found for ${libraryAndVersion}. Available: ${
          error.availableVersions.length > 0
            ? error.availableVersions.map((v) => v.version).join(", ")
            : "None"
        }.`;
        return message;
      }
      // Re-throw unexpected errors
      logger.error(
        `❌ Error finding version for ${libraryAndVersion}: ${error instanceof Error ? error.message : error}`,
      );
      throw error;
    }
  }
}
