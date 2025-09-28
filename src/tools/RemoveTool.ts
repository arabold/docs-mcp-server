import type { IPipeline } from "../pipeline/trpc/interfaces";
import { PipelineJobStatus } from "../pipeline/types";
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
  constructor(
    private readonly documentManagementService: IDocumentManagement,
    private readonly pipeline: IPipeline,
  ) {}

  /**
   * Executes the tool to remove the specified library version completely.
   * Aborts any QUEUED/RUNNING job for the same library+version before deleting.
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
      // This will throw if no matching library or version is found
      const result = await this.documentManagementService.findBestVersion(
        library,
        version,
      );

      // For removal, we need an exact match of the requested version
      // Handle the case where version is undefined/empty (unversioned) and bestMatch is null
      const normalizedVersion = version && version.trim() !== "" ? version : null;
      const versionExists =
        result.bestMatch === normalizedVersion ||
        (result.hasUnversioned && normalizedVersion === null);
      if (!versionExists) {
        const versionText = normalizedVersion
          ? `Version ${normalizedVersion}`
          : "Version";
        throw new ToolError(
          `${versionText} not found for library ${library}. Cannot remove non-existent version.`,
          this.constructor.name,
        );
      }

      // Abort any QUEUED or RUNNING job for this library+version
      const allJobs = await this.pipeline.getJobs();
      const jobs = allJobs.filter(
        (job) =>
          job.library === library &&
          job.version === (version ?? "") &&
          (job.status === PipelineJobStatus.QUEUED ||
            job.status === PipelineJobStatus.RUNNING),
      );

      for (const job of jobs) {
        logger.info(
          `🚫 Aborting job for ${library}@${version ?? ""} before deletion: ${job.id}`,
        );
        await this.pipeline.cancelJob(job.id);
        // Wait for job to finish cancelling if running
        await this.pipeline.waitForJobCompletion(job.id);
      }

      // Core logic: Call the document management service to remove the version completely
      await this.documentManagementService.removeVersion(library, version);

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
