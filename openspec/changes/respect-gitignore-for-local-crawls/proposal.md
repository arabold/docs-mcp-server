## Why

Local directory crawls index every non-hidden file, including build output, dependency trees, and generated artifacts that the project already declares uninteresting in `.gitignore`. Users must restate those rules as exclude patterns, which duplicates a list that already exists, drifts from it, and makes deliberately ignored content searchable.

## What Changes

- Add an opt-in `respectGitignore` scraper option for `file://` directory crawls, exposed through the CLI, the MCP `scrape_docs` tool, and the Web UI.
- Apply `.gitignore` rules from the indexed folder and its subdirectories with Git's precedence: nested files override their parents, negations re-include, and a rule excluding a directory excludes everything beneath it.
- Prune ignored directories during traversal rather than filtering their contents individually.
- Never index the `.git` directory, regardless of the configured hidden-file behavior or any re-including rule.
- Delete previously indexed pages, including archive members, that have since become ignored, so a refresh converges on the same result as a fresh crawl.
- Persist the option with the version's scraper options so refreshes reuse it.
- Warn when the indexed folder sits below a repository root, because that repository's own rules are outside the evaluated scope.
- Keep the option off by default, so existing crawls are unchanged.

## Capabilities

### New Capabilities

- `local-file-ignore-rules`: Evaluates `.gitignore` rules during local directory crawls, scoped to the indexed folder, including refresh-time removal of newly ignored pages.

### Modified Capabilities

<!-- None. -->

## Impact

- Affected code:
  - `src/scraper/utils/gitignore.ts` for the rule cascade and the repository-root probe.
  - `src/scraper/strategies/LocalFileStrategy.ts` for traversal pruning, symlink handling, and refresh deletions.
  - `src/scraper/types.ts` and `src/store/types.ts` for the option and its persisted form.
  - `src/cli/commands/scrape.ts`, `src/mcp/mcpServer.ts`, `src/tools/ScrapeTool.ts`, and the Web UI drawer and scrape-configuration panel for the entry points.
- Adds the `ignore` dependency for pattern matching.
- No database schema changes are required: the option rides in the existing `scraper_options` JSON blob.
- No new server configuration is required; the option is per-job.
