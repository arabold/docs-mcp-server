import { describeDocumentationVersion } from "../store/documentationVersions";
import { escapeControlCharacters } from "../store/errors";
import type { IDocumentManagement } from "../store/trpc/interfaces";
import { libraryNamesMatch } from "../store/types";
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

    const resolved = await this.docService.resolveDocumentation(library, targetVersion);
    const bestMatch = resolved.versions.at(0) || null;
    const hasUnversioned = resolved.versions.includes("");
    const label = describeDocumentationVersion(targetVersion, bestMatch);
    const name = escapeControlCharacters(resolved.library);
    const prefix = libraryNamesMatch(library, resolved.library)
      ? ""
      : `Indexed library: ${name}. `;
    const requested = label.requestedVersion
      ? escapeControlCharacters(label.requestedVersion)
      : undefined;
    let message = `No searchable documentation found for ${name}.`;
    if (bestMatch) {
      message = `Best match: ${escapeControlCharacters(bestMatch)}.`;
      if (requested && label.versionMatch === "different") {
        message += ` Requested: ${requested}. Using a different indexed version.`;
      } else if (requested) {
        message += ` Matches requested version ${requested}.`;
      }
      if (hasUnversioned) {
        message += " Unversioned docs also available.";
      }
    } else if (hasUnversioned) {
      const unversioned = "Using unversioned documentation. The source version is unknown.";
      message = requested ? `Requested: ${requested}. ${unversioned}` : unversioned;
    }

    return {
      bestMatch,
      hasUnversioned,
      message: prefix + message,
    };
  }
}
