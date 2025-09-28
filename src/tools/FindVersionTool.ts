import type { IDocumentManagement } from "../store/trpc/interfaces";
import { ValidationError } from "./errors";

export interface FindVersionToolOptions {
  library: string;
  targetVersion?: string;
}

export interface FindVersionToolResult {
  bestMatch: string | null;
  hasUnversioned: boolean;
  message: string;
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
   * @returns A structured object with the best match, unversioned status, and descriptive message.
   * @throws {ValidationError} If the library parameter is invalid.
   * @throws {VersionNotFoundInStoreError} If no matching versions or unversioned docs are found.
   */
  async execute(options: FindVersionToolOptions): Promise<FindVersionToolResult> {
    const { library, targetVersion } = options;

    // Validate input
    if (!library || typeof library !== "string" || library.trim() === "") {
      throw new ValidationError(
        "Library name is required and must be a non-empty string.",
        this.constructor.name,
      );
    }

    const libraryAndVersion = `${library}${targetVersion ? `@${targetVersion}` : ""}`;

    // Let VersionNotFoundInStoreError bubble up instead of catching it
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
      // This case should ideally be caught by VersionNotFoundInStoreError,
      // but added for completeness.
      message = `No matching version or unversioned documents found for ${libraryAndVersion}.`;
    }

    return {
      bestMatch,
      hasUnversioned,
      message,
    };
  }
}
