import type { FastifyInstance } from "fastify";
import type { ClearCompletedJobsTool } from "../../../tools/ClearCompletedJobsTool";
import { ToolError } from "../../../tools/errors";

/**
 * Registers the API route for clearing completed jobs.
 * @param server - The Fastify instance.
 * @param clearCompletedJobsTool - The tool instance for clearing completed jobs.
 */
export function registerClearCompletedJobsRoute(
  server: FastifyInstance,
  clearCompletedJobsTool: ClearCompletedJobsTool
) {
  // POST /web/jobs/clear-completed - Clear all completed jobs
  server.post("/web/jobs/clear-completed", async (_, reply) => {
    try {
      await clearCompletedJobsTool.execute({});

      reply.type("application/json");
      return {
        success: true,
        message: "Completed jobs cleared successfully",
      };
    } catch (error) {
      if (error instanceof ToolError) {
        reply.code(400);
        return {
          success: false,
          message: error.message,
        };
      } else {
        reply.code(500);
        return {
          success: false,
          message: `Internal server error: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }
  });
}
