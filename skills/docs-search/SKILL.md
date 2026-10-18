---
name: docs-search
description: >-
  Search the Grounded Docs MCP Server documentation index. Covers listing
  indexed libraries, searching documentation content, and resolving
  library versions. Use when you need to look up API references, find
  code examples, or check which documentation is available in the local
  index.
compatibility: Requires Node.js 22+ and npx
metadata:
  author: grounded.tools
---

# Docs Search

Search the local Grounded Docs index for library documentation. These commands
print JSON by default and never change the index.

## When to use

- You need to answer a question about a library's API or behavior.
- You want to check which libraries and versions are indexed.
- You need the indexed version that best matches a version constraint.

Run `list` first if you are unsure whether a library is indexed. If it is not,
use the **docs-manage** skill to index it before searching.

## Commands

All three commands accept these flags:

| Flag | Description |
|------|-------------|
| `--output json\|yaml\|toon` | Output format (default: JSON) |
| `--server-url <url>` | Use a remote worker (e.g. `http://localhost:8080/api`) instead of the local store |
| `--quiet` | Log errors only |
| `--verbose` | Log debug output |

### list

List every indexed library and its versions.

```bash
npx @arabold/docs-mcp-server@latest list --output yaml
```

Example output:

```yaml
- name: react
  versions:
    - id: 1
      version: 19.0.0
      documentCount: 412
      uniqueUrlCount: 198
      indexedAt: 2026-10-18T22:28:47.000Z
      status: completed
      sourceUrl: https://react.dev/reference/react
      preserveHashes: false
```

An empty `version` is the library's unversioned documentation. A version with
`status: completed` is fully indexed. Other statuses (`queued`, `running`,
`updating`, `failed`, `cancelled`, `not_indexed`) mean the content may be
missing or incomplete, and such a version may carry a `progress` field. An
empty index prints `[]`.

### search

Search an indexed library with a natural-language query.

```bash
npx @arabold/docs-mcp-server@latest search <library> "<query>" [options]
```

| Flag | Alias | Default | Description |
|------|-------|---------|-------------|
| `--version <ver>` | `-v` | newest version | Exact version or range (e.g. `18.x`, `5.2.x`). An exact version also matches the closest older version. |
| `--limit <n>` | `-l` | `5` | Maximum number of results (1 to 100) |
| `--exact-match` | `-e` | `false` | Match only the exact `--version`, without falling back to an older one. Requires `--version`. |
| `--embedding-model <model>` | | | Embedding model, e.g. `openai:text-embedding-3-small` |

Example:

```bash
npx @arabold/docs-mcp-server@latest search react "useEffect cleanup" --version 18.x --limit 3 --output yaml
```

The output is a list with one entry per matching page:

- `url`: the page's URL
- `content`: the matching passage with surrounding context, as Markdown or text
- `score`: relevance score
- `mimeType`, `sourceMimeType`: the stored and original content types
- `contentUrl`: present when the content came from a different URL than `url`

No matches print `[]`. A library that is not indexed makes the command fail
with an error that suggests similar library names.

### find-version

Resolve the indexed version that best matches a pattern.

```bash
npx @arabold/docs-mcp-server@latest find-version <library> [--version <pattern>]
```

| Flag | Alias | Description |
|------|-------|-------------|
| `--version <pattern>` | `-v` | Exact version or range; omit it for the newest version |

Example:

```bash
npx @arabold/docs-mcp-server@latest find-version react --version "18.x" --output yaml
```

```yaml
bestMatch: 18.3.1
hasUnversioned: false
message: "Best match: 18.3.1."
```

`bestMatch` is `null` when no version matches but unversioned documentation
exists (`hasUnversioned: true`). When neither exists, the command fails.

## Interpreting output

Results go to **stdout** as JSON unless `--output` names another format.
Logs go to **stderr**; outside a terminal only errors are logged. Set
`LOG_LEVEL=INFO` or pass `--verbose` to see progress messages. A failed command
exits with a non-zero status.

## Typical workflow

```bash
# 1. Check what is indexed
npx @arabold/docs-mcp-server@latest list --output yaml

# 2. Search for relevant docs
npx @arabold/docs-mcp-server@latest search react "server components" --version 19.x --output yaml

# 3. If the library is missing, index it first (docs-manage skill), then search again
```
