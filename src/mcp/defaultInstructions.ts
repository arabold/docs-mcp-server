/**
 * Built-in instructions sent to MCP clients when no instructions are configured.
 * Tool descriptions each explain one tool; this text explains how the tools work
 * together. Every tool named here must be registered in the matching mode.
 */

const INTRO =
  "This server searches up-to-date documentation for libraries and packages. " +
  "When a question depends on a library's API or behavior, search here before answering from memory.";

const SEARCH =
  "- `search_docs` searches one library. Pass `version` when the project uses a specific version; " +
  "without it, the latest indexed version is searched.";

const DISCOVER =
  "- Library names must match an indexed library. If a search cannot find the library, " +
  "call `list_libraries` for the exact names and versions.";

const INDEX =
  "- If a library is not indexed, read its documentation with `fetch_url` to answer now; " +
  "`scrape_docs` can index it so later searches find it. " +
  "Indexing runs in the background: check progress with `get_job_info` and search once the job has completed.";

const READ_ONLY =
  "- This server is read-only and cannot index new documentation. " +
  "If a library is not indexed, read its documentation with `fetch_url`.";

/**
 * Builds the built-in instructions for the given mode.
 * @param readOnly Whether the server runs in read-only mode, where indexing tools are not registered.
 * @returns The instructions text.
 */
export function buildDefaultInstructions(readOnly: boolean): string {
  return [INTRO, "", SEARCH, DISCOVER, readOnly ? READ_ONLY : INDEX].join("\n");
}
