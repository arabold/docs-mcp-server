import type { FastifyInstance } from "fastify";
import type { ListJobsTool } from "../../../tools/ListJobsTool";
import JobList from "../../components/JobList"; // Import the extracted component

/**
 * Registers the API route for listing jobs.
 * @param server - The Fastify instance.
 * @param listJobsTool - The tool instance for listing jobs.
 */
export function registerJobListRoutes(
  server: FastifyInstance,
  listJobsTool: ListJobsTool
) {
  // GET /web/jobs - List current jobs (only the list)
  server.get("/web/jobs", async () => {
    const result = await listJobsTool.execute({});
    return <JobList jobs={result.jobs} />;
  });
}
