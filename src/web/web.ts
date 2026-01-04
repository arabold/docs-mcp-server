import path from "node:path";
import formBody from "@fastify/formbody";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import type { PipelineManager } from "../pipeline/PipelineManager";
import type { DocumentManagementService } from "../store/DocumentManagementService";
import { SearchTool } from "../tools";
import { CancelJobTool } from "../tools/CancelJobTool";
import { ClearCompletedJobsTool } from "../tools/ClearCompletedJobsTool";
import { ListJobsTool } from "../tools/ListJobsTool";
import { ListLibrariesTool } from "../tools/ListLibrariesTool";
import { RefreshVersionTool } from "../tools/RefreshVersionTool";
import { RemoveTool } from "../tools/RemoveTool";
import { ScrapeTool } from "../tools/ScrapeTool";
import type { AppConfig } from "../utils/config";
import { logger } from "../utils/logger";
import { getProjectRoot } from "../utils/paths";
import { registerIndexRoute } from "./routes/index";
import { registerCancelJobRoute } from "./routes/jobs/cancel";
import { registerClearCompletedJobsRoute } from "./routes/jobs/clear-completed";
import { registerJobListRoutes } from "./routes/jobs/list";
import { registerNewJobRoutes } from "./routes/jobs/new";
import { registerLibraryDetailRoutes } from "./routes/libraries/detail";
import { registerLibrariesRoutes } from "./routes/libraries/list";

/**
 * Initializes the Fastify web server instance.
 *
 * @param port The port number for the web server.
 * @param docService The document management service instance.
 * @param pipelineManager The pipeline manager instance.
 * @returns The initialized Fastify server instance.
 */
export async function startWebServer(
  port: number,
  docService: DocumentManagementService,
  pipelineManager: PipelineManager,
  config: AppConfig,
): Promise<FastifyInstance> {
  const server = Fastify({
    logger: false, // Use our own logger instead
  });

  // Register plugins
  await server.register(formBody); // Register formbody to parse form data

  // Instantiate tools using provided services
  const listLibrariesTool = new ListLibrariesTool(docService);
  const listJobsTool = new ListJobsTool(pipelineManager);
  const scrapeTool = new ScrapeTool(pipelineManager, config.scraper);
  const removeTool = new RemoveTool(docService, pipelineManager);
  const searchTool = new SearchTool(docService);
  const cancelJobTool = new CancelJobTool(pipelineManager);
  const clearCompletedJobsTool = new ClearCompletedJobsTool(pipelineManager);
  const refreshVersionTool = new RefreshVersionTool(pipelineManager);

  // Register static file serving
  await server.register(fastifyStatic, {
    // Use project root to construct absolute path to public directory
    root: path.join(getProjectRoot(), "public"),
    prefix: "/",
    index: false, // Disable automatic index.html serving
  });

  // Register routes
  registerIndexRoute(server); // Register the root route first
  registerJobListRoutes(server, listJobsTool);
  registerNewJobRoutes(server, scrapeTool, config.scraper);
  registerCancelJobRoute(server, cancelJobTool);
  registerClearCompletedJobsRoute(server, clearCompletedJobsTool);
  registerLibrariesRoutes(server, listLibrariesTool, removeTool, refreshVersionTool);
  registerLibraryDetailRoutes(
    server,
    listLibrariesTool,
    searchTool,
    scrapeTool,
    docService,
  );

  // Graceful shutdown of services will be handled by the caller (src/index.ts)

  try {
    const address = await server.listen({ port, host: "0.0.0.0" });
    logger.info(`🚀 Web UI available at ${address}`);
    return server; // Return the server instance
  } catch (error) {
    logger.error(`❌ Failed to start web UI: ${error}`);
    // Ensure server is closed if listen fails but initialization succeeded partially
    await server.close();
    throw error;
  }
}

/**
 * Stops the provided Fastify web server instance.
 *
 * @param server - The Fastify server instance to stop.
 */
export async function stopWebServer(server: FastifyInstance): Promise<void> {
  try {
    await server.close();
    logger.info("🛑 Web UI stopped.");
  } catch (error) {
    logger.error(`❌ Failed to stop web server gracefully: ${error}`);
    // Rethrow or handle as needed, but ensure the process doesn't hang
    throw error;
  }
}
