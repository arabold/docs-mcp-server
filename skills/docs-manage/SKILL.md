---
name: docs-manage
description: >-
  Manage the Grounded Docs MCP Server documentation index. Covers scraping
  and indexing documentation from URLs or local files, refreshing existing
  indexes with changed content, removing library versions from the index,
  and compacting the SQLite store. Use when you need to add, update, or
  delete indexed documentation, or reclaim disk space after removals.
compatibility: Requires Node.js 22+ and npx
metadata:
  author: grounded.tools
---

# Docs Manage

Index, refresh and remove library documentation in the local Grounded Docs
store. These commands change the index and print a plain-text result on
stdout.

## When to use

- A library is not indexed yet and you need its docs for search.
- Indexed documentation may be stale and you want the changed pages.
- You want to remove a library version from the index.
- The store file is still large after removals and you want to shrink it.

## Commands

Every command accepts these flags:

| Flag | Description |
|------|-------------|
| `--server-url <url>` | Use a remote worker (e.g. `http://localhost:8080/api`) instead of the local store |
| `--quiet` | Log errors only |
| `--verbose` | Log debug output |

### scrape

Download and index documentation from a URL or a local folder. The command
returns when indexing has finished.

```bash
npx @arabold/docs-mcp-server@latest scrape <library> <url> [options]
```

| Flag | Alias | Default | Description |
|------|-------|---------|-------------|
| `--version <ver>` | `-v` | unversioned | Version label to index under |
| `--max-pages <n>` | `-p` | `1000` | Maximum pages to index |
| `--max-depth <n>` | `-d` | `3` | Maximum link depth from the start URL |
| `--max-concurrency <n>` | `-c` | `3` | Pages fetched at the same time |
| `--scope subpages\|hostname\|domain` | | `subpages` | Crawl boundary: the start URL's path, its host name, or its domain with subdomains |
| `--include-pattern <pattern>` | | | Only crawl matching URLs (glob, or regex as `/pattern/`; repeatable) |
| `--exclude-pattern <pattern>` | | | Skip matching URLs (repeatable; wins over include) |
| `--scrape-mode auto\|fetch\|playwright` | | `auto` | `auto` and `playwright` render HTML in headless Chromium; `fetch` skips JavaScript |
| `--header "Name: Value"` | | | Custom HTTP header (repeatable) |
| `--no-follow-redirects` | | follows redirects | Treat HTTP redirects as errors |
| `--no-ignore-errors` | | ignores errors | Fail the scrape when a page fails instead of skipping it |
| `--preserve-hashes` | | `false` | Keep `#/route` fragments, for documentation sites routed by URL hash |
| `--replace` | | `false` | Rebuild the version if it already exists |
| `--no-clean` | | | Add documents to an existing version instead of failing |
| `--embedding-model <model>` | | | Embedding model, e.g. `openai:text-embedding-3-small` |

The page, depth and concurrency defaults come from the server configuration
and may differ on the user's machine.

Examples:

```bash
# Index React docs under a version
npx @arabold/docs-mcp-server@latest scrape react https://react.dev/reference/react --version 19.0.0

# Index a local folder
npx @arabold/docs-mcp-server@latest scrape mylib file:///Users/me/Documents/my-library

# Limit the crawl
npx @arabold/docs-mcp-server@latest scrape nextjs https://nextjs.org/docs --max-pages 200 --max-depth 3

# Send an auth header with every request
npx @arabold/docs-mcp-server@latest scrape internal-api https://docs.example.com \
  --header "Authorization: Bearer tok_xxx"

# Skip changelog pages
npx @arabold/docs-mcp-server@latest scrape react https://react.dev/reference/react \
  --exclude-pattern "**/changelog*"
```

On success it prints `Successfully scraped <n> pages`. Even while it ignores
errors, a scrape fails when the start URL fails, or when more than half of the
other pages fail (by default).

### refresh

Update an indexed version in place. Unchanged pages are skipped: web pages by
HTTP ETag, local files by modification time. Deleted pages are removed and new
links are crawled. A version whose last indexing did not finish is scraped
again from scratch. The original scrape options are reused.

```bash
npx @arabold/docs-mcp-server@latest refresh <library> [options]
```

| Flag | Alias | Description |
|------|-------|-------------|
| `--version <ver>` | `-v` | Version to refresh. Omit it only for unversioned documentation. |
| `--preserve-hashes` | | Override the stored hash-route setting for this refresh |
| `--embedding-model <model>` | | Embedding model |

Example:

```bash
npx @arabold/docs-mcp-server@latest refresh react --version 19.0.0
```

The version must already be indexed; use `scrape` for new ones. On success it
prints `Successfully refreshed <n> pages`.

### remove

Remove a library version from the index. Removing a library's last version
removes the library.

```bash
npx @arabold/docs-mcp-server@latest remove <library> [options]
```

| Flag | Alias | Description |
|------|-------|-------------|
| `--version <ver>` | `-v` | Version to remove. Without it, the command removes the unversioned documentation. |

Example:

```bash
npx @arabold/docs-mcp-server@latest remove react --version 18.3.1
```

It prints `Successfully removed react@18.3.1.` and fails if the library is not
indexed. Removal cannot be undone; run `scrape` again to re-index. Run `list`
(docs-search skill) first to get the exact version labels.

### compact

Shrink the store file by reclaiming unused space. Removing documentation does
not shrink the file by itself. Compaction takes an exclusive lock, so searches
may wait until it finishes. It also needs free disk space for a temporary copy
of the store. Run it when nothing else is using the store.

```bash
npx @arabold/docs-mcp-server@latest compact [--force]
```

| Flag | Description |
|------|-------------|
| `--force` | Rewrite the store even when SQLite reports no free pages |

It prints `Compacted store from <size> to <size> (reclaimed <size>).` or
`Store is already compact.`

## Output behavior

Each command prints one plain-text result line on **stdout** and ignores
`--output`. Logs go to **stderr**: in a terminal they include progress lines
such as `📄 Scraping react v19.0.0: 3/10 pages`; outside a terminal only errors
are logged. Set `LOG_LEVEL=INFO` or pass `--verbose` to see progress. A failed
command exits with a non-zero status.

## Typical workflow

```bash
# 1. Index documentation for the first time
npx @arabold/docs-mcp-server@latest scrape react https://react.dev/reference/react --version 19.0.0

# 2. Later, pick up changed pages
npx @arabold/docs-mcp-server@latest refresh react --version 19.0.0

# 3. Remove an old version
npx @arabold/docs-mcp-server@latest remove react --version 18.3.1

# 4. Shrink the store if needed
npx @arabold/docs-mcp-server@latest compact
```

## Important notes

- **Scraping takes time.** Large sites can run for several minutes. Use
  `--max-pages` and `--max-depth` when you only need part of a site.
- **`scrape` never overwrites by accident.** Scraping a version that already
  exists fails and leaves it untouched. Pass `--replace` to rebuild it, use
  `refresh` to update it in place, or pass `--no-clean` to add to it.
- **Library names keep their casing** (`React`, `Next.js Docs`) and match
  case-insensitively, so `react` reaches `React`. No character in a name has a
  special meaning: use `--version 18`, not `react@18`.
- **Local files** need a `file://` URL with an absolute path. By default only
  files inside the user's Documents folder can be indexed. To index another
  folder, ask the user before allowing it, then run the command with
  `DOCS_MCP_SCRAPER_SECURITY_FILE_ACCESS_ALLOWED_ROOTS=/path/to/folder`.
- **Private network addresses** such as `localhost` or `10.x.x.x` are refused
  by default. The user can allow them in the server configuration
  (`scraper.security.network`).
