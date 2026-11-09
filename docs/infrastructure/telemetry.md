# Telemetry

The server sends usage events to PostHog, so the maintainers can see which features are used and where they fail. Telemetry is on by default in release builds and can be turned off with one setting.

## Turning Telemetry Off

Any of these turns telemetry off:

- the CLI flag `--no-telemetry` (or `--telemetry=false`), for one run;
- the environment variable `DOCS_MCP_TELEMETRY=false`, or the generic `DOCS_MCP_APP_TELEMETRY_ENABLED=false`;
- `app.telemetryEnabled: false` in the configuration file.

The CLI flag wins over the environment, and the environment over the configuration file; see [Configuration](../setup/configuration.md). With `--verbose`, the log states whether telemetry is on, and if it is off, whether that is the user's choice or a build without a PostHog key.

Only builds made with a `POSTHOG_API_KEY` send anything. The release workflow builds the npm package and the Docker image with the key. A build from source without it sends no events.

## What Is Sent

Every event carries an installation ID: a random UUID created on first run and kept in an `installation.id` file in the store directory (`--store-path`, `DOCS_MCP_STORE_PATH`, or the default data directory), so events from one installation can be grouped. It is random and not tied to any account. PostHog's GeoIP lookup is turned off.

Each event also carries context about the running process:

- for a server: the app version, platform and Node.js version, the enabled services, whether authentication and read-only mode are on, and the embedding provider, model and dimensions;
- for a CLI command: the app version, platform, Node.js version and command name.

The events are:

- `app_started` and `app_shutdown`, when a server starts and stops. They carry the enabled services, the port, whether jobs run on a remote worker, the starting command, and whether the shutdown was clean.
- `cli_command`, when a CLI command starts. It carries the command's options. For `scrape` and `fetch-url` that includes the host name and protocol of the URL, not the full URL; for `search`, the length of the query, not the query; for the library commands, the library name and version. Header values passed with `--header` are not sent, only whether there were any.
- `tool_used`, when an MCP client calls a tool. It carries the tool name and some of its arguments: library names and versions, the host name and protocol (not the full URL) for `scrape_docs` and `fetch_url`, and the length of a `search_docs` query (not the query).
- `pipeline_job_started`, `pipeline_job_completed` and `pipeline_job_failed`, for scrape and refresh jobs. They carry the job ID, the library name, whether a version was given, the page limit, the time spent waiting and running, the pages processed, and for a failed job its error message with URLs, file paths and tokens removed.

Errors go to PostHog's error tracking with their type, message and stack trace, after the same clean-up: URLs, file paths and tokens are removed from the message, and each stack frame keeps only its file name, or its package path below `node_modules`. The errors are unhandled errors and promise rejections in a server, errors the HTTP server answers with an error response (with the method and route pattern), and failures to store processed content (with the library, version, MIME type and content size).

No event carries document content, a full URL or a search query. Library names, versions and host names are sent as they are.

## How It Works

The `telemetry` object in [src/telemetry/telemetry.ts](../../src/telemetry/telemetry.ts) holds the process's context, adds it to each event, and hands the event to `PostHogClient` ([src/telemetry/postHogClient.ts](../../src/telemetry/postHogClient.ts)), which renames properties to snake_case and sends them in batches. Before an error is sent, `sanitizeErrorForTracking` in [src/telemetry/sanitizer.ts](../../src/telemetry/sanitizer.ts) removes URLs, paths and tokens from it. The CLI middleware in [src/cli/index.ts](../../src/cli/index.ts) turns telemetry on or off for the run before any command starts. When it is off, every call returns at once.

The events come from the code they describe: CLI command handlers, the MCP tool handlers in [src/mcp/mcpServer.ts](../../src/mcp/mcpServer.ts), and the lifecycle and error handlers of `AppServer`. `TelemetryService` ([src/telemetry/TelemetryService.ts](../../src/telemetry/TelemetryService.ts)) reports pipeline jobs from the event bus. `openBackend()` starts it together with a local pipeline, so only the process that runs a job reports it: a coordinator that relays a remote worker's events reports none of them.

A failure to send never affects the application. The client logs it at debug level and carries on.
