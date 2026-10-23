import type { IDocumentManagement } from "../store/trpc/interfaces";
import { logger } from "../utils/logger";
import { ToolError, ValidationError } from "./errors";

/**
 * Represents the arguments for the rename operation.
 * Callers validate the input before calling execute.
 */
export interface RenameToolArgs {
  library: string;
  newName: string;
}

/**
 * Tool to rename a library in place, keeping its versions and indexed content.
 * Shared by the CLI; the store refuses the rename while a job writes into the library.
 */
export class RenameTool {
  /**
   * @param documentManagementService Renames the library, locally or against a worker.
   */
  constructor(private readonly documentManagementService: IDocumentManagement) {}

  /**
   * Executes the rename of the specified library.
   * Names are compared case-insensitively, so a case-only change updates the display name.
   */
  async execute(args: RenameToolArgs): Promise<{ message: string }> {
    const { library, newName } = args;

    // Validate input
    if (!library || typeof library !== "string" || library.trim() === "") {
      throw new ValidationError(
        "Library name is required and must be a non-empty string.",
        this.constructor.name,
      );
    }
    if (!newName || typeof newName !== "string" || newName.trim() === "") {
      throw new ValidationError(
        "The new name is required and must be a non-empty string.",
        this.constructor.name,
      );
    }

    logger.info(`✏️ Renaming library: ${library} -> ${newName}`);

    try {
      // Validate that the library exists before attempting the rename
      await this.documentManagementService.validateLibraryExists(library);

      const { oldName, newName: renamed } =
        await this.documentManagementService.renameLibrary(library, newName);

      const message = `Successfully renamed ${oldName} to ${renamed}.`;
      logger.info(`✅ ${message}`);
      // Return a simple success object, the caller formats the final response
      return { message };
    } catch (error) {
      // If it's already a ToolError or other known error types, re-throw as is
      if (error instanceof ToolError) {
        throw error;
      }

      const errorMessage = `Failed to rename ${library} to ${newName}: ${error instanceof Error ? error.message : String(error)}`;
      logger.error(`❌ Error renaming library: ${errorMessage}`);
      throw new ToolError(errorMessage, this.constructor.name);
    }
  }
}
