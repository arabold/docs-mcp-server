import type { FastifyInstance } from "fastify";
import type { IDocumentManagement } from "../../store/trpc/interfaces";
import { logger } from "../../utils/logger";
import AnalyticsCards from "../components/AnalyticsCards";

/**
 * Registers the API route for analytics stats.
 * @param server - The Fastify instance.
 * @param docService - The document management service for querying library data.
 */
export function registerStatsRoute(
  server: FastifyInstance,
  docService: IDocumentManagement
) {
  server.get("/web/stats", async (_request, reply) => {
    try {
      const libraries = await docService.listLibraries();

      let totalChunks = 0;
      let indexedPages = 0;
      let activeVersions = 0;

      for (const lib of libraries) {
        activeVersions += lib.versions.length;
        for (const version of lib.versions) {
          totalChunks += version.counts.documents;
          indexedPages += version.counts.uniqueUrls;
        }
      }

      const activeLibraries = libraries.length;

      reply.type("text/html; charset=utf-8");
      return (
        <AnalyticsCards
          totalChunks={totalChunks}
          activeLibraries={activeLibraries}
          activeVersions={activeVersions}
          indexedPages={indexedPages}
        />
      );
    } catch (error) {
      logger.error(`Failed to fetch stats: ${error}`);
      reply.status(500).send("Internal Server Error");
    }
  });
}
