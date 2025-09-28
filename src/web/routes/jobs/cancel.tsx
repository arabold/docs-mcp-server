import type { FastifyInstance } from "fastify";
import type { CancelJobTool } from "../../../tools/CancelJobTool";
import { ToolError } from "../../../tools/errors";

/**
 * Registers the API route for cancelling jobs.
 * @param server - The Fastify instance.
 * @param cancelJobTool - The tool instance for cancelling jobs.
 */
export function registerCancelJobRoute(
  server: FastifyInstance,
  cancelJobTool: CancelJobTool
) {
  // POST /web/jobs/:jobId/cancel - Cancel a job by ID
  server.post<{ Params: { jobId: string } }>(
    "/web/jobs/:jobId/cancel",
    async (request, reply) => {
      const { jobId } = request.params;
      try {
        await cancelJobTool.execute({ jobId });
        return { success: true, message: "Job cancelled successfully" };
      } catch (error) {
        if (error instanceof ToolError) {
          reply.status(400);
          return { success: false, message: error.message };
        } else {
          reply.status(500);
          return { success: false, message: "Internal server error" };
        }
      }
    }
  );
}
