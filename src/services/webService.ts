/**
 * Web service that registers all web interface routes for human interaction.
 * Extracted from src/web/web.ts to enable modular server composition.
 */

import type { FastifyInstance } from "fastify";
import type { EventBusService } from "../events/EventBusService";
import type { IPipeline } from "../pipeline/trpc/interfaces";
import type { IDocumentManagement } from "../store/trpc/interfaces";
import { SearchTool } from "../tools";
import { CancelJobTool } from "../tools/CancelJobTool";
import { ClearCompletedJobsTool } from "../tools/ClearCompletedJobsTool";
import { ListJobsTool } from "../tools/ListJobsTool";
import { ListLibrariesTool } from "../tools/ListLibrariesTool";
import { RefreshVersionTool } from "../tools/RefreshVersionTool";
import { RemoveTool } from "../tools/RemoveTool";
import { ScrapeTool } from "../tools/ScrapeTool";
import type { AppConfig } from "../utils/config";
import { registerEventsRoute } from "../web/routes/events";
import { registerIndexRoute } from "../web/routes/index";
import { registerCancelJobRoute } from "../web/routes/jobs/cancel";
import { registerClearCompletedJobsRoute } from "../web/routes/jobs/clear-completed";
import { registerJobListRoutes } from "../web/routes/jobs/list";
import { registerNewJobRoutes } from "../web/routes/jobs/new";
import { registerLibraryDetailRoutes } from "../web/routes/libraries/detail";
import { registerLibrariesRoutes } from "../web/routes/libraries/list";
import { registerStatsRoute } from "../web/routes/stats";

/**
 * Register web interface routes on a Fastify server instance.
 * This includes all human-facing UI routes.
 * Note: Static file serving and form body parsing are handled by AppServer.
 */
export async function registerWebService(
  server: FastifyInstance,
  docService: IDocumentManagement,
  pipeline: IPipeline,
  eventBus: EventBusService,
  appConfig: AppConfig,
  externalWorkerUrl?: string,
): Promise<void> {
  // Note: Web interface uses direct event tracking without session management
  // This approach provides meaningful analytics without the complexity of per-request sessions
  // Future enhancements could add browser-based session correlation if needed

  // Instantiate tools for web routes
  const listLibrariesTool = new ListLibrariesTool(docService);
  const listJobsTool = new ListJobsTool(pipeline);
  const scrapeTool = new ScrapeTool(pipeline, appConfig.scraper);
  const removeTool = new RemoveTool(docService, pipeline);
  const refreshVersionTool = new RefreshVersionTool(pipeline);
  const searchTool = new SearchTool(docService);
  const cancelJobTool = new CancelJobTool(pipeline);
  const clearCompletedJobsTool = new ClearCompletedJobsTool(pipeline);

  // Register all web routes
  registerIndexRoute(server, externalWorkerUrl);
  registerLibrariesRoutes(server, listLibrariesTool, removeTool, refreshVersionTool);
  registerLibraryDetailRoutes(
    server,
    listLibrariesTool,
    searchTool,
    scrapeTool,
    docService,
  );
  registerJobListRoutes(server, listJobsTool);
  registerNewJobRoutes(server, scrapeTool);
  registerCancelJobRoute(server, cancelJobTool);
  registerClearCompletedJobsRoute(server, clearCompletedJobsTool);
  registerEventsRoute(server, eventBus);
  registerStatsRoute(server, docService);
}
