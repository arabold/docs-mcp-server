/**
 * Helper utilities for constructing MCP tools with shared dependencies. Tools
 * are created with the resolved configuration supplied by the entrypoint to
 * avoid internal config loading.
 */
import type { IPipeline } from "../pipeline/trpc/interfaces";
import { AutoDetectFetcher } from "../scraper/fetcher";
import type { IDocumentManagement } from "../store/trpc/interfaces";
import {
  CancelJobTool,
  CompactStoreTool,
  FetchUrlTool,
  FindVersionTool,
  GetJobInfoTool,
  ListJobsTool,
  ListLibrariesTool,
  ListPagesTool,
  ReadPageTool,
  RefreshVersionTool,
  RemoveTool,
  ScrapeTool,
  SearchTool,
} from "../tools";
import type { AppConfig } from "../utils/config";

/**
 * Interface for the shared tool instances.
 */
export interface McpServerTools {
  listLibraries: ListLibrariesTool;
  listPages: ListPagesTool;
  readPage: ReadPageTool;
  findVersion: FindVersionTool;
  scrape: ScrapeTool;
  refresh: RefreshVersionTool;
  search: SearchTool;
  listJobs: ListJobsTool;
  getJobInfo: GetJobInfoTool;
  cancelJob: CancelJobTool;
  remove: RemoveTool;
  fetchUrl: FetchUrlTool;
  compactStore: CompactStoreTool;
}

/**
 * Initializes and returns the shared tool instances.
 * This should be called after initializeServices has completed.
 * @param docService The initialized DocumentManagementService instance.
 * @param pipeline The initialized pipeline instance.
 * @param config The resolved configuration provided by the entrypoint.
 * @returns An object containing all instantiated tool instances.
 */
export async function initializeTools(
  docService: IDocumentManagement,
  pipeline: IPipeline,
  config: AppConfig,
): Promise<McpServerTools> {
  const tools: McpServerTools = {
    listLibraries: new ListLibrariesTool(docService),
    listPages: new ListPagesTool(docService),
    readPage: new ReadPageTool(docService),
    findVersion: new FindVersionTool(docService),
    scrape: new ScrapeTool(pipeline, config.scraper),
    refresh: new RefreshVersionTool(pipeline),
    search: new SearchTool(docService),
    listJobs: new ListJobsTool(pipeline),
    getJobInfo: new GetJobInfoTool(pipeline),
    cancelJob: new CancelJobTool(pipeline),
    // clearCompletedJobs: new ClearCompletedJobsTool(pipeline),
    remove: new RemoveTool(docService, pipeline),
    fetchUrl: new FetchUrlTool(new AutoDetectFetcher(config.scraper), config),
    compactStore: new CompactStoreTool(docService),
  };

  return tools;
}
