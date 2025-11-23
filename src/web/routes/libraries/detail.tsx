import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ListLibrariesTool } from "../../../tools/ListLibrariesTool";
import { SearchTool } from "../../../tools/SearchTool";
import Alert from "../../components/Alert";
import Layout from "../../components/Layout";
import LibraryDetailCard from "../../components/LibraryDetailCard";
import LibrarySearchCard from "../../components/LibrarySearchCard";
import SearchResultList from "../../components/SearchResultList";
import SearchResultSkeletonItem from "../../components/SearchResultSkeletonItem";

/**
 * Registers the route for displaying library details.
 * @param server - The Fastify instance.
 * @param listLibrariesTool - The tool instance for listing libraries.
 * @param searchTool - The tool instance for searching documentation.
 */
export function registerLibraryDetailRoutes(
  server: FastifyInstance,
  listLibrariesTool: ListLibrariesTool,
  searchTool: SearchTool
) {
  // Route for the library detail page
  server.get(
    "/libraries/:libraryName",
    async (
      request: FastifyRequest<{ Params: { libraryName: string } }>,
      reply: FastifyReply
    ) => {
      const { libraryName } = request.params;
      try {
        // Fetch all libraries and find the requested one
        const result = await listLibrariesTool.execute();
        const libraryInfo = result.libraries.find(
          (lib) => lib.name === libraryName
        );

        if (!libraryInfo) {
          reply.status(404).send("Library not found");
          return;
        }

        reply.type("text/html; charset=utf-8");
        // Use the Layout component
        return (
          "<!DOCTYPE html>" +
          (
            <Layout title={`MCP Docs - ${libraryInfo.name}`}>
              {/* Library Detail Card */}
              <LibraryDetailCard library={libraryInfo} />

              {/* Library Search Card */}
              <LibrarySearchCard library={libraryInfo} />

              {/* Search Results Container */}
              <div id="searchResultsContainer">
                {/* Skeleton loader - Initially present */}
                <div class="search-skeleton space-y-2">
                  <SearchResultSkeletonItem />
                  <SearchResultSkeletonItem />
                  <SearchResultSkeletonItem />
                </div>
                {/* Search results will be loaded here via HTMX */}
                <div class="search-results">
                  {/* Initially empty, HTMX will swap content here */}
                </div>
              </div>
            </Layout>
          )
        );
      } catch (error) {
        server.log.error(
          error,
          `Failed to load library details for ${libraryName}`
        );
        reply.status(500).send("Internal Server Error");
      }
    }
  );

  // API route for searching a specific library
  server.get(
    "/web/libraries/:libraryName/search",
    async (
      request: FastifyRequest<{
        Params: { libraryName: string };
        Querystring: { query: string; version?: string };
      }>,
      reply: FastifyReply
    ) => {
      const { libraryName } = request.params;
      const { query, version } = request.query;

      if (!query) {
        reply.status(400).send("Search query is required.");
        return;
      }

      // Map "unversioned" string to undefined for the tool
      const versionParam = version === "unversioned" ? undefined : version;

      try {
        const searchResult = await searchTool.execute({
          library: libraryName,
          query,
          version: versionParam,
          limit: 10, // Limit search results
        });

        // Return only the results list or error message
        reply.type("text/html; charset=utf-8");
        return <SearchResultList results={searchResult.results} />;
      } catch (error) {
        server.log.error(error, `Failed to search library ${libraryName}`);
        // Return error message using Alert component
        reply.type("text/html; charset=utf-8");
        const errorMessage =
          error instanceof Error
            ? error.message
            : "An unexpected error occurred during the search.";
        return <Alert type="error" message={errorMessage} />;
      }
    }
  );
}
