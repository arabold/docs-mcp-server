import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v3";
import { PipelineJobStatus } from "../pipeline/types";
import { TelemetryEvent, telemetry } from "../telemetry";
import type { JobInfo } from "../tools";
import { ToolError } from "../tools/errors";
import { SCRAPER_MAX_DEPTH, SCRAPER_MAX_PAGES } from "../utils/config";
import { logger } from "../utils/logger";
import type { McpServerTools } from "./tools";
import { createError, createResponse } from "./utils";

/**
 * Creates and configures an instance of the MCP server with registered tools and resources.
 * @param tools The shared tool instances to use for server operations.
 * @param readOnly Whether to run in read-only mode (only expose read tools).
 * @returns A configured McpServer instance.
 */
export function createMcpServerInstance(
  tools: McpServerTools,
  readOnly = false,
): McpServer {
  const server = new McpServer(
    {
      name: "docs-mcp-server",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    },
  );

  // --- Tool Definitions ---

  // Only register write/job tools if not in read-only mode
  if (!readOnly) {
    // Scrape docs tool - suppress deep inference issues
    // @ts-expect-error TypeScript has issues with deep Zod inference in MCP SDK
    server.tool(
      "scrape_docs",
      "Scrape and index documentation from a URL for a library. Use this tool to index a new library or a new version.",
      {
        url: z.string().url().describe("Documentation root URL to scrape."),
        library: z.string().trim().describe("Library name."),
        version: z.string().trim().optional().describe("Library version (optional)."),
        maxPages: z
          .number()
          .optional()
          .default(SCRAPER_MAX_PAGES)
          .describe(`Maximum number of pages to scrape (default: ${SCRAPER_MAX_PAGES}).`),
        maxDepth: z
          .number()
          .optional()
          .default(SCRAPER_MAX_DEPTH)
          .describe(`Maximum navigation depth (default: ${SCRAPER_MAX_DEPTH}).`),
        scope: z
          .enum(["subpages", "hostname", "domain"])
          .optional()
          .default("subpages")
          .describe("Crawling boundary: 'subpages', 'hostname', or 'domain'."),
        followRedirects: z
          .boolean()
          .optional()
          .default(true)
          .describe("Follow HTTP redirects (3xx responses)."),
      },
      {
        title: "Scrape New Library Documentation",
        destructiveHint: true, // replaces existing docs
        openWorldHint: true, // requires internet access
      },
      async ({ url, library, version, maxPages, maxDepth, scope, followRedirects }) => {
        // Track MCP tool usage
        telemetry.track(TelemetryEvent.TOOL_USED, {
          tool: "scrape_docs",
          context: "mcp_server",
          library,
          version,
          url: new URL(url).hostname, // Privacy-safe URL tracking
          maxPages,
          maxDepth,
          scope,
        });

        try {
          // Execute scrape tool without waiting and without progress callback
          const result = await tools.scrape.execute({
            url,
            library,
            version,
            waitForCompletion: false, // Don't wait for completion
            // onProgress: undefined, // Explicitly undefined or omitted
            options: {
              maxPages,
              maxDepth,
              scope,
              followRedirects,
            },
          });

          // Check the type of result
          if ("jobId" in result) {
            // If we got a jobId back, report that
            return createResponse(`🚀 Scraping job started with ID: ${result.jobId}.`);
          }
          // This case shouldn't happen if waitForCompletion is false, but handle defensively
          return createResponse(
            `Scraping finished immediately (unexpectedly) with ${result.pagesScraped} pages.`,
          );
        } catch (error) {
          // Handle errors during job *enqueueing* or initial setup
          return createError(error);
        }
      },
    );

    // Refresh version tool - suppress deep inference issues
    server.tool(
      "refresh_version",
      "Re-scrape a previously indexed library version, updating only changed pages.",
      {
        library: z.string().trim().describe("Library name."),
        version: z
          .string()
          .trim()
          .optional()
          .describe("Library version (optional, refreshes latest if omitted)."),
      },
      {
        title: "Refresh Library Version",
        destructiveHint: false, // Only updates changed content
        openWorldHint: true, // requires internet access
      },
      async ({ library, version }) => {
        // Track MCP tool usage
        telemetry.track(TelemetryEvent.TOOL_USED, {
          tool: "refresh_version",
          context: "mcp_server",
          library,
          version,
        });

        try {
          // Execute refresh tool without waiting
          const result = await tools.refresh.execute({
            library,
            version,
            waitForCompletion: false, // Don't wait for completion
          });

          // Check the type of result
          if ("jobId" in result) {
            // If we got a jobId back, report that
            return createResponse(`🔄 Refresh job started with ID: ${result.jobId}.`);
          }
          // This case shouldn't happen if waitForCompletion is false, but handle defensively
          return createResponse(
            `Refresh finished immediately (unexpectedly) with ${result.pagesRefreshed} pages.`,
          );
        } catch (error) {
          // Handle errors during job enqueueing or initial setup
          return createError(error);
        }
      },
    );
  }

  // Search docs tool
  server.tool(
    "search_docs",
    "Search up-to-date documentation for a library or package. Examples:\n\n" +
      '- {library: "react", query: "hooks lifecycle"} -> matches latest version of React\n' +
      '- {library: "react", version: "18.0.0", query: "hooks lifecycle"} -> matches React 18.0.0 or earlier\n' +
      '- {library: "typescript", version: "5.x", query: "ReturnType example"} -> any TypeScript 5.x.x version\n' +
      '- {library: "typescript", version: "5.2.x", query: "ReturnType example"} -> any TypeScript 5.2.x version',
    {
      library: z.string().trim().describe("Library name."),
      version: z
        .string()
        .trim()
        .optional()
        .describe("Library version (exact or X-Range, optional)."),
      query: z.string().trim().describe("Documentation search query."),
      limit: z.number().optional().default(5).describe("Maximum number of results."),
    },
    {
      title: "Search Library Documentation",
      readOnlyHint: true,
      destructiveHint: false,
    },
    async ({ library, version, query, limit }) => {
      // Track MCP tool usage
      telemetry.track(TelemetryEvent.TOOL_USED, {
        tool: "search_docs",
        context: "mcp_server",
        library,
        version,
        query: query.substring(0, 100), // Truncate query for privacy
        limit,
      });

      try {
        const result = await tools.search.execute({
          library,
          version,
          query,
          limit,
          exactMatch: false, // Always false for MCP interface
        });

        const formattedResults = result.results.map(
          (r: { url: string; content: string }, i: number) => `
------------------------------------------------------------
Result ${i + 1}: ${r.url}

${r.content}\n`,
        );

        if (formattedResults.length === 0) {
          return createResponse(
            `No results found for '${query}' in ${library}. Try to use a different or more general query.`,
          );
        }
        return createResponse(formattedResults.join(""));
      } catch (error) {
        return createError(error);
      }
    },
  );

  // List libraries tool
  server.tool(
    "list_libraries",
    "List all indexed libraries.",
    {
      // no params
    },
    {
      title: "List Libraries",
      readOnlyHint: true,
      destructiveHint: false,
    },
    async () => {
      // Track MCP tool usage
      telemetry.track(TelemetryEvent.TOOL_USED, {
        tool: "list_libraries",
        context: "mcp_server",
      });

      try {
        const result = await tools.listLibraries.execute();
        if (result.libraries.length === 0) {
          return createResponse("No libraries indexed yet.");
        }

        return createResponse(
          `Indexed libraries:\n\n${result.libraries.map((lib: { name: string }) => `- ${lib.name}`).join("\n")}`,
        );
      } catch (error) {
        return createError(error);
      }
    },
  );

  // Find version tool
  server.tool(
    "find_version",
    "Find the best matching version for a library. Use to identify available or closest versions.",
    {
      library: z.string().trim().describe("Library name."),
      targetVersion: z
        .string()
        .trim()
        .optional()
        .describe("Version pattern to match (exact or X-Range, optional)."),
    },
    {
      title: "Find Library Version",
      readOnlyHint: true,
      destructiveHint: false,
    },
    async ({ library, targetVersion }) => {
      // Track MCP tool usage
      telemetry.track(TelemetryEvent.TOOL_USED, {
        tool: "find_version",
        context: "mcp_server",
        library,
        targetVersion,
      });

      try {
        const result = await tools.findVersion.execute({
          library,
          targetVersion,
        });

        // Tool now returns a structured object with message
        return createResponse(result.message);
      } catch (error) {
        return createError(error);
      }
    },
  );

  // Job and write tools - only available when not in read-only mode
  if (!readOnly) {
    // List jobs tool - suppress deep inference issues
    // @ts-expect-error TypeScript has issues with deep Zod inference in MCP SDK
    server.tool(
      "list_jobs",
      "List all indexing jobs. Optionally filter by status.",
      {
        status: z
          .enum(["queued", "running", "completed", "failed", "cancelling", "cancelled"])
          .optional()
          .describe("Filter jobs by status (optional)."),
      },
      {
        title: "List Indexing Jobs",
        readOnlyHint: true,
        destructiveHint: false,
      },
      async ({ status }) => {
        // Track MCP tool usage
        telemetry.track(TelemetryEvent.TOOL_USED, {
          tool: "list_jobs",
          context: "mcp_server",
          status,
        });

        try {
          const result = await tools.listJobs.execute({
            status: status as PipelineJobStatus | undefined,
          });
          // Format the simplified job list for display
          const formattedJobs = result.jobs
            .map(
              (job: JobInfo) =>
                `- ID: ${job.id}\n  Status: ${job.status}\n  Library: ${job.library}\n  Version: ${job.version}\n  Created: ${job.createdAt}${job.startedAt ? `\n  Started: ${job.startedAt}` : ""}${job.finishedAt ? `\n  Finished: ${job.finishedAt}` : ""}${job.error ? `\n  Error: ${job.error}` : ""}`,
            )
            .join("\n\n");
          return createResponse(
            result.jobs.length > 0
              ? `Current Jobs:\n\n${formattedJobs}`
              : "No jobs found.",
          );
        } catch (error) {
          return createError(error);
        }
      },
    );

    // Get job info tool
    server.tool(
      "get_job_info",
      "Get details for a specific indexing job. Use the 'list_jobs' tool to find the job ID.",
      {
        jobId: z.string().uuid().describe("Job ID to query."),
      },
      {
        title: "Get Indexing Job Info",
        readOnlyHint: true,
        destructiveHint: false,
      },
      async ({ jobId }) => {
        // Track MCP tool usage
        telemetry.track(TelemetryEvent.TOOL_USED, {
          tool: "get_job_info",
          context: "mcp_server",
          jobId,
        });

        try {
          const result = await tools.getJobInfo.execute({ jobId });
          // Tool now guarantees result.job is always present on success
          const job = result.job;
          const formattedJob = `- ID: ${job.id}\n  Status: ${job.status}\n  Library: ${job.library}@${job.version}\n  Created: ${job.createdAt}${job.startedAt ? `\n  Started: ${job.startedAt}` : ""}${job.finishedAt ? `\n  Finished: ${job.finishedAt}` : ""}${job.error ? `\n  Error: ${job.error}` : ""}`;
          return createResponse(`Job Info:\n\n${formattedJob}`);
        } catch (error) {
          // Tool now throws error when job not found
          return createError(error);
        }
      },
    );

    // Cancel job tool
    server.tool(
      "cancel_job",
      "Cancel a queued or running indexing job. Use the 'list_jobs' tool to find the job ID.",
      {
        jobId: z.string().uuid().describe("Job ID to cancel."),
      },
      {
        title: "Cancel Indexing Job",
        destructiveHint: true,
      },
      async ({ jobId }) => {
        // Track MCP tool usage
        telemetry.track(TelemetryEvent.TOOL_USED, {
          tool: "cancel_job",
          context: "mcp_server",
          jobId,
        });

        try {
          const result = await tools.cancelJob.execute({ jobId });
          // Tool now always returns success data or throws error
          return createResponse(result.message);
        } catch (error) {
          // Catch any errors thrown by the tool (job not found, cancellation failed, etc.)
          return createError(error);
        }
      },
    );

    // Remove docs tool
    server.tool(
      "remove_docs",
      "Remove indexed documentation for a library version. Use only if explicitly instructed.",
      {
        library: z.string().trim().describe("Library name."),
        version: z
          .string()
          .trim()
          .optional()
          .describe("Library version (optional, removes latest if omitted)."),
      },
      {
        title: "Remove Library Documentation",
        destructiveHint: true,
      },
      async ({ library, version }) => {
        // Track MCP tool usage
        telemetry.track(TelemetryEvent.TOOL_USED, {
          tool: "remove_docs",
          context: "mcp_server",
          library,
          version,
        });

        try {
          // Execute the remove tool logic
          const result = await tools.remove.execute({ library, version });
          // Use the message from the tool's successful execution
          return createResponse(result.message);
        } catch (error) {
          // Catch errors thrown by the RemoveTool's execute method
          return createError(error);
        }
      },
    );
  }

  // Fetch URL tool
  server.tool(
    "fetch_url",
    "Fetch a single URL and convert its content to Markdown. Use this tool to read the content of any web page.",
    {
      url: z.string().url().describe("URL to fetch and convert to Markdown."),
      followRedirects: z
        .boolean()
        .optional()
        .default(true)
        .describe("Follow HTTP redirects (3xx responses)."),
    },
    {
      title: "Fetch URL",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true, // requires internet access
    },
    async ({ url, followRedirects }) => {
      // Track MCP tool usage
      telemetry.track(TelemetryEvent.TOOL_USED, {
        tool: "fetch_url",
        context: "mcp_server",
        url: new URL(url).hostname, // Privacy-safe URL tracking
        followRedirects,
      });

      try {
        const result = await tools.fetchUrl.execute({ url, followRedirects });
        return createResponse(result);
      } catch (error) {
        return createError(error);
      }
    },
  );

  server.resource(
    "libraries",
    "docs://libraries",
    {
      description: "List all indexed libraries",
    },
    async (uri: URL) => {
      const result = await tools.listLibraries.execute();

      return {
        contents: result.libraries.map((lib: { name: string }) => ({
          uri: new URL(lib.name, uri).href,
          text: lib.name,
        })),
      };
    },
  );

  server.resource(
    "versions",
    new ResourceTemplate("docs://libraries/{library}/versions", {
      list: undefined,
    }),
    {
      description: "List all indexed versions for a library",
    },
    async (uri: URL, { library }) => {
      const result = await tools.listLibraries.execute();

      const lib = result.libraries.find((l: { name: string }) => l.name === library);
      if (!lib) {
        return { contents: [] };
      }

      return {
        contents: lib.versions.map((v: { version: string }) => ({
          uri: new URL(v.version, uri).href,
          text: v.version,
        })),
      };
    },
  );

  // Job-related resources - only available when not in read-only mode
  if (!readOnly) {
    /**
     * Resource handler for listing pipeline jobs.
     * Supports filtering by status via a query parameter (e.g., ?status=running).
     * URI: docs://jobs[?status=<status>]
     */
    server.resource(
      "jobs",
      "docs://jobs",
      {
        description: "List indexing jobs, optionally filtering by status.",
        mimeType: "application/json",
      },
      async (uri: URL) => {
        const statusParam = uri.searchParams.get("status");
        let statusFilter: PipelineJobStatus | undefined;

        // Validate status parameter if provided
        if (statusParam) {
          const validation = z.nativeEnum(PipelineJobStatus).safeParse(statusParam);
          if (validation.success) {
            statusFilter = validation.data;
          } else {
            // Handle invalid status - perhaps return an error or ignore?
            // For simplicity, let's ignore invalid status for now and return all jobs.
            // Alternatively, could throw an McpError or return specific error content.
            logger.warn(`⚠️  Invalid status parameter received: ${statusParam}`);
          }
        }

        // Fetch simplified jobs using the ListJobsTool
        const result = await tools.listJobs.execute({ status: statusFilter });

        return {
          contents: result.jobs.map((job) => ({
            uri: new URL(job.id, uri).href,
            mimeType: "application/json",
            text: JSON.stringify({
              id: job.id,
              library: job.library,
              version: job.version,
              status: job.status,
              error: job.error || undefined,
            }),
          })),
        };
      },
    );

    /**
     * Resource handler for retrieving a specific pipeline job by its ID.
     * URI Template: docs://jobs/{jobId}
     */
    server.resource(
      "job", // A distinct name for this specific resource type
      new ResourceTemplate("docs://jobs/{jobId}", { list: undefined }),
      {
        description: "Get details for a specific indexing job by ID.",
        mimeType: "application/json",
      },
      async (uri: URL, { jobId }) => {
        // Validate jobId format if necessary (basic check)
        if (typeof jobId !== "string" || jobId.length === 0) {
          // Handle invalid jobId format - return empty or error
          logger.warn(`⚠️  Invalid jobId received in URI: ${jobId}`);
          return { contents: [] }; // Return empty content for invalid ID format
        }

        try {
          // Fetch the simplified job info using GetJobInfoTool
          const result = await tools.getJobInfo.execute({ jobId });

          // Tool now guarantees result.job is always present on success
          return {
            contents: [
              {
                uri: uri.href,
                mimeType: "application/json",
                text: JSON.stringify({
                  id: result.job.id,
                  library: result.job.library,
                  version: result.job.version,
                  status: result.job.status,
                  error: result.job.error || undefined,
                }),
              },
            ],
          };
        } catch (error) {
          if (error instanceof ToolError) {
            // Expected error (job not found, etc.)
            logger.warn(`⚠️  Job not found for resource request: ${jobId}`);
          } else {
            // Unexpected error
            logger.error(
              `❌ Unexpected error in job resource handler: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
          return { contents: [] };
        }
      },
    );
  }

  return server;
}
