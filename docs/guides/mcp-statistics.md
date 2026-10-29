# MCP Statistics

The Statistics page shows local MCP usage by tool, caller and documentation library. It requires the administrative key configured through `DOCS_MCP_ADMIN_TOKEN` or `auth.adminToken`. Client access tokens do not grant access to the report.

Every completed tool call over HTTP, legacy SSE or stdio contributes to the report. Local stdio activity is labeled separately. OAuth calls use the identity provider's client identifier. The page refreshes usage data every 15 seconds.

## Stored Data

`mcp_stats` holds recent invocation metadata:

| Field | Limit or meaning |
|---|---|
| Caller ID and comment | Numeric ID and at most 100 characters; revoked callers retain their historical ID |
| Tool | At most 64 characters |
| Library and requested version | At most 256 and 64 characters |
| Document target | At most 256 characters; URL credentials, query parameters and fragments are removed |
| Transport | HTTP, SSE or stdio |
| Outcome and duration | Success flag and elapsed milliseconds |
| Timestamp | UTC |

Search text, full arguments, request and response bodies, document content, stack traces and error messages are not stored. Long page addresses end with a compact hash suffix. `read_page` records its `pathOrUrl` target; `fetch_url` and `scrape_docs` record the requested URL without credentials or parameters.

`mcp_stats_daily` stores one counter row per UTC day, caller, tool, library/version and transport. Each row contains call and success counts, total duration and the last activity timestamp. Addresses and search text are not aggregate dimensions. Historical average latency uses the total duration divided by the number of calls.

## History and Retention

Recent metadata is pruned at startup and after every 100 recorded calls. Cleanup removes calls older than 30 days and reduces the recent table to 20,000 rows. Between cleanups the table can temporarily exceed that cap by fewer than 100 calls.

Daily aggregates are retained independently. All Time and period totals read these aggregates, so pruning recent metadata does not reduce historical counts. Periods use UTC calendar days, including the current day. The graph and all breakdowns apply the same caller, tool, library and period filters.

Migration 021 imports the legacy rows still present at upgrade time into daily aggregates before removing payload columns. Previously pruned calls cannot be reconstructed. Old arbitrary query and error text is discarded rather than converted into document addresses. The migration runs with the normal database migrations on the next application start; it is not applied by editing source files.
