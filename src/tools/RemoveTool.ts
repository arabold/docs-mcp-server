import type { IPipeline } from "../pipeline/trpc/interfaces";
import type { IDocumentManagement } from "../store/trpc/interfaces";
import { logger } from "../utils/logger";
import { ToolError, ValidationError } from "./errors";

/**
 * Represents the arguments for the remove_docs tool.
 * The MCP server should validate the input against RemoveToolInputSchema before calling execute.
 */
export interface RemoveToolArgs {
  library: string;
  version?: string;
}

/**
 * Tool to remove indexed documentation for a specific library version.
 * This class provides the core logic, intended to be called by the McpServer.
 */
export class RemoveTool {
  /**
   * @param documentManagementService Checks the library exists, and removes the
   *   version when there is no pipeline.
   * @param pipeline Cancels its job for the version and removes it. Without one
   *   nothing is cancelled here: a CLI process runs no jobs, and a remote store
   *   has the worker cancel its own job when it removes the version.
   */
  constructor(
    private readonly documentManagementService: IDocumentManagement,
    private readonly pipeline: IPipeline | undefined,
  ) {}

  /**
   * Executes the tool to remove the specified library version completely.
   * Stops the version's jobs and waits until they have ended before deleting,
   * when there is a pipeline to see them.
   * Removes all documents, the version record, and the library if no other versions exist.
   */
  async execute(args: RemoveToolArgs): Promise<{ message: string }> {
    const { library, version } = args;

    // Validate input
    if (!library || typeof library !== "string" || library.trim() === "") {
      throw new ValidationError(
        "Library name is required and must be a non-empty string.",
        this.constructor.name,
      );
    }

    logger.info(`🗑️ Removing library: ${library}${version ? `@${version}` : ""}`);

    try {
      // Validate that the library exists before attempting removal
      await this.documentManagementService.validateLibraryExists(library);

      // The pipeline cancels its job for the version and removes it, locked
      // against an enqueue of the same version. Without one, this process runs
      // no jobs, and a remote store has the worker do the same.
      await (this.pipeline ?? this.documentManagementService).removeVersion(
        library,
        version,
      );

      const message = `Successfully removed ${library}${version ? `@${version}` : ""}.`;
      logger.info(`✅ ${message}`);
      // Return a simple success object, the McpServer will format the final response
      return { message };
    } catch (error) {
      // If it's already a ToolError or other known error types, re-throw as is
      if (error instanceof ToolError) {
        throw error;
      }

      const errorMessage = `Failed to remove ${library}${version ? `@${version}` : ""}: ${error instanceof Error ? error.message : String(error)}`;
      logger.error(`❌ Error removing library: ${errorMessage}`);
      // Re-throw the error for the McpServer to handle and format
      throw new ToolError(errorMessage, this.constructor.name);
    }
  }
}
