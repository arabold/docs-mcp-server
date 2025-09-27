import type { IPipeline } from "../pipeline/trpc/interfaces";
import { AutoDetectFetcher } from "../scraper/fetcher";
import type { IDocumentManagement } from "../store/trpc/interfaces";
import {
  CancelJobTool,
  FetchUrlTool,
  FindVersionTool,
  GetJobInfoTool,
  ListJobsTool,
  ListLibrariesTool,
  RemoveTool,
  ScrapeTool,
  SearchTool,
} from "../tools";

/**
 * Interface for the shared tool instances.
 */
export interface McpServerTools {
  listLibraries: ListLibrariesTool;
  findVersion: FindVersionTool;
  scrape: ScrapeTool;
  search: SearchTool;
  listJobs: ListJobsTool;
  getJobInfo: GetJobInfoTool;
  cancelJob: CancelJobTool;
  remove: RemoveTool;
  fetchUrl: FetchUrlTool;
}

/**
 * Initializes and returns the shared tool instances.
 * This should be called after initializeServices has completed.
 * @param docService The initialized DocumentManagementService instance.
 * @param pipeline The initialized pipeline instance.
 * @returns An object containing all instantiated tool instances.
 */
export async function initializeTools(
  docService: IDocumentManagement,
  pipeline: IPipeline,
): Promise<McpServerTools> {
  const tools: McpServerTools = {
    listLibraries: new ListLibrariesTool(docService),
    findVersion: new FindVersionTool(docService),
    scrape: new ScrapeTool(pipeline),
    search: new SearchTool(docService),
    listJobs: new ListJobsTool(pipeline),
    getJobInfo: new GetJobInfoTool(pipeline),
    cancelJob: new CancelJobTool(pipeline),
    // clearCompletedJobs: new ClearCompletedJobsTool(pipeline),
    remove: new RemoveTool(docService, pipeline),
    fetchUrl: new FetchUrlTool(new AutoDetectFetcher()),
  };

  return tools;
}
