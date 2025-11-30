import type { FastifyInstance } from "fastify";
import type { ListLibrariesTool } from "../../../tools/ListLibrariesTool";
import type { RefreshVersionTool } from "../../../tools/RefreshVersionTool";
import { RemoveTool } from "../../../tools";
import { logger } from "../../../utils/logger";
import LibraryList from "../../components/LibraryList";

/**
 * Registers the API routes for library management.
 * @param server - The Fastify instance.
 * @param listLibrariesTool - The tool instance for listing libraries.
 * @param removeTool - The tool instance for removing library versions.
 * @param refreshVersionTool - The tool instance for refreshing library versions.
 */
export function registerLibrariesRoutes(
  server: FastifyInstance,
  listLibrariesTool: ListLibrariesTool,
  removeTool: RemoveTool,
  refreshVersionTool: RefreshVersionTool
) {
  server.get("/web/libraries", async (_request, reply) => {
    // Add reply
    try {
      const result = await listLibrariesTool.execute();
      // Set content type to HTML for JSX rendering
      reply.type("text/html; charset=utf-8");
      // Render the component directly
      return <LibraryList libraries={result.libraries} />;
    } catch (error) {
      logger.error(`Failed to list libraries: ${error}`);
      reply.status(500).send("Internal Server Error"); // Handle errors
    }
  });

  // Add DELETE route for removing versions
  server.delete<{ Params: { libraryName: string; versionParam: string } }>(
    "/web/libraries/:libraryName/versions/:versionParam",
    async (request, reply) => {
      const { libraryName, versionParam } = request.params;
      const version = versionParam === "latest" ? undefined : versionParam;
      try {
        await removeTool.execute({ library: libraryName, version });

        // Check if the library still exists after deletion
        const result = await listLibrariesTool.execute();
        const libraryStillExists = result.libraries.some(
          (lib) => lib.name.toLowerCase() === libraryName.toLowerCase()
        );

        if (!libraryStillExists) {
          // Library was deleted (last version removed) - redirect to main list
          reply.header("HX-Redirect", "/");
        }

        reply.status(204).send(); // No Content on success
      } catch (error: any) {
        logger.error(
          `Failed to remove ${libraryName}@${versionParam}: ${error}`
        );
        // Check for specific errors if needed, e.g., NotFoundError
        reply
          .status(500)
          .send({ message: error.message || "Failed to remove version." });
      }
    }
  );

  // POST route for refreshing a version
  server.post<{ Params: { libraryName: string; versionParam: string } }>(
    "/web/libraries/:libraryName/versions/:versionParam/refresh",
    async (request, reply) => {
      const { libraryName, versionParam } = request.params;
      const version =
        versionParam === "latest" || versionParam === ""
          ? undefined
          : versionParam;
      try {
        // Start refresh without waiting for completion
        await refreshVersionTool.execute({
          library: libraryName,
          version,
          waitForCompletion: false,
        });
        // Show toast notification via HX-Trigger
        const versionDisplay = version || "latest";
        reply.header(
          "HX-Trigger",
          JSON.stringify({
            toast: {
              message: `Refresh started for ${libraryName}@${versionDisplay}`,
              type: "success",
            },
          })
        );
        // Return empty response - the button will reset via Alpine.js
        reply.status(204).send();
      } catch (error: unknown) {
        logger.error(
          `Failed to refresh ${libraryName}@${versionParam}: ${error}`
        );
        const errorMessage =
          error instanceof Error ? error.message : "Failed to refresh version.";
        // Show error toast via HX-Trigger
        reply.header(
          "HX-Trigger",
          JSON.stringify({
            toast: {
              message: errorMessage,
              type: "error",
            },
          })
        );
        reply.status(500).send();
      }
    }
  );
}
