---
name: docs-manage
description: >-
  Manage the Grounded Docs MCP Server documentation index. Covers scraping
  and indexing documentation from URLs or local files, refreshing existing
  indexes with changed content, and removing libraries from the index.
  Use when you need to add, update, or delete indexed documentation.
compatibility: Requires Node.js 22+ and npx
metadata:
  author: grounded.tools
---

# Docs Manage

Index, refresh, and remove library documentation in the local Grounded Docs
store. These commands modify the index and produce plain-text status messages
on stdout.

## When to use

- A library is not yet indexed and you need its docs available for search.
- Documentation may be stale and you want to pull in updated pages.
- You want to remove a library or version from the index to free space.

## Commands

### scrape

Download and index documentation from a URL or local directory.

```bash
npx @arabold/docs-mcp-server@latest scrape <library> <url> [options]
```

| Flag | Alias | Default | Description |
|------|-------|---------|-------------|
| `--version <ver>` | `-v` | | Library version label |
| `--max-pages <n>` | `-p` | config default | Maximum pages to scrape |
| `--max-depth <n>` | `-d` | config default | Maximum navigation depth |
| `--max-concurrency <n>` | `-c` | config default | Concurrent page requests |
| `--ignore-errors` | | `true` | Continue on individual page errors |
| `--scope subpages\|hostname\|domain` | | `subpages` | Crawling boundary |
| `--follow-redirects` | | `true` | Follow HTTP redirects |
| `--no-follow-redirects` | | | Disable following redirects |
| `--scrape-mode auto\|fetch\|playwright` | | `auto` | HTML processing strategy |
| `--include-pattern <glob>` | | | URL include pattern (repeatable) |
| `--exclude-pattern <glob>` | | | URL exclude pattern (repeatable, takes precedence) |
| `--header "Name: Value"` | | | Custom HTTP header (repeatable) |
| `--embedding-model <model>` | | | Embedding model configuration |
| `--server-url <url>` | | | Remote pipeline worker URL |
| `--clean` | | `true` | Clear existing documents before scraping |
| `--quiet` | | | Suppress non-error diagnostics |
| `--verbose` | | | Enable debug logging |

Examples:

```bash
# Scrape React docs, version-tagged
npx @arabold/docs-mcp-server@latest scrape react https://react.dev/reference/react --version 19.0.0

# Scrape local files
npx @arabold/docs-mcp-server@latest scrape mylib file:///Users/me/docs/my-library

# Scrape with depth and page limits
npx @arabold/docs-mcp-server@latest scrape nextjs https://nextjs.org/docs --max-pages 200 --max-depth 3

# Scrape with custom headers (e.g. authentication)
npx @arabold/docs-mcp-server@latest scrape internal-api https://docs.internal.com \
  --header "Authorization: Bearer tok_xxx"

# Exclude changelog pages
npx @arabold/docs-mcp-server@latest scrape react https://react.dev/reference/react \
  --exclude-pattern "**/changelog*"
```

Output is a plain-text status line, e.g. `Successfully scraped 42 pages`.
Progress updates appear on stderr during the run.

### refresh

Re-scrape an existing library version, skipping unchanged pages via HTTP ETags.

```bash
npx @arabold/docs-mcp-server@latest refresh <library> [options]
```

| Flag | Alias | Description |
|------|-------|-------------|
| `--version <ver>` | `-v` | Version to refresh (omit for latest) |
| `--embedding-model <model>` | | Embedding model configuration |
| `--server-url <url>` | | Remote pipeline worker URL |
| `--quiet` | | Suppress non-error diagnostics |
| `--verbose` | | Enable debug logging |

Example:

```bash
npx @arabold/docs-mcp-server@latest refresh react --version 19.0.0
```

The library and version must already be indexed. Use `scrape` for first-time
indexing.

### remove

Delete a library (or a specific version) from the index.

```bash
npx @arabold/docs-mcp-server@latest remove <library> [options]
```

| Flag | Alias | Description |
|------|-------|-------------|
| `--version <ver>` | `-v` | Specific version to remove (omit to remove latest) |
| `--server-url <url>` | | Remote pipeline worker URL |
| `--quiet` | | Suppress non-error diagnostics |
| `--verbose` | | Enable debug logging |

Example:

```bash
npx @arabold/docs-mcp-server@latest remove react --version 18.3.1
```

This is destructive and cannot be undone. Re-run `scrape` to re-index.

## Output behaviour

All three commands write plain-text status messages to **stdout** and
diagnostics to **stderr**. The global `--output` flag is accepted but has no
effect because the output is plain text, not structured data.

In non-interactive sessions, diagnostics are suppressed by default. Use
`--verbose` (or set `LOG_LEVEL=INFO`) to re-enable them. Use `--quiet` to
suppress all non-error diagnostics regardless of session type.

## Typical workflow

```bash
# 1. Index documentation for the first time
npx @arabold/docs-mcp-server@latest scrape react https://react.dev/reference/react --version 19.0.0

# 2. Later, refresh to pick up any changes
npx @arabold/docs-mcp-server@latest refresh react --version 19.0.0

# 3. Clean up old versions
npx @arabold/docs-mcp-server@latest remove react --version 18.3.1
```

## Important notes

- **Scraping can take time.** Large documentation sites with hundreds of pages
  may run for several minutes. Use `--max-pages` and `--max-depth` to limit
  scope when you only need a subset.
- **Local files** must use the `file://` URL scheme
  (e.g. `file:///absolute/path/to/docs`).
- **`--clean` is on by default** for `scrape`, meaning existing documents for
  the same library+version are removed before re-indexing. Pass `--no-clean` to
  append instead.
- **`refresh`** only works on previously indexed content. It uses HTTP ETags to
  skip pages that have not changed, making it much faster than a full re-scrape.
