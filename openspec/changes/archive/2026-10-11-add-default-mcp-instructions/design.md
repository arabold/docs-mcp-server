## Context

`resolveServerInstructions(config)` in `src/mcp/mcpServer.ts` turns `server.instructions` or `server.instructionsFile` into the text sent on `initialize`, and returns `undefined` when neither is set. Both MCP entry points call it once at startup (`startStdioServer()` and `registerMcpService()`) and pass the result to every `createMcpServerInstance()` call, including the per-session and per-request instances in HTTP mode.

`createMcpServerInstance()` registers `search_docs`, `read_page`, `list_pages`, `list_libraries`, `find_version` and `fetch_url` in every mode. `scrape_docs`, `refresh_version`, `list_jobs`, `get_job_info`, `cancel_job` and `remove_docs` are registered only when `app.readOnly` is false.

`loadConfig()` auto-saves `defaults` (the schema parsed with no input) merged with the file into the system default `config.yaml`. Any schema or `DEFAULT_CONFIG` default therefore ends up in the user's file.

## Goals / Non-Goals

**Goals:**
- One place decides which instructions a server sends: configured text, file contents, or the built-in default.
- The built-in text cannot name a tool that the current mode does not register without a test failing.

**Non-Goals:**
- Dynamic content such as the list of indexed libraries. It would be read once at startup, go stale as libraries are added, and grow with the index. `list_libraries` already covers it.
- Per-client or per-session instructions.
- Measuring the effect with the search benchmark. `npm run evaluate:search` scores retrieval quality for fixed queries and does not run an agent that picks tools, so it cannot see instructions.

## Decisions

### The default lives in code, not in the configuration defaults

The default is built by a function in the MCP layer, and `resolveServerInstructions()` falls back to it when nothing is configured.

Alternatives considered:
- A default for `server.instructions` in `DEFAULT_CONFIG` or the schema. The auto-save would write the text into every default `config.yaml`. From then on, setting `server.instructionsFile` would fail startup with the "both are set" error, and later improvements to the default would never reach existing installations.

### The fallback happens in `resolveServerInstructions()`, not in `createMcpServerInstance()`

`resolveServerInstructions()` now always returns a string, and `createMcpServerInstance()` takes `instructions` as a required parameter.

Alternatives considered:
- Fall back inside `createMcpServerInstance()` when `instructions` is `undefined`. A caller that forgot to pass the resolved text would then silently send the default instead of the operator's instructions. A required parameter lets the type checker catch that.

### The text depends on the mode

A function takes `readOnly` and returns one of two texts. In read-only mode the indexing paragraph is replaced by a sentence saying that this server cannot index new documentation.

Alternatives considered:
- One text for both modes that mentions indexing tools "if available". The model would still try tools that do not exist.
- Generate the text from the registered tool list. That produces a list of tool descriptions the model already has, not workflow guidance.

### A test keeps the named tools in sync with the registered tools

The test collects every backtick-quoted tool name in the default text, connects a client in each mode, and checks that each name is in `tools/list`. Renaming or gating a tool then fails the test instead of leaving the default text out of date.

### Configured text replaces the default

The default is not appended to configured instructions. Operators who configure instructions take over the whole text and can copy from the default when they want parts of it. Appending would give operators no way to remove guidance that conflicts with their own.

### No switch to turn instructions off

Blank values keep meaning "unset" (existing "Blank values are treated as absent" scenario), so a blank value brings back the default. An explicit "no instructions" value would add configuration surface that nobody has asked for. This can be added later without changing the default behavior.

## Program Design

```
src/mcp/
+ defaultInstructions.ts        # builds the built-in text for a given mode
~ mcpServer.ts                  # resolveServerInstructions() falls back to the default; instructions parameter becomes required
~ mcpServer.test.ts             # default, read-only variant, replacement, named tools are registered; call sites pass instructions
src/utils/
~ config.test.ts                # the auto-saved config.yaml never gains an instructions key
test/
~ mcp-stdio-e2e.test.ts         # a real client receives the default when nothing is configured
docs/setup/
~ configuration.md              # `instructions` default row describes the built-in text
~ ARCHITECTURE.md               # MCP Protocol Integration mentions server instructions (repository root)
```

Signatures:

```ts
// src/mcp/defaultInstructions.ts
export function buildDefaultInstructions(readOnly: boolean): string; // pure, never throws

// src/mcp/mcpServer.ts
export function resolveServerInstructions(config: AppConfig): string;
// throws when both settings are set or the file cannot be read (unchanged);
// returns buildDefaultInstructions(config.app.readOnly) when neither is set

export function createMcpServerInstance(
  tools: McpServerTools,
  config: AppConfig,
  instructions: string, // was optional
): McpServer;
```

`startStdioServer()` and `registerMcpService()` need no change: they already pass the result of `resolveServerInstructions()`.

Text when indexing is available. The read-only text replaces the last bullet with "This server is read-only and cannot index new documentation. `fetch_url` is for libraries that are not indexed: read their documentation to answer now.":

```
This server searches up-to-date documentation for libraries and packages. When a question depends on a library's API or behavior, search here before answering from memory.

- `search_docs` searches one library. Pass `version` when the project uses a specific version; without it, the newest indexed version is searched when there is one.
- Library names must match an indexed library. If a search cannot find the library, call `list_libraries` for the exact names and versions.
- `fetch_url` is for libraries that are not indexed: read their documentation to answer now. `scrape_docs` can index a library so later searches find it. Indexing runs in the background: check progress with `get_job_info` and search once the job has completed.
```

The text leaves out guidance that a tool description or a tool response already gives, and keeps the focus on `search_docs`. Two details matter because the text would otherwise mislead the model:

- "when there is one": a library with several tags such as `stable` and `next` and no semantic version has no newest version (see the version-resolution spec). Without a version, such a search falls back to unversioned documentation or returns the available versions. The version-not-found response lists them, and the model searched again with one of them in every run, with or without the text, so the text does not repeat that.
- The `fetch_url` bullet says which libraries it is for. An earlier wording ("If a library is not indexed, read its documentation with `fetch_url`") was the only place that told the model how to read documentation, and the model then read pages of an indexed library with `fetch_url` in 2 of 5 runs. Without any text it used `read_page` every time. Scoping `fetch_url` restores that without promoting `read_page`, which is a minor tool next to `search_docs`.

### Evaluation

A one-off promptfoo run (`gpt-5.4-mini`, 8 runs per variant) replayed short conversations with and without the final text as the system prompt and checked the model's next step:

| Situation | With text | Without |
|---|---|---|
| New question, no version mentioned: a lookup tool first | 8/8 | 7/8 |
| New question, project uses React 18.2: `search_docs` with that version | 8/8 | 5/8 |
| `search_docs` reports the library is not indexed: discover or index next | 8/8 | 7/8 |
| `list_libraries` shows the library is missing: read its documentation instead of answering from memory | 8/8 | 0/8 |
| Search excerpts cover only part of a page: `read_page` next | 8/8 | 7/8 |
| Search returns available versions instead of results: search again with one of them | 8/8 | 8/8 |

Earlier runs with successive drafts showed the same pattern. An earlier draft also asked the model to end its answer by offering to index the library; it did so in 0 of 10 runs, so that sentence was dropped.

## Risks / Trade-offs

- [Every session carries the text in the model context, even when the tools are never used] → Keep the default to a few lines with cross-tool guidance only. Anything a single tool description already says stays out.
- [Clients differ: some ignore `instructions`] → The default only adds guidance. Tool descriptions stay complete on their own.
- [The effect on model behavior is not measured automatically] → A one-off promptfoo evaluation replays short conversations with and without the text as the system prompt and compares the model's next tool call. promptfoo's own MCP client ignores `instructions`, so the evaluation passes the text the way a client that honors `instructions` does.
- [Operators who relied on no instructions being sent now get the default] → Released versions never sent instructions, and the setting that controls them is not released yet, so no released configuration depends on the old behavior.
