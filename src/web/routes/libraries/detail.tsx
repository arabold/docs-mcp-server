import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ListLibrariesTool } from "../../../tools/ListLibrariesTool";
import type { ScrapeTool } from "../../../tools/ScrapeTool";
import type { SearchTool } from "../../../tools/SearchTool";
import type { IDocumentManagement } from "../../../store/trpc/interfaces";
import { logger } from "../../../utils/logger";
import AddVersionButton from "../../components/AddVersionButton";
import Alert from "../../components/Alert";
import Layout from "../../components/Layout";
import LibraryDetailCard from "../../components/LibraryDetailCard";
import VersionDetailsRow from "../../components/VersionDetailsRow";
import LibrarySearchCard from "../../components/LibrarySearchCard";
import SearchResultList from "../../components/SearchResultList";
import SearchResultSkeletonItem from "../../components/SearchResultSkeletonItem";
import ScrapeFormContent from "../../components/ScrapeFormContent";

/**
 * Registers the route for displaying library details.
 * @param server - The Fastify instance.
 * @param listLibrariesTool - The tool instance for listing libraries.
 * @param searchTool - The tool instance for searching documentation.
 * @param scrapeTool - The tool instance for scraping documentation.
 * @param docService - The document management service for getting scraper options.
 */
export function registerLibraryDetailRoutes(
  server: FastifyInstance,
  listLibrariesTool: ListLibrariesTool,
  searchTool: SearchTool,
  scrapeTool: ScrapeTool,
  docService: IDocumentManagement
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
          (lib) => lib.name.toLowerCase() === libraryName.toLowerCase()
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

      // Map "latest" string to undefined for the tool
      const versionParam = version === "latest" ? undefined : version;

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

  // Note: DELETE and REFRESH routes for versions are defined in list.tsx

  // GET route for versions list fragment (for HTMX partial refresh)
  server.get<{ Params: { libraryName: string } }>(
    "/web/libraries/:libraryName/versions-list",
    async (request, reply) => {
      const { libraryName } = request.params;
      try {
        const result = await listLibrariesTool.execute();
        const libraryInfo = result.libraries.find(
          (lib) => lib.name.toLowerCase() === libraryName.toLowerCase()
        );

        if (!libraryInfo) {
          reply.status(404).send("Library not found");
          return;
        }

        const versions = [...(libraryInfo.versions || [])].reverse();

        reply.type("text/html; charset=utf-8");
        if (versions.length === 0) {
          return (
            <p class="text-sm text-gray-500 dark:text-gray-400 italic">
              No versions indexed.
            </p>
          );
        }
        return (
          <>
            {versions.map((v) => {
              const adapted = {
                id: -1,
                ref: { library: libraryInfo.name, version: v.version },
                status: v.status,
                progress: v.progress,
                counts: {
                  documents: v.documentCount,
                  uniqueUrls: v.uniqueUrlCount,
                },
                indexedAt: v.indexedAt,
                sourceUrl: v.sourceUrl ?? undefined,
              };
              return (
                <VersionDetailsRow
                  libraryName={libraryInfo.name}
                  version={adapted}
                  showDelete={true}
                  showRefresh={true}
                />
              );
            })}
          </>
        );
      } catch (error) {
        logger.error(`Failed to fetch versions for ${libraryName}: ${error}`);
        reply.status(500).send("Internal Server Error");
      }
    }
  );

  // GET route for add-version button (closes the form and shows the button again)
  server.get<{ Params: { libraryName: string } }>(
    "/web/libraries/:libraryName/add-version-button",
    async (request, reply) => {
      const { libraryName } = request.params;
      reply.type("text/html; charset=utf-8");
      return <AddVersionButton libraryName={libraryName} />;
    }
  );

  // GET route for add-version form (pre-filled with latest version's config)
  server.get<{ Params: { libraryName: string } }>(
    "/web/libraries/:libraryName/add-version-form",
    async (request, reply) => {
      const { libraryName } = request.params;
      try {
        // Fetch library info to get the latest version
        const result = await listLibrariesTool.execute();
        const libraryInfo = result.libraries.find(
          (lib) => lib.name.toLowerCase() === libraryName.toLowerCase()
        );

        if (!libraryInfo) {
          reply.status(404).send("Library not found");
          return;
        }

        // Get the latest version (versions are sorted, last is latest)
        const versions = libraryInfo.versions || [];
        const latestVersion = versions[versions.length - 1];

        let initialValues: {
          library: string;
          url?: string;
          maxPages?: number;
          maxDepth?: number;
          scope?: string;
          includePatterns?: string;
          excludePatterns?: string;
          scrapeMode?: string;
          headers?: Array<{ name: string; value: string }>;
          followRedirects?: boolean;
          ignoreErrors?: boolean;
        } = {
          library: libraryName,
        };

        // If there's a latest version, fetch its scraper options
        if (latestVersion) {
          const summaries = await docService.listLibraries();
          const libSummary = summaries.find(
            (s) => s.library.toLowerCase() === libraryName.toLowerCase()
          );
          if (libSummary) {
            const versionSummary = libSummary.versions.find(
              (v) =>
                v.ref.version === (latestVersion.version || "") ||
                (!latestVersion.version && v.ref.version === "")
            );
            if (versionSummary) {
              const scraperConfig = await docService.getScraperOptions(
                versionSummary.id
              );
              if (scraperConfig) {
                const opts = scraperConfig.options;
                initialValues = {
                  library: libraryName,
                  url: scraperConfig.sourceUrl,
                  maxPages: opts.maxPages,
                  maxDepth: opts.maxDepth,
                  scope: opts.scope,
                  includePatterns: opts.includePatterns?.join("\n"),
                  excludePatterns: opts.excludePatterns?.join("\n"),
                  scrapeMode: opts.scrapeMode,
                  headers: opts.headers
                    ? Object.entries(opts.headers).map(([name, value]) => ({
                        name,
                        value,
                      }))
                    : undefined,
                  followRedirects: opts.followRedirects,
                  ignoreErrors: opts.ignoreErrors,
                };
              }
            }
          }
        }

        reply.type("text/html; charset=utf-8");
        return (
          <ScrapeFormContent initialValues={initialValues} mode="add-version" />
        );
      } catch (error) {
        logger.error(
          `Failed to load add-version form for ${libraryName}: ${error}`
        );
        reply.type("text/html; charset=utf-8");
        return (
          <Alert type="error" message="Failed to load the add version form." />
        );
      }
    }
  );
}
