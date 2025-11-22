import type { FastifyInstance } from "fastify";
import type { ListLibrariesTool } from "../../../tools/ListLibrariesTool";
import { RemoveTool } from "../../../tools";
import { logger } from "../../../utils/logger";
import LibraryList from "../../components/LibraryList";

/**
 * Registers the API routes for library management.
 * @param server - The Fastify instance.
 * @param listLibrariesTool - The tool instance for listing libraries.
 * @param removeTool - The tool instance for removing library versions.
 */
export function registerLibrariesRoutes(
  server: FastifyInstance,
  listLibrariesTool: ListLibrariesTool,
  removeTool: RemoveTool // Accept RemoveTool
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
      const version = versionParam === "unversioned" ? undefined : versionParam;
      try {
        await removeTool.execute({ library: libraryName, version });
        reply.status(204).send(); // No Content on success

        // Trigger library change event via body custom event
        // The SSE system will pick this up and broadcast to all connected clients
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
}
