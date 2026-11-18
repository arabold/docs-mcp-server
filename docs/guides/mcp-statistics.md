# MCP Statistics

The Statistics page shows local MCP usage by tool, caller and documentation library. The report opens without a password. Overview shows the last seven UTC days of MCP tool calls.

Every completed tool call over HTTP, legacy SSE or stdio contributes to the report. In open mode, calls with a registered app token use the app name from Settings. Local stdio, anonymous HTTP and anonymous SSE activity have separate labels. OAuth calls use the identity provider's client identifier. The page refreshes usage data every 15 seconds. Tool Popularity shows each tool's share of calls, split into successful and failed calls.

## Label Calls by Application

In **Settings → MCP App Tokens**, choose **Create token** and enter an application
name. Use a distinct name for each app you want to track. Copy the token shown
after creation and send it on each MCP request as `Authorization: Bearer <token>`.
The server also accepts `X-API-Key: <token>` in open mode. Requests without a
recognized token continue as anonymous. You can revoke a token in Settings at
any time. This changes how future calls are counted and preserves past statistics.

If you have a token saved in a client configuration from before migration 022,
enter it in **Existing token** when creating the app entry. Use the original
app name to find its past and future calls under the same **All callers** filter.

## Stored Data

`mcp_stats` holds recent invocation metadata:

| Field | Limit or meaning |
|---|---|
| Caller ID and comment | Caller label of up to 100 characters and a token ID for app tokens and historical client-token records |
| Tool | At most 64 characters |
| Library and requested version | At most 256 and 64 characters |
| Document target | At most 256 characters; URL credentials, query parameters and fragments are removed |
| Transport | HTTP, SSE or stdio |
| Outcome and duration | Success flag and elapsed milliseconds |
| Failure reason | A predefined description or HTTP status shown under the Error badge and written to the server log |
| Timestamp | UTC |

Search text, full arguments, request and response bodies, document content, stack traces and raw error messages are not stored. Long page addresses end with a compact hash suffix. `read_page` records its `pathOrUrl` target; `fetch_url` and `scrape_docs` record the requested URL without credentials or parameters.

`mcp_stats_daily` stores one counter row per UTC day, caller, tool, library/version and transport. Each row contains call and success counts, total duration and the last activity timestamp. Addresses and search text are not aggregate dimensions. Historical average latency uses the total duration divided by the number of calls.

## History and Retention

Recent metadata is pruned at startup and after every 100 recorded calls. Cleanup removes calls older than 30 days and reduces the recent table to 20,000 rows. Between cleanups the table can temporarily exceed that cap by fewer than 100 calls.

Daily aggregates are retained independently. All Time and period totals read these aggregates, so pruning recent metadata does not reduce historical counts. Periods use UTC calendar days, including the current day. The graph and all breakdowns apply the same caller, tool, library and period filters.

Migration 021 imports the legacy rows still present at upgrade time into daily aggregates before removing payload columns. Previously pruned calls cannot be reconstructed. Old arbitrary query and error text is discarded rather than converted into document addresses. Migration 022 removes the old token table and preserves both statistics tables. Migration 023 adds a registry for optional app tokens and stores their hashes separately from usage statistics.

Migration 024 adds failure reasons to recent calls. Earlier failures display **Reason unavailable**.
