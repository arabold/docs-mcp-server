import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v3";
import type { ReadOnlyMcpTools } from "./tools";
import { createError, createResponse } from "./utils";

/** Creates the minimal read-only MCP server used by packaged desktop extensions. */
export function createReadOnlyMcpServer(tools: ReadOnlyMcpTools): McpServer {
  const server = new McpServer(
    {
      name: "lib-docs",
      version: "0.1.0",
    },
    {
      capabilities: { tools: {} },
    },
  );

  server.tool(
    "search_docs",
    "Search indexed documentation for a library or package.",
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
      openWorldHint: false,
    },
    async ({ library, version, query, limit }) => {
      try {
        const result = await tools.search.execute({
          library,
          version,
          query,
          limit,
          exactMatch: false,
        });
        const formattedResults = result.results.map(
          (item: { url: string; content: string }, index: number) => `
------------------------------------------------------------
Result ${index + 1}: ${item.url}

${item.content}\n`,
        );
        return formattedResults.length === 0
          ? createResponse(
              `No results found for '${query}' in ${library}. Try to use a different or more general query.`,
            )
          : createResponse(formattedResults.join(""));
      } catch {
        return createError("Search failed");
      }
    },
  );

  server.tool(
    "list_libraries",
    "List all indexed libraries.",
    {},
    {
      title: "List Libraries",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
    async () => {
      try {
        const result = await tools.listLibraries.execute();
        return result.libraries.length === 0
          ? createResponse("No libraries indexed yet.")
          : createResponse(
              `Indexed libraries:\n\n${result.libraries
                .map((library: { name: string }) => `- ${library.name}`)
                .join("\n")}`,
            );
      } catch (error) {
        return createError(error);
      }
    },
  );

  server.tool(
    "find_version",
    "Find the best matching version for an indexed library.",
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
      openWorldHint: false,
    },
    async ({ library, targetVersion }) => {
      try {
        const result = await tools.findVersion.execute({ library, targetVersion });
        return createResponse(result.message);
      } catch (error) {
        return createError(error);
      }
    },
  );

  return server;
}
