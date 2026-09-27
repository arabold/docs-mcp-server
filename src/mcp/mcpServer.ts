import fs from "node:fs";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/server";
import { z } from "zod";
import { PipelineJobStatus } from "../pipeline/types";
import { libraryNamesMatch } from "../store/types";
import { TelemetryEvent, telemetry } from "../telemetry";
import type { JobInfo } from "../tools";
import { ToolError } from "../tools/errors";
import type { AppConfig } from "../utils/config";
import { logger } from "../utils/logger";
import { buildDefaultInstructions } from "./defaultInstructions";
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
 * Resolves the instructions text advertised to MCP clients during initialization.
 * Call this once at startup and pass the result to `createMcpServerInstance()`, so the
 * instructions file is read a single time rather than for every client session.
 * `server.instructions` and `server.instructionsFile` are mutually exclusive. When
 * neither is set, the built-in instructions for the current mode are used.
 * @param config The application configuration.
 * @returns The configured instructions text, or the built-in instructions.
 * @throws {Error} If both settings are set, or the configured instructions file cannot be read.
 */
export function resolveServerInstructions(config: AppConfig): string {
  const { instructions, instructionsFile: filePath } = config.server;
  if (instructions !== undefined && filePath !== undefined) {
    throw new Error(
      "Both server.instructions and server.instructionsFile are set; configure only one of them.",
    );
  }
  if (instructions !== undefined) {
    return instructions;
  }
  if (filePath === undefined) {
    return buildDefaultInstructions(config.app.readOnly);
  }
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to read MCP server instructions file "${filePath}": ${reason}`,
    );
  }
}

/**
 * Decodes a URI template variable once. The SDK hands variables over still
 * percent-encoded; a malformed escape is kept verbatim rather than failing.
 */
function decodeUriVariable(value: string | string[]): string {
  const raw = Array.isArray(value) ? value.join("/") : value;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * Creates and configures an instance of the MCP server with registered tools and resources.
 * @param tools The shared tool instances to use for server operations.
 * @param config The application configuration.
 * @param instructions Instructions text sent to clients during initialization, as
 *   returned by `resolveServerInstructions()`.
 * @returns A configured McpServer instance.
 */
export function createMcpServerInstance(
  tools: McpServerTools,
  config: AppConfig,
  instructions: string,
): McpServer {
  const readOnly = config.app.readOnly;
  const { name, title } = config.server;
  const server = new McpServer(
    {
      name,
      ...(title !== undefined ? { title } : {}),
      version: __APP_VERSION__,
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
      instructions,
    },
  );

  // --- Tool Definitions ---

  // Only register write/job tools if not in read-only mode
  if (!readOnly) {
    // Scrape docs tool - suppress deep inference issues
    server.registerTool(
      "scrape_docs",
      {
        description:
          "Scrape and index documentation from a URL for a library. Use this tool to index a new library or a new version. Scraping a library version that already exists is rejected unless `replace` is true; use refresh_version to update an existing version in place.",
        inputSchema: z.object({
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
          replace: z
            .boolean()
            .optional()
            .default(false)
            .describe(
              "Rebuild the version from scratch if it already exists. Without it, an existing version is left untouched and the request fails.",
            ),
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
        }),
        annotations: {
          title: "Scrape New Library Documentation",
          destructiveHint: true, // replaces existing docs
          openWorldHint: true, // requires internet access
        },
      },
      async ({
        url,
        library,
        version,
        maxPages,
        maxDepth,
        scope,
        followRedirects,
        replace,
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
            replace,
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
    server.registerTool(
      "refresh_version",
      {
        description:
          "Re-scrape a previously indexed library version, updating only changed pages.",
        inputSchema: z.object({
          library: z.string().trim().describe("Library name."),
          version: z
            .string()
            .trim()
            .optional()
            .describe("Library version (optional, refreshes latest if omitted)."),
        }),
        annotations: {
          title: "Refresh Library Version",
          destructiveHint: false, // Only updates changed content
          openWorldHint: true, // requires internet access
        },
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
  server.registerTool(
    "search_docs",
    {
      description:
        "Search up-to-date documentation for a library or package. Examples:\n\n" +
        '- {library: "react", query: "hooks lifecycle"} -> matches latest version of React\n' +
        '- {library: "react", version: "18.0.0", query: "hooks lifecycle"} -> matches React 18.0.0 or earlier\n' +
        '- {library: "typescript", version: "5.x", query: "ReturnType example"} -> any TypeScript 5.x.x version\n' +
        '- {library: "typescript", version: "5.2.x", query: "ReturnType example"} -> any TypeScript 5.2.x version',
      inputSchema: z.object({
        library: z.string().trim().describe("Library name."),
        version: z
          .string()
          .trim()
          .optional()
          .describe("Library version (exact or X-Range, optional)."),
        query: z.string().trim().describe("Documentation search query."),
        limit: z.number().optional().default(5).describe("Maximum number of results."),
      }),
      annotations: {
        title: "Search Library Documentation",
        readOnlyHint: true,
        destructiveHint: false,
      },
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
  server.registerTool(
    "read_page",
    {
      description:
        "Read the full content of an indexed documentation page, for example a URL returned by `search_docs` or `list_pages`. " +
        "Long pages are returned in parts; the response says how to continue.",
      inputSchema: z.object({
        library: z.string().trim().describe("Library name."),
        pathOrUrl: z
          .string()
          .trim()
          .min(1)
          .describe(
            "Page URL, or a path matching the end of one page URL (e.g. 'https://react.dev/reference/react' or '/reference/react').",
          ),
        version: z
          .string()
          .trim()
          .optional()
          .describe("Library version (exact or X-Range, optional)."),
        startChunk: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .default(0)
          .describe("Chunk to start from, as given by a previous response (default 0)."),
        maxChars: z
          .number()
          .positive()
          .optional()
          .default(30000)
          .describe(
            "Maximum characters to return (default 30000). Only whole chunks are returned, so a single longer chunk is returned on its own.",
          ),
      }),
      annotations: {
        title: "Read Documentation Page",
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    async ({ library, pathOrUrl, version, startChunk, maxChars }) => {
      telemetry.track(TelemetryEvent.TOOL_USED, {
        tool: "read_page",
        context: "mcp_server",
        library,
        version,
      });

      try {
        const result = await tools.readPage.execute({
          library,
          pathOrUrl,
          version,
          startChunk,
          maxChars,
        });

        if (result.startChunk >= result.totalChunks && result.totalChunks > 0) {
          return createResponse(
            `startChunk ${result.startChunk} is past the end of ${result.url}, which has ${result.totalChunks} chunks.`,
          );
        }

        const end = result.nextChunk ?? result.totalChunks;
        const notice =
          result.nextChunk !== null
            ? `\n\n> Showing chunks ${result.startChunk + 1}-${end} of ${result.totalChunks}. ` +
              `To continue, call read_page again with startChunk: ${result.nextChunk}.`
            : "";

        return createResponse(`> Source: ${result.url}\n\n${result.content}${notice}`);
      } catch (error) {
        return createError(error);
      }
    },
  );

  // List pages tool
  server.registerTool(
    "list_pages",
    {
      description:
        "List the indexed pages of a library version, with an optional URL filter and pagination.",
      inputSchema: z.object({
        library: z.string().trim().describe("Library name."),
        version: z
          .string()
          .trim()
          .optional()
          .describe("Library version (exact or X-Range, optional)."),
        contains: z
          .string()
          .trim()
          .optional()
          .describe("Only list pages whose URL contains this text (e.g. '/components')."),
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
          .describe("Number of pages to skip (default 0)."),
      }),
      annotations: {
        title: "List Library Pages",
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    async ({ library, version, contains, limit, offset }) => {
      telemetry.track(TelemetryEvent.TOOL_USED, {
        tool: "list_pages",
        context: "mcp_server",
        library,
        version,
        limit,
        offset,
      });

      try {
        const result = await tools.listPages.execute({
          library,
          version,
          contains,
          limit,
          offset,
        });

        if (result.pages.length === 0) {
          return createResponse(
            `No pages found for '${library}'${result.version ? `@${result.version}` : ""}${contains ? ` with URLs containing '${contains}'` : ""}.`,
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
  server.registerTool(
    "list_libraries",
    {
      description:
        "List all indexed libraries and their versions. Use this to find the correct library name.",
      inputSchema: z.object({
        // no params
      }),
      annotations: {
        title: "List Libraries",
        readOnlyHint: true,
        destructiveHint: false,
      },
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
  server.registerTool(
    "find_version",
    {
      description:
        "Find the best matching version for a library. Use to identify available or closest versions.",
      inputSchema: z.object({
        library: z.string().trim().describe("Library name."),
        targetVersion: z
          .string()
          .trim()
          .optional()
          .describe("Version pattern to match (exact or X-Range, optional)."),
      }),
      annotations: {
        title: "Find Library Version",
        readOnlyHint: true,
        destructiveHint: false,
      },
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
    server.registerTool(
      "list_jobs",
      {
        description: "List all indexing jobs. Optionally filter by status.",
        inputSchema: z.object({
          status: z
            .enum(["queued", "running", "completed", "failed", "cancelling", "cancelled"])
            .optional()
            .describe("Filter jobs by status (optional)."),
        }),
        annotations: {
          title: "List Indexing Jobs",
          readOnlyHint: true,
          destructiveHint: false,
        },
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
    server.registerTool(
      "get_job_info",
      {
        description:
          "Get details for a specific indexing job. Use the 'list_jobs' tool to find the job ID.",
        inputSchema: z.object({
          jobId: z.string().uuid().describe("Job ID to query."),
        }),
        annotations: {
          title: "Get Indexing Job Info",
          readOnlyHint: true,
          destructiveHint: false,
        },
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
    server.registerTool(
      "cancel_job",
      {
        description:
          "Cancel a queued or running indexing job. Use the 'list_jobs' tool to find the job ID.",
        inputSchema: z.object({
          jobId: z.string().uuid().describe("Job ID to cancel."),
        }),
        annotations: {
          title: "Cancel Indexing Job",
          destructiveHint: true,
        },
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
    server.registerTool(
      "remove_docs",
      {
        description:
          "Remove indexed documentation for a library version. Use only if explicitly instructed.",
        inputSchema: z.object({
          library: z.string().trim().describe("Library name."),
          version: z
            .string()
            .trim()
            .optional()
            .describe("Library version (optional, removes latest if omitted)."),
        }),
        annotations: {
          title: "Remove Library Documentation",
          destructiveHint: true,
        },
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
  server.registerTool(
    "fetch_url",
    {
      description:
        "Fetch a single URL and convert its content to Markdown. Use this tool to read the content of any web page.",
      inputSchema: z.object({
        url: z.string().url().describe("URL to fetch and convert to Markdown."),
        followRedirects: z
          .boolean()
          .optional()
          .default(true)
          .describe("Follow HTTP redirects (3xx responses)."),
      }),
      annotations: {
        title: "Fetch URL",
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true, // requires internet access
      },
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

  server.registerResource(
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

  server.registerResource(
    "versions",
    new ResourceTemplate("docs://libraries/{library}/versions", {
      list: undefined,
    }),
    {
      description: "List all indexed versions for a library",
    },
    async (uri: URL, { library }) => {
      const result = await tools.listLibraries.execute();

      // The template variable arrives percent-encoded (a name containing "/" must
      // be sent as %2F), and names match case-insensitively.
      const requested = decodeUriVariable(library);
      const lib = result.libraries.find((l: { name: string }) =>
        libraryNamesMatch(l.name, requested),
      );
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
    server.registerResource(
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
    server.registerResource(
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
