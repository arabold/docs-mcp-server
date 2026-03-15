---
name: fetch-url
description: >-
  Fetch a single URL and convert its content to Markdown. Use when you
  need to read a web page, documentation page, or API reference without
  indexing it. The content is returned as plain Markdown text on stdout.
compatibility: Requires Node.js 22+ and npx
metadata:
  author: grounded.tools
---

# Fetch URL

Fetch a single URL and convert its content to clean Markdown. This does **not**
add anything to the documentation index; it is a one-shot read operation.

## When to use

- You need to read a single web page and get its content as Markdown.
- You want to inspect a documentation page before deciding whether to index it.
- You need the raw text of a URL for summarisation or analysis.

If you need to index the content for repeated searching, use the **docs-manage**
skill (`scrape` command) instead.

## Command

```bash
npx @arabold/docs-mcp-server@latest fetch-url <url> [options]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--follow-redirects` | `true` | Follow HTTP redirects |
| `--no-follow-redirects` | | Disable following redirects |
| `--scrape-mode auto\|fetch\|playwright` | `auto` | HTML processing strategy |
| `--header "Name: Value"` | | Custom HTTP header (repeatable) |
| `--quiet` | | Suppress non-error diagnostics |
| `--verbose` | | Enable debug logging |

## Scrape modes

| Mode | When to use |
|------|-------------|
| `auto` | Default. Tries a simple HTTP fetch first, falls back to Playwright for JS-rendered pages. |
| `fetch` | Force a plain HTTP fetch. Fastest, but misses content rendered by JavaScript. |
| `playwright` | Force a headless browser. Use for SPAs or pages that require JavaScript to render. |

## Examples

```bash
# Fetch a documentation page
npx @arabold/docs-mcp-server@latest fetch-url https://react.dev/reference/react/useEffect

# Fetch with custom auth header
npx @arabold/docs-mcp-server@latest fetch-url https://docs.internal.com/api \
  --header "Authorization: Bearer tok_xxx"

# Force Playwright for a JS-heavy page
npx @arabold/docs-mcp-server@latest fetch-url https://some-spa.dev/docs --scrape-mode playwright

# Disable redirect following
npx @arabold/docs-mcp-server@latest fetch-url https://example.com/old-page --no-follow-redirects
```

## Output

The command writes the converted Markdown text directly to **stdout**. The
global `--output` flag is accepted but has no effect because the result is
already plain text, not structured data.

Diagnostics and errors go to **stderr** and are suppressed by default in
non-interactive sessions. Use `--verbose` (or set `LOG_LEVEL=INFO`) to
re-enable them. Use `--quiet` to suppress all non-error diagnostics
regardless of session type.

## Tips

- Pipe the output to a file if you want to save it:
  `npx @arabold/docs-mcp-server@latest fetch-url <url> > page.md`
- Combine with search: fetch a page to read its full content after `search`
  returns a relevant URL.
- For pages behind authentication, use `--header` to pass cookies or tokens.
