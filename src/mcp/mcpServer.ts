import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v3";
import { PipelineJobStatus } from "../pipeline/types";
import { TelemetryEvent, telemetry } from "../telemetry";
import type { JobInfo } from "../tools";
import { ToolError } from "../tools/errors";
import type { AppConfig } from "../utils/config";
import { logger } from "../utils/logger";
import type { McpServerTools } from "./tools";
import { createError, createResponse } from "./utils";

/**
 * Splits a comma-separated pattern string into an array of patterns. Commas
 * inside `{}`, `[]`, or `()` (regex quantifiers, glob brace expansion,
 * character classes) and escaped commas (`\,`) are preserved so that a single
 * regex or glob pattern is never torn apart. This keeps the argument
 * renderable as one string for MCP clients that only display primitive tool
 * arguments.
 * @param value The raw pattern string.
 * @returns An array of trimmed, non-empty patterns.
 */
function splitPatterns(value: string): string[] {
  const patterns: string[] = [];
  let current = "";
  let braces = 0;
  let brackets = 0;
  let parens = 0;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === "\\") {
      if (i + 1 < value.length) {
        current += ch + value[i + 1];
        i++;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === "{") braces++;
    else if (ch === "}") braces = Math.max(0, braces - 1);
    else if (ch === "[") brackets++;
    else if (ch === "]") brackets = Math.max(0, brackets - 1);
    else if (ch === "(") parens++;
    else if (ch === ")") parens = Math.max(0, parens - 1);
    if (ch === "," && braces === 0 && brackets === 0 && parens === 0) {
      patterns.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  patterns.push(current.trim());
  return patterns.filter(Boolean);
}

/**
 * Schema for URL pattern arguments. Accepts a single pattern as a string or
 * multiple patterns as an array of strings, and normalizes both to an array
 * of trimmed, non-empty patterns. A string is split on top-level commas while
 * commas inside `{}`, `[]`, or `()` are preserved, so regex quantifiers and
 * glob brace expansion survive.
 */
const patternsSchema = z.union([z.string(), z.array(z.string())]).transform((value) => {
  if (typeof value === "string") return splitPatterns(value);
  return value.map((p) => p.trim()).filter(Boolean);
});

/**
 * Creates and configures an instance of the MCP server with registered tools and resources.
 * @param tools The shared tool instances to use for server operations.
 * @param config The application configuration.
 * @returns A configured McpServer instance.
 */
export function createMcpServerInstance(
  tools: McpServerTools,
  config: AppConfig,
): McpServer {
  const readOnly = config.app.readOnly;
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
          .default(config.scraper.maxPages)
          .describe(
            `Maximum number of pages to scrape (default: ${config.scraper.maxPages}).`,
          ),
        maxDepth: z
          .number()
          .optional()
          .default(config.scraper.maxDepth)
          .describe(`Maximum navigation depth (default: ${config.scraper.maxDepth}).`),
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
        preserveHashes: z
          .boolean()
          .optional()
          .describe("Preserve hash fragments for hash-routed SPA documentation sites."),
        includePatterns: patternsSchema
          .optional()
          .describe(
            "Patterns for including URLs during scraping. Pass one or more patterns as a comma-separated string or as an array. Commas inside { }, [ ] or ( ) are preserved; escape a literal comma with a backslash. Regex patterns must be wrapped in slashes, e.g. /pattern/. If not set, all are included by default.",
          ),
        excludePatterns: patternsSchema
          .optional()
          .describe(
            "Patterns for excluding URLs during scraping. Pass one or more patterns as a comma-separated string or as an array. Commas inside { }, [ ] or ( ) are preserved; escape a literal comma with a backslash. Exclude takes precedence over include. Regex patterns must be wrapped in slashes, e.g. /pattern/.",
          ),
      },
      {
        title: "Scrape New Library Documentation",
        destructiveHint: true, // replaces existing docs
        openWorldHint: true, // requires internet access
      },
      async ({
        url,
        library,
        version,
        maxPages,
        maxDepth,
        scope,
        followRedirects,
        preserveHashes,
        includePatterns,
        excludePatterns,
      }) => {
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
              preserveHashes,
              includePatterns,
              excludePatterns,
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

    // Compact store tool
    server.tool(
      "compact_store",
      "Reclaim unused SQLite disk space and truncate the WAL file after large scrapes or deletions.",
      {
        force: z
          .boolean()
          .optional()
          .default(false)
          .describe("Always VACUUM even if no free pages are detected."),
        vacuum: z
          .boolean()
          .optional()
          .default(true)
          .describe(
            "Run VACUUM (reclaims disk space). When false, only checkpoints WAL.",
          ),
      },
      {
        title: "Compact Store",
        readOnlyHint: false,
        destructiveHint: false,
      },
      async ({ force, vacuum }) => {
        telemetry.track(TelemetryEvent.TOOL_USED, {
          tool: "compact_store",
          context: "mcp_server",
          force,
          vacuum,
        });

        try {
          const result = await tools.compactStore.execute({ force, vacuum });
          if (result.skipped) {
            return createResponse("Compaction skipped: database is running in memory.");
          }
          return createResponse(
            `Database compacted successfully.\n` +
              `- Reclaimed: ${(result.reclaimedBytes / (1024 * 1024)).toFixed(2)} MB\n` +
              `- Before: ${(result.beforeBytes / (1024 * 1024)).toFixed(2)} MB\n` +
              `- After: ${(result.afterBytes / (1024 * 1024)).toFixed(2)} MB\n` +
              `- VACUUM executed: ${result.vacuumed ? "yes" : "no"}`,
          );
        } catch (error) {
          return createError(error);
        }
      },
    );
  }

  // Search docs tool
  server.tool(
    "search_docs",
    "Search library documentation using hybrid full-text (BM25) and vector search.\n\n" +
      "HOW TO SEARCH EFFECTIVELY:\n" +
      "1. Exact Symbols Win (Highest Precision): Query exact API names, functions, hooks, types, or interfaces (e.g. 'useEffect', 'tabs.onUpdated', 'createSlice').\n" +
      "2. Keep It Short: Use 1-3 targeted keywords only. Do NOT stack 5+ words or write full sentences.\n" +
      "3. No Boolean Operators: Do NOT use 'or', 'and', 'how to' — search keywords directly.\n" +
      "4. Next Step: Search returns concise content snippets. To read the complete guide, full API contract, or code examples, take the resulting URL and call `read_page`.\n" +
      "5. Fallback: If unsure about available topics or search returns empty, call `list_pages` to browse the sitemap.",
    {
      library: z
        .string()
        .trim()
        .describe(
          "Library name (use `list_libraries` first to verify available libraries).",
        ),
      version: z
        .string()
        .trim()
        .optional()
        .describe("Library version (exact or X-Range, optional)."),
      query: z
        .string()
        .trim()
        .describe(
          "1-3 targeted keywords or exact API symbol (e.g. 'tabs.onUpdated', 'useCallback'). Avoid long sentences.",
        ),
      limit: z
        .number()
        .optional()
        .default(5)
        .describe("Maximum number of results (default 5, max 20)."),
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

  // Read page tool
  server.tool(
    "read_page",
    "Read the full Markdown documentation of a specific page from a library without re-scraping the web.\n" +
      "Call this with a page URL obtained from `search_docs` or `list_pages` to inspect complete implementations, type signatures, and code examples without token waste.",
    {
      library: z
        .string()
        .trim()
        .describe("Library name (verify with `list_libraries` first)."),
      pathOrUrl: z
        .string()
        .trim()
        .min(1)
        .describe(
          "Page URL or path (e.g. 'https://react.dev/reference/react' or '/reference/react').",
        ),
      version: z
        .string()
        .trim()
        .optional()
        .describe("Library version (exact or X-Range, optional)."),
      maxChars: z
        .number()
        .positive()
        .optional()
        .default(30000)
        .describe(
          "Maximum characters to return (default 30000, covers ~95% of full guides while preventing context overflow).",
        ),
    },
    {
      title: "Read Full Documentation Page",
      readOnlyHint: true,
      destructiveHint: false,
    },
    async ({ library, pathOrUrl, version, maxChars }) => {
      telemetry.track(TelemetryEvent.TOOL_USED, {
        tool: "read_page",
        context: "mcp_server",
        library,
        version,
        pathOrUrl: pathOrUrl.split("?")[0],
      });

      try {
        const result = await tools.readPage.execute({
          library,
          pathOrUrl,
          version,
          maxChars,
        });

        const header = `> Source: ${result.url}\n\n`;
        const notice = result.truncated
          ? `\n\n> [!NOTE]\n> Content was truncated at ${result.charCount} characters to avoid context overflow. If you need more content, explicitly increase maxChars.`
          : "";

        return createResponse(`${header}${result.content}${notice}`);
      } catch (error) {
        return createError(error);
      }
    },
  );

  // List pages tool
  server.tool(
    "list_pages",
    "List indexed documentation pages and sitemap for a library version with pagination.\n" +
      "Call this when exploring a library's architecture, when you do not know exact function names, or when `search_docs` returns no relevant results.",
    {
      library: z
        .string()
        .trim()
        .describe("Library name (verify with `list_libraries` first)."),
      version: z
        .string()
        .trim()
        .optional()
        .describe("Library version (exact or X-Range, optional)."),
      prefix: z
        .string()
        .trim()
        .optional()
        .describe(
          "Filter page URLs starting with or containing this prefix (e.g. '/docs/components').",
        ),
      limit: z
        .number()
        .int()
        .positive()
        .max(200)
        .optional()
        .default(50)
        .describe("Maximum pages to return (default 50, max 200)."),
      offset: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .default(0)
        .describe("Starting index for pagination (default 0)."),
    },
    {
      title: "List Library Pages",
      readOnlyHint: true,
      destructiveHint: false,
    },
    async ({ library, version, prefix, limit, offset }) => {
      telemetry.track(TelemetryEvent.TOOL_USED, {
        tool: "list_pages",
        context: "mcp_server",
        library,
        version,
        prefix,
        limit,
        offset,
      });

      try {
        const result = await tools.listPages.execute({
          library,
          version,
          prefix,
          limit,
          offset,
        });

        if (result.pages.length === 0) {
          return createResponse(
            `No pages found for '${library}'${result.version ? `@${result.version}` : ""}${prefix ? ` matching prefix '${prefix}'` : ""}.`,
          );
        }

        const lines = result.pages.map((p) => {
          const safeTitle = (p.title || p.url)
            .replace(/\[/g, "\\[")
            .replace(/\]/g, "\\]");
          return `- [${safeTitle}](<${p.url}>)${p.depth !== null ? ` (depth: ${p.depth})` : ""}`;
        });

        let responseText = `Indexed pages for ${result.library}${result.version ? `@${result.version}` : ""} (${result.total} total pages, showing ${result.offset + 1}-${result.offset + result.pages.length}):\n\n${lines.join("\n")}`;

        if (result.hasMore) {
          responseText += `\n\nUse offset: ${result.offset + result.pages.length} to see the next batch of pages.`;
        }

        return createResponse(responseText);
      } catch (error) {
        return createError(error);
      }
    },
  );

  // List libraries tool
  server.tool(
    "list_libraries",
    "PRIMARY ENTRYPOINT — call FIRST before searching or reading docs to verify which libraries and versions are available locally.",
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
