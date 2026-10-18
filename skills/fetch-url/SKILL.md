---
name: fetch-url
description: >-
  Fetch a single URL and print its content as Markdown. Use when you
  need to read a web page, documentation page, or API reference without
  indexing it. Accepts http(s):// and file:// URLs and writes the result
  to stdout.
compatibility: Requires Node.js 22+ and npx
metadata:
  author: grounded.tools
---

# Fetch URL

Fetch one URL and print its content as Markdown. Nothing is added to the
documentation index.

## When to use

- You need to read a single web page as Markdown.
- You want to look at a documentation page before deciding whether to index it.
- You need the text of a URL for summarizing or analysis.

To index content for repeated searching, use the **docs-manage** skill
(`scrape` command) instead.

## Command

```bash
npx @arabold/docs-mcp-server@latest fetch-url <url> [options]
```

`<url>` is an `http://`, `https://` or `file://` URL.

| Flag | Default | Description |
|------|---------|-------------|
| `--no-follow-redirects` | follows redirects | Fail on an HTTP redirect instead of following it |
| `--scrape-mode auto\|fetch\|playwright` | `auto` | How HTML pages are processed |
| `--header "Name: Value"` | | Custom HTTP header (repeatable) |
| `--quiet` | | Log errors only |
| `--verbose` | | Log debug output |

## Scrape modes

| Mode | Behavior |
|------|----------|
| `auto` | Default. Renders HTML pages in headless Chromium, like `playwright`. |
| `playwright` | Renders HTML pages in headless Chromium, so content built by JavaScript is included. |
| `fetch` | Converts the HTML as the server sent it. Faster, but misses content built by JavaScript. |

In every mode, a site that refuses the plain request (HTTP 403 or 429) is
fetched again through the browser.

## Examples

```bash
# Fetch a documentation page
npx @arabold/docs-mcp-server@latest fetch-url https://react.dev/reference/react/useEffect

# Send an auth header
npx @arabold/docs-mcp-server@latest fetch-url https://docs.example.com/api \
  --header "Authorization: Bearer tok_xxx"

# Skip browser rendering for a static page
npx @arabold/docs-mcp-server@latest fetch-url https://example.com/docs/page.html --scrape-mode fetch

# Fail instead of following a redirect
npx @arabold/docs-mcp-server@latest fetch-url https://example.com/old-page --no-follow-redirects
```

## Output

The content goes to **stdout**. HTML pages and documents such as PDF or Word
files are converted to Markdown. JSON, XML and plain text are printed
unchanged. The `--output` flag has no effect on this command.

Logs go to **stderr**. Outside a terminal, only errors are logged; set
`LOG_LEVEL=INFO` or pass `--verbose` to see progress messages.

On failure the command exits with a non-zero status and prints
`Unable to fetch or process the URL ...` on stderr. Run it again with
`--verbose` to see the cause. By default the server refuses private network
addresses (such as `localhost` or `10.x.x.x`) and local files outside the
user's Documents folder; the user can allow more in the server configuration
(`scraper.security`).

## Tips

- Save the output to a file:
  `npx @arabold/docs-mcp-server@latest fetch-url <url> > page.md`
- After `search` (docs-search skill) returns a relevant URL, fetch the page to
  read all of it.
- For pages behind authentication, pass cookies or tokens with `--header`.
