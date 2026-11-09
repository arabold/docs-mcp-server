# configuration Specification

## Purpose
Defines how the application configuration is structured, loaded, and overridden through config files, environment variables, and CLI commands. Includes bootstrap-time environment normalization.

## Requirements

### Requirement: Nested Document Configuration Under Scraper

The system SHALL organize document processing settings under `scraper.document.*` in the configuration hierarchy.

#### Scenario: Document Max Size Configuration

- **GIVEN** a configuration file with `scraper.document.maxSize` set to `52428800`
- **WHEN** the `DocumentPipeline` processes a document
- **THEN** it SHALL use `52428800` as the maximum allowed document size

#### Scenario: Default Document Max Size

- **GIVEN** no custom configuration for `scraper.document.maxSize`
- **WHEN** the configuration is loaded
- **THEN** the default value of `10485760` (10MB) SHALL be used

### Requirement: Generic Environment Variable Overrides
The system SHALL support overriding any configuration setting via environment variables using a predictable naming convention. Environment-derived configuration values SHALL be normalized by trimming surrounding whitespace and stripping matching surrounding single or double quotes before schema parsing.

#### Scenario: Environment Variable Naming Convention
- **GIVEN** a config path `scraper.document.maxSize`
- **WHEN** the environment variable `DOCS_MCP_SCRAPER_DOCUMENT_MAX_SIZE` is set
- **THEN** its value SHALL override the config file and default values

#### Scenario: Quoted configuration override from Docker Compose
- **GIVEN** the environment variable `DOCS_MCP_EMBEDDING_MODEL` is provided as `"openai:nomic-embed-text"`
- **WHEN** the configuration is loaded
- **THEN** the resulting `app.embeddingModel` value SHALL be `openai:nomic-embed-text`

#### Scenario: Whitespace-padded configuration override
- **GIVEN** the environment variable `DOCS_MCP_SCRAPER_MAX_PAGES` is provided as `  "500"  `
- **WHEN** the configuration is loaded
- **THEN** the resulting `scraper.maxPages` value SHALL be parsed as `500`

#### Scenario: CamelCase to Upper Snake Case Conversion
- **GIVEN** a config path segment `maxNestingDepth`
- **WHEN** converted to environment variable format
- **THEN** it SHALL become `MAX_NESTING_DEPTH`

#### Scenario: Deeply Nested Path Conversion
- **GIVEN** a config path `splitter.json.maxNestingDepth`
- **WHEN** converted to environment variable name
- **THEN** it SHALL become `DOCS_MCP_SPLITTER_JSON_MAX_NESTING_DEPTH`

#### Scenario: Nested security override naming
- **GIVEN** a config path `scraper.security.fileAccess.followSymlinks`
- **WHEN** converted to environment variable name
- **THEN** it SHALL become `DOCS_MCP_SCRAPER_SECURITY_FILE_ACCESS_FOLLOW_SYMLINKS`

#### Scenario: Array override provided as JSON
- **GIVEN** the environment variable `DOCS_MCP_SCRAPER_SECURITY_NETWORK_ALLOWED_HOSTS` is provided as `["docs.internal.example","wiki.corp.local"]`
- **WHEN** the configuration is loaded
- **THEN** the resulting `scraper.security.network.allowedHosts` value SHALL be parsed as a string array

#### Scenario: Array override provided as inline array string
- **GIVEN** the environment variable `DOCS_MCP_SCRAPER_SECURITY_FILE_ACCESS_ALLOWED_ROOTS` is provided as `["$DOCUMENTS", "/srv/docs"]`
- **WHEN** the configuration is loaded
- **THEN** the resulting `scraper.security.fileAccess.allowedRoots` value SHALL be parsed as a string array

### Requirement: Environment Variable Precedence

The system SHALL resolve every configuration setting from these layers, highest priority first: an option passed on the command line, then environment variables, then the configuration file, then the built-in default. A command-line option the user did not pass SHALL NOT count as a command-line value: it SHALL leave the setting to the lower layers. This SHALL hold for every setting that a command-line option maps to, on every command that exposes the option.

#### Scenario: Auto-Generated Env Var Takes Precedence Over Explicit Alias

- **GIVEN** both `PORT=3000` and `DOCS_MCP_SERVER_PORTS_DEFAULT=4000` are set
- **WHEN** the configuration is loaded
- **THEN** `server.ports.default` SHALL be `4000` (auto-generated wins)

#### Scenario: CLI Args Override Environment Variables

- **GIVEN** `DOCS_MCP_APP_STORE_PATH=/env/path` is set
- **AND** `--storePath=/cli/path` is passed
- **WHEN** the configuration is loaded
- **THEN** `app.storePath` SHALL be `/cli/path`

#### Scenario: Omitted flag leaves the environment value in effect

- **GIVEN** `DOCS_MCP_AUTH_ENABLED=true` is set
- **WHEN** the `mcp` command starts without `--auth-enabled`
- **THEN** `auth.enabled` SHALL be `true`

#### Scenario: Omitted flag leaves the config file value in effect

- **GIVEN** the configuration file sets `app.readOnly` to `true`
- **AND** no environment variable sets it
- **WHEN** the `server` command starts without `--read-only`
- **THEN** `app.readOnly` SHALL be `true`

#### Scenario: Transport protocol comes from configuration when the flag is omitted

- **GIVEN** `DOCS_MCP_PROTOCOL=http` is set
- **AND** the process runs without a terminal attached
- **WHEN** the `mcp` command starts without `--protocol`
- **THEN** the server SHALL serve MCP over HTTP rather than stdio

#### Scenario: Explicitly passed negation overrides the environment

- **GIVEN** `DOCS_MCP_READ_ONLY=true` is set
- **WHEN** the `server` command starts with `--no-read-only`
- **THEN** `app.readOnly` SHALL be `false`

#### Scenario: Built-in defaults apply when no layer sets a value

- **GIVEN** no command-line option, environment variable, or configuration file entry sets `auth.enabled`, `app.readOnly`, or `server.protocol`
- **WHEN** the `server` command starts
- **THEN** `auth.enabled` SHALL be `false`, `app.readOnly` SHALL be `false`, and `server.protocol` SHALL be `auto`

### Requirement: Bootstrap Environment Normalization

The application bootstrap SHALL normalize runtime environment variable values after `.env` files are loaded and before application modules interpret `process.env`. Normalization SHALL trim surrounding whitespace and strip matching surrounding single or double quotes, while leaving internal characters unchanged.

#### Scenario: Quoted provider base URL at startup

- **GIVEN** `OPENAI_API_BASE` is supplied by the host environment as `"http://localhost:11434/v1"`
- **WHEN** the application bootstrap completes
- **THEN** runtime modules SHALL observe `OPENAI_API_BASE` as `http://localhost:11434/v1`

#### Scenario: Quoted GitHub token at startup

- **GIVEN** `GITHUB_TOKEN` is supplied by the host environment as `"ghp_test_token"`
- **WHEN** GitHub authentication headers are resolved
- **THEN** the generated `Authorization` header SHALL use `Bearer ghp_test_token`

#### Scenario: Quoted Playwright path at startup

- **GIVEN** `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` is supplied as `"/usr/bin/chromium"`
- **WHEN** Playwright browser configuration is evaluated
- **THEN** the path existence check SHALL use `/usr/bin/chromium`

#### Scenario: Internal quotes are preserved

- **GIVEN** an environment variable value contains internal quotes but no matching outer quotes
- **WHEN** bootstrap normalization runs
- **THEN** the value SHALL remain otherwise unchanged

### Requirement: Config CLI Get Command

The system SHALL provide a `config get <path>` CLI command to retrieve individual configuration values.

#### Scenario: Get Scalar Value

- **GIVEN** the configuration has `scraper.maxPages` set to `1000`
- **WHEN** the user runs `docs-mcp-server config get scraper.maxPages`
- **THEN** the output SHALL be `1000`

#### Scenario: Get Nested Object

- **GIVEN** the configuration has `scraper.fetcher` with multiple settings
- **WHEN** the user runs `docs-mcp-server config get scraper.fetcher`
- **THEN** the output SHALL be the JSON representation of the nested object

#### Scenario: Get Invalid Path

- **GIVEN** the path `foo.bar.baz` does not exist in the schema
- **WHEN** the user runs `docs-mcp-server config get foo.bar.baz`
- **THEN** an error message SHALL indicate the path is invalid

### Requirement: Config CLI Set Command

The system SHALL provide a `config set <path> <value>` CLI command to persist configuration changes.

#### Scenario: Set Numeric Value

- **GIVEN** a valid config path `scraper.document.maxSize`
- **WHEN** the user runs `docs-mcp-server config set scraper.document.maxSize 52428800`
- **THEN** the value SHALL be persisted to the config file as a number

#### Scenario: Set Boolean Value

- **GIVEN** a valid config path `app.telemetryEnabled`
- **WHEN** the user runs `docs-mcp-server config set app.telemetryEnabled false`
- **THEN** the value SHALL be persisted to the config file as a boolean

#### Scenario: Set String Value

- **GIVEN** a valid config path `app.embeddingModel`
- **WHEN** the user runs `docs-mcp-server config set app.embeddingModel text-embedding-ada-002`
- **THEN** the value SHALL be persisted to the config file as a string

#### Scenario: Set Invalid Path Rejected

- **GIVEN** the path `invalid.setting` does not exist in the schema
- **WHEN** the user runs `docs-mcp-server config set invalid.setting value`
- **THEN** an error message SHALL indicate the path is invalid
- **AND** no changes SHALL be made to the config file

#### Scenario: Set Blocked in Read-Only Mode

- **GIVEN** the user specified an explicit config file with `--config`
- **WHEN** the user runs `docs-mcp-server config set scraper.maxPages 500`
- **THEN** an error message SHALL indicate that explicit config files are read-only

### Requirement: Config Output Format Options

The system SHALL support `--json` and `--yaml` flags to control output format for `config` and `config get` commands.

#### Scenario: Default Output Format for Scalars

- **GIVEN** the user runs `docs-mcp-server config get scraper.maxPages`
- **WHEN** no format flag is specified
- **THEN** the output SHALL be the plain scalar value (e.g., `1000`)

#### Scenario: Default Output Format for Objects

- **GIVEN** the user runs `docs-mcp-server config get scraper.fetcher`
- **WHEN** no format flag is specified
- **THEN** the output SHALL be JSON-formatted

#### Scenario: JSON Format Flag

- **GIVEN** the user runs `docs-mcp-server config --json`
- **WHEN** the config is displayed
- **THEN** the output SHALL be JSON-formatted

#### Scenario: YAML Format Flag

- **GIVEN** the user runs `docs-mcp-server config --yaml`
- **WHEN** the config is displayed
- **THEN** the output SHALL be YAML-formatted

#### Scenario: Format Flag on Get Command

- **GIVEN** the user runs `docs-mcp-server config get scraper --yaml`
- **WHEN** the value is displayed
- **THEN** the output SHALL be YAML-formatted

### Requirement: Skip-Known-Trackers Flag Under Scraper

The system SHALL expose a `scraper.skipKnownTrackers` boolean in the typed configuration schema, defaulting to `true`, that governs whether the built-in sub-resource blocklist is consulted during Playwright-driven page rendering. The flag SHALL participate in the standard configuration override chain (config file < environment variables < CLI arguments) and SHALL be persisted through the normal `loadConfig` auto-save path so that existing on-disk config files gain the new key with its default value on first start after upgrade.

#### Scenario: Default value when not configured
- **GIVEN** no configuration file or environment override sets `scraper.skipKnownTrackers`
- **WHEN** the application loads its configuration
- **THEN** the resolved value of `scraper.skipKnownTrackers` is `true`

#### Scenario: Configuration file override
- **GIVEN** a configuration file with `scraper.skipKnownTrackers` set to `false`
- **WHEN** the application loads its configuration
- **THEN** the resolved value of `scraper.skipKnownTrackers` is `false`

#### Scenario: Environment variable override
- **GIVEN** the environment variable `DOCS_MCP_SCRAPER_SKIP_KNOWN_TRACKERS` is set to `false`
- **WHEN** the application loads its configuration
- **THEN** the resolved value of `scraper.skipKnownTrackers` is `false`
- **AND** the environment value takes precedence over a conflicting file value

#### Scenario: Upgrade path supplies the new key
- **GIVEN** an existing on-disk configuration file written by a prior release that lacks `scraper.skipKnownTrackers`
- **WHEN** the application starts and `loadConfig` runs
- **THEN** the resolved configuration contains `scraper.skipKnownTrackers: true`
- **AND** previously set keys in that file retain their values

### Requirement: Scrape Failure Rate Threshold Configuration
The configuration system SHALL expose `scraper.abortOnFailureRate` as the child-page failure-rate threshold used to abort unhealthy scrape targets. The value SHALL be a floating-point fraction in the inclusive range `[0.0, 1.0]`, where `0.0` means any completed child-page failure above the minimum sample triggers an abort and `1.0` means the scraper never aborts based on failure rate alone.

#### Scenario: Config file sets scrape failure rate threshold
- **WHEN** the configuration file sets `scraper.abortOnFailureRate` to a numeric value in the inclusive range `[0.0, 1.0]`
- **THEN** the scraper SHALL interpret that value as the maximum allowed fraction of terminally failed child pages among completed child-page attempts

#### Scenario: Environment variable overrides scrape failure rate threshold
- **WHEN** the environment variable `DOCS_MCP_SCRAPER_ABORT_ON_FAILURE_RATE` is set
- **THEN** the environment variable value SHALL override config file and default values for `scraper.abortOnFailureRate`

#### Scenario: Default scrape failure rate threshold is one half
- **WHEN** no explicit configuration for `scraper.abortOnFailureRate` is provided
- **THEN** the loaded configuration SHALL set `scraper.abortOnFailureRate` to `0.5`

### Requirement: Updated Default HTTP Retry Configuration
The configuration system SHALL default `scraper.fetcher.maxRetries` to `3`.

#### Scenario: Default fetch retry count is three
- **WHEN** no explicit configuration for `scraper.fetcher.maxRetries` is provided
- **THEN** the loaded configuration SHALL set `scraper.fetcher.maxRetries` to `3`

#### Scenario: Explicit fetch retry override still wins
- **WHEN** the user provides an explicit value for `scraper.fetcher.maxRetries`
- **THEN** the loaded configuration SHALL use the explicit value instead of the default

### Requirement: Scraper Security Configuration
The system SHALL expose configuration for outbound network and local file access controls under `scraper.security`.

#### Scenario: Network mode defaults to open
- **GIVEN** no custom security configuration is provided
- **WHEN** the configuration is loaded
- **THEN** `scraper.security.network.mode` SHALL default to `open`

#### Scenario: Allowlist mode is selectable via configuration
- **GIVEN** `scraper.security.network.mode` is `allowlist`
- **WHEN** the configuration is loaded
- **THEN** the outbound network policy SHALL permit only targets that match `allowedHosts` or `allowedCidrs`
- **AND** `allowPrivateNetworks` SHALL not affect access decisions in allowlist mode

#### Scenario: Allowed host patterns accept globs and regex
- **GIVEN** `scraper.security.network.allowedHosts` contains `docs.internal.example`, `*.corp.local`, and `/^docs\d+\.example\.com$/`
- **WHEN** the configuration is loaded
- **THEN** entries SHALL be parsed as host patterns matching the bare hostname
- **AND** literal entries SHALL match exactly, glob entries SHALL match via minimatch, and `/.../` entries SHALL match via JavaScript regular expressions

#### Scenario: Private network access defaults to disabled
- **GIVEN** no custom security configuration is provided
- **WHEN** the configuration is loaded
- **THEN** private network access for scraper-driven HTTP(S) fetches SHALL default to disabled

#### Scenario: Host allowlist can permit a specific internal hostname
- **GIVEN** `scraper.security.network.allowPrivateNetworks` is `false`
- **AND** `scraper.security.network.allowedHosts` contains `docs.internal.example`
- **WHEN** the configuration is loaded
- **THEN** requests explicitly targeting `docs.internal.example` SHALL be eligible for access despite the default private-network restriction
- **AND** direct IP requests SHALL still require `allowedCidrs` or `allowPrivateNetworks`

#### Scenario: CIDR allowlist can permit a specific internal subnet
- **GIVEN** `scraper.security.network.allowPrivateNetworks` is `false`
- **AND** `scraper.security.network.allowedCidrs` contains `10.42.0.0/16`
- **WHEN** the configuration is loaded
- **THEN** requests whose resolved address falls within `10.42.0.0/16` SHALL be eligible for access despite the default private-network restriction

#### Scenario: Empty network allowlists do not permit private targets
- **GIVEN** `scraper.security.network.allowPrivateNetworks` is `false`
- **AND** `scraper.security.network.allowedHosts` is empty
- **AND** `scraper.security.network.allowedCidrs` is empty
- **WHEN** the configuration is loaded
- **THEN** no private or special-use network targets SHALL be permitted by configuration

#### Scenario: Private network override enables broad internal access
- **GIVEN** `scraper.security.network.allowPrivateNetworks` is `true`
- **WHEN** the configuration is loaded
- **THEN** private, loopback, link-local, and other special-use network targets SHALL be eligible for access

#### Scenario: Invalid TLS verification defaults to disabled override
- **GIVEN** no custom security configuration is provided
- **WHEN** the configuration is loaded
- **THEN** `scraper.security.network.allowInvalidTls` SHALL default to `false`

#### Scenario: Broad invalid TLS override enables all HTTPS targets
- **GIVEN** `scraper.security.network.allowInvalidTls` is `true`
- **WHEN** the configuration is loaded
- **THEN** HTTPS requests SHALL be eligible to bypass invalid certificate errors

#### Scenario: File access mode defaults to allowed roots
- **GIVEN** no custom security configuration is provided
- **WHEN** the configuration is loaded
- **THEN** local file access mode SHALL default to `allowedRoots`

#### Scenario: Documents root is configured by default
- **GIVEN** no custom security configuration is provided
- **WHEN** the configuration is loaded
- **THEN** the allowed file roots SHALL include `$DOCUMENTS`

#### Scenario: Internal archive handoff does not require temp root configuration
- **GIVEN** no custom security configuration is provided
- **WHEN** the system processes a supported web archive root via an internal temporary file
- **THEN** the default file access configuration SHALL not require the OS temporary directory to be added to `allowedRoots`

#### Scenario: Empty file root allowlist denies user-requested file access
- **GIVEN** `scraper.security.fileAccess.mode` is `allowedRoots`
- **AND** `scraper.security.fileAccess.allowedRoots` is empty
- **WHEN** the configuration is loaded
- **THEN** user-requested `file://` access SHALL not be permitted by configuration

#### Scenario: Unresolvable documents token grants no access
- **GIVEN** `scraper.security.fileAccess.allowedRoots` contains `$DOCUMENTS`
- **AND** the runtime cannot resolve a documents directory for the current platform or account
- **WHEN** the configuration is loaded and file access policy is evaluated
- **THEN** `$DOCUMENTS` SHALL not expand to an implicit fallback path
- **AND** no access SHALL be granted from that token alone

#### Scenario: Supported allowed-root tokens
- **GIVEN** `scraper.security.fileAccess.allowedRoots` accepts tokens that expand at runtime
- **WHEN** the configuration is loaded
- **THEN** the supported tokens SHALL include `$HOME`, `$DOCUMENTS`, `$DOWNLOADS`, `$DESKTOP`, and `$CWD`
- **AND** any other value SHALL be treated as a literal filesystem path
- **AND** a token that cannot be resolved at runtime SHALL grant no access by itself

#### Scenario: Hidden path access defaults to disabled
- **GIVEN** no custom security configuration is provided
- **WHEN** the configuration is loaded
- **THEN** hidden file and directory access SHALL default to disabled

#### Scenario: Symlink following defaults to disabled
- **GIVEN** no custom security configuration is provided
- **WHEN** the configuration is loaded
- **THEN** symlink following for local file access SHALL default to disabled

### Requirement: Vector Dimension Configuration
The system SHALL support a configurable vector dimension via the `embeddings.vectorDimension` configuration key. This value determines the size of the `documents_vec` virtual table column and the target dimension for vector padding/truncation.

The configuration key SHALL follow the standard configuration precedence:
1. Built-in default: `1536` (lowest priority)
2. Configuration file (`config.yaml`, key `embeddings.vectorDimension`)
3. Environment variable (`DOCS_MCP_EMBEDDINGS_VECTOR_DIMENSION`)
4. CLI arguments (highest priority)

The Zod schema SHALL validate that `vectorDimension` is a positive integer (`>= 1`). Values of 0, negative numbers, or non-integers SHALL be rejected at configuration load time.

#### Scenario: Default vector dimension
- **WHEN** no `vectorDimension` override is specified
- **THEN** the system SHALL use 1536 as the vector dimension

#### Scenario: Custom vector dimension via environment variable
- **WHEN** `DOCS_MCP_EMBEDDINGS_VECTOR_DIMENSION` is set to `768`
- **THEN** the system SHALL use 768 as the vector dimension
- **AND** the `documents_vec` table SHALL use `embedding FLOAT[768]`

#### Scenario: Invalid vector dimension rejected
- **WHEN** `DOCS_MCP_EMBEDDINGS_VECTOR_DIMENSION` is set to `0`
- **THEN** the system SHALL reject the configuration with an error message
- **AND** startup SHALL fail

#### Scenario: Non-integer vector dimension rejected
- **WHEN** `DOCS_MCP_EMBEDDINGS_VECTOR_DIMENSION` is set to `768.5`
- **THEN** the system SHALL reject the configuration with an error message

### Requirement: Server Public Origin Configuration
The configuration system SHALL keep accepting the deprecated `server.publicOrigin` setting as the public URL of a server that is not hosted under a path. The setting SHALL keep its existing validation, and its use SHALL produce a deprecation warning that names `server.publicUrl`. When `server.publicUrl` is also set, `server.publicUrl` SHALL take effect, and the warning SHALL state that `server.publicOrigin` is ignored.

#### Scenario: Public origin absent by default
- **WHEN** no public origin is configured
- **THEN** the loaded configuration MUST leave `server.publicOrigin` unset
- **AND** generated URLs MUST use `server.publicUrl` when it is set, or the bind-derived origin fallback when it is not

#### Scenario: Public origin from config file
- **WHEN** a configuration file sets `server.publicOrigin` to `https://docs.example.com`
- **THEN** the loaded configuration MUST set `server.publicOrigin` to `https://docs.example.com`
- **AND** advertised URLs MUST use `https://docs.example.com` as the public URL

#### Scenario: Public origin from environment variable
- **WHEN** the environment variable `DOCS_MCP_SERVER_PUBLIC_ORIGIN` is set to `https://docs.example.com`
- **THEN** the loaded configuration MUST set `server.publicOrigin` to `https://docs.example.com`

#### Scenario: Public origin from CLI flag
- **WHEN** a long-running server command is invoked with `--public-origin https://docs.example.com`
- **THEN** the loaded configuration MUST set `server.publicOrigin` to `https://docs.example.com`
- **AND** the CLI value MUST take precedence over environment and config file values

#### Scenario: Public origin must be an origin
- **WHEN** `server.publicOrigin` is configured with a path, query string, fragment, or unsupported protocol
- **THEN** configuration loading MUST reject the value with a clear validation error

#### Scenario: Trailing slash is normalized
- **WHEN** `server.publicOrigin` is configured as `https://docs.example.com/`
- **THEN** the loaded configuration or URL-generation path MUST use `https://docs.example.com` as the canonical origin

#### Scenario: Deprecation warning
- **WHEN** `server.publicOrigin` is set and `server.publicUrl` is not
- **THEN** startup output MUST include a deprecation warning naming `server.publicUrl`

#### Scenario: Both settings present
- **WHEN** a configuration file sets `server.publicOrigin` to `https://old.example.com`
- **AND** `--public-url https://example.com/docs` is passed
- **THEN** advertised URLs MUST use `https://example.com/docs`
- **AND** startup output MUST warn that `server.publicOrigin` is ignored

### Requirement: Server Identity Configuration
The configuration system SHALL expose `server.name`, `server.title`, `server.instructions`, and `server.instructionsFile` settings that define how the MCP server identifies itself and what instructions it sends to clients during initialization.

#### Scenario: Default server name
- **WHEN** no server name is configured
- **THEN** the loaded configuration MUST set `server.name` to `docs-mcp-server`
- **AND** the MCP `initialize` result MUST report `serverInfo.name` as `docs-mcp-server` and `serverInfo.version` as the package version

#### Scenario: Server name precedence
- **WHEN** `server.name` is set in the configuration file, the environment variable `DOCS_MCP_SERVER_NAME`, and the CLI flag `--server-name`
- **THEN** the CLI value MUST take precedence over the environment value, which MUST take precedence over the configuration file value

#### Scenario: Server title is optional
- **WHEN** no server title is configured
- **THEN** the loaded configuration MUST leave `server.title` unset
- **AND** the MCP `initialize` result MUST omit `serverInfo.title`

#### Scenario: Server title from any source
- **WHEN** `server.title` is set via the configuration file, the environment variable `DOCS_MCP_SERVER_TITLE`, or the CLI flag `--server-title`
- **THEN** the MCP `initialize` result MUST report it as `serverInfo.title` alongside `serverInfo.name`
- **AND** the usual CLI > environment > configuration file precedence MUST apply

#### Scenario: Inline instructions
- **WHEN** `server.instructions` is set via the configuration file, `DOCS_MCP_SERVER_INSTRUCTIONS`, or `--server-instructions`
- **THEN** the MCP `initialize` result MUST include that text as `instructions`

#### Scenario: Instructions file read once at startup
- **WHEN** `server.instructionsFile` is set via the configuration file, `DOCS_MCP_SERVER_INSTRUCTIONS_FILE`, or `--server-instructions-file`
- **THEN** the server MUST read the file once at startup and send its contents as `instructions` to every client session
- **AND** later changes to or removal of the file MUST NOT affect running sessions or new sessions

#### Scenario: Both instructions settings set
- **WHEN** both `server.instructions` and `server.instructionsFile` are set, from any combination of sources
- **THEN** server startup MUST fail with a clear error naming both settings

#### Scenario: Unreadable instructions file
- **WHEN** `server.instructionsFile` points to a file that cannot be read
- **THEN** server startup MUST fail with a clear error naming the file

#### Scenario: Blank values are treated as absent
- **WHEN** any of these settings is provided as an empty or whitespace-only string
- **THEN** the loaded configuration MUST treat it as unset so defaults apply

### Requirement: Default Server Instructions
When neither `server.instructions` nor `server.instructionsFile` is configured, the MCP server SHALL send built-in instructions as `instructions` in the `initialize` result. The built-in instructions SHALL tell the model to search the indexed documentation before answering from memory, and how to find the libraries and versions that are indexed. They SHALL name only tools that the server offers in its current mode. Configured instructions SHALL replace the built-in instructions entirely. The built-in instructions SHALL NOT be a configuration value.

#### Scenario: Built-in instructions when none are configured
- **WHEN** neither `server.instructions` nor `server.instructionsFile` is configured
- **THEN** the MCP `initialize` result MUST include the built-in instructions as `instructions`

#### Scenario: Indexing guidance when indexing is available
- **WHEN** the server is not in read-only mode and no instructions are configured
- **THEN** the built-in instructions MUST explain how to index a library that is not yet indexed and how to follow the progress of that indexing job

#### Scenario: Read-only mode
- **WHEN** the server runs in read-only mode and no instructions are configured
- **THEN** the built-in instructions MUST state that this server cannot index new documentation

#### Scenario: Only offered tools are named
- **WHEN** the built-in instructions name a tool
- **THEN** that tool MUST appear in the server's tool list in the same mode

#### Scenario: Configured instructions replace the built-in instructions
- **WHEN** `server.instructions` or `server.instructionsFile` is configured
- **THEN** the MCP `initialize` result MUST contain only the configured text as `instructions`, without any of the built-in text

#### Scenario: Built-in instructions stay out of the configuration
- **WHEN** no instructions are configured
- **THEN** the loaded configuration MUST leave `server.instructions` unset
- **AND** the automatically updated default configuration file MUST NOT contain the built-in instructions

### Requirement: Docker Server Defaults

The Docker image SHALL default to an HTTP server reachable through a published container port, with the Web UI, API, and MCP endpoint enabled. Supplying options unrelated to transport or binding SHALL preserve these defaults. Runtime environment variables and CLI arguments SHALL override the Docker defaults using the existing configuration precedence. Explicit subcommands SHALL retain their behavior, and non-container startup SHALL retain protocol auto-detection and loopback binding by default.

#### Scenario: No-argument Docker startup

- **WHEN** the Docker image is started without application arguments and its default port is published
- **THEN** the container SHALL remain running and serve the Web UI, API, and MCP endpoint on port `6280`

#### Scenario: Unrelated option preserves HTTP startup

- **WHEN** the Docker image is started with only `--verbose` and its default port is published
- **THEN** it SHALL serve the same HTTP endpoints as a no-argument launch

#### Scenario: Runtime environment selects stdio

- **WHEN** a Docker launch selects `stdio` through the server protocol environment override and keeps stdin open
- **THEN** the container SHALL serve MCP over stdio instead of starting an HTTP server

#### Scenario: CLI protocol overrides the image default

- **WHEN** a Docker launch supplies `--protocol stdio` and keeps stdin open
- **THEN** the container SHALL serve MCP over stdio instead of starting an HTTP server

#### Scenario: Runtime environment changes the server binding

- **WHEN** a Docker launch sets the server host and default port through runtime environment overrides
- **THEN** the server SHALL use the configured host and port instead of the image defaults

#### Scenario: Explicit subcommand remains a CLI operation

- **WHEN** the Docker image is started with an explicit `scrape` subcommand
- **THEN** it SHALL execute that operation and exit according to the command result rather than launching the default HTTP server

#### Scenario: Non-container defaults remain unchanged

- **WHEN** the application is started outside Docker without protocol or host overrides
- **THEN** it SHALL retain TTY-based protocol auto-detection and default loopback binding

### Requirement: Server Public URL Configuration
The configuration system SHALL expose an optional `server.publicUrl` setting: the absolute HTTP(S) URL at which clients reach the server, optionally including a path. It SHALL be settable from the configuration file, from the environment variable `DOCS_MCP_SERVER_PUBLIC_URL`, and with the `--public-url` flag on every long-running server command.

The configuration system SHALL reject, with a clear validation error, a value that:

- carries credentials, a query string, or a fragment;
- uses a protocol other than `http` or `https`;
- has a path with an empty segment (`//`);
- has a path whose first segment names a route or file the server itself serves at its root, such as `mcp`, `api`, `assets` or `favicon.ico`, or `oauth`, where the removed OAuth proxy endpoints answered.

A trailing slash SHALL be ignored.

#### Scenario: Public URL absent by default
- **WHEN** neither `server.publicUrl` nor `server.publicOrigin` is configured
- **THEN** the loaded configuration MUST leave both unset
- **AND** generated URLs MUST use the bind-derived origin fallback

#### Scenario: Public URL with a path
- **WHEN** a configuration file sets `server.publicUrl` to `https://example.com/docs`
- **THEN** the loaded configuration MUST set `server.publicUrl` to `https://example.com/docs`

#### Scenario: Public URL from environment variable
- **WHEN** the environment variable `DOCS_MCP_SERVER_PUBLIC_URL` is set to `https://example.com/docs`
- **THEN** the loaded configuration MUST set `server.publicUrl` to `https://example.com/docs`

#### Scenario: Public URL from CLI flag
- **WHEN** a long-running server command is invoked with `--public-url https://example.com/docs`
- **THEN** the loaded configuration MUST set `server.publicUrl` to `https://example.com/docs`

#### Scenario: Trailing slash is ignored
- **WHEN** `server.publicUrl` is configured as `https://example.com/docs/`
- **THEN** the canonical public URL MUST be `https://example.com/docs`

#### Scenario: Invalid public URL
- **WHEN** `server.publicUrl` is configured as `https://example.com/docs?x=1`
- **THEN** configuration loading MUST reject the value with a clear validation error

#### Scenario: Path collides with a server route
- **WHEN** `server.publicUrl` is configured as `https://example.com/mcp`
- **THEN** configuration loading MUST reject the value with an error explaining that the path's first segment collides with a route the server serves

#### Scenario: Path collides with the removed OAuth endpoints
- **WHEN** `server.publicUrl` is configured as `https://example.com/oauth`
- **THEN** configuration loading MUST reject the value, so a probe of `/oauth/authorize` still gets HTTP 404 rather than the web UI

#### Scenario: Path collides with a root file
- **WHEN** `server.publicUrl` is configured as `https://example.com/favicon.ico`
- **THEN** configuration loading MUST reject the value with an error explaining that the path's first segment collides with a file the server serves

#### Scenario: Path with an empty segment
- **WHEN** `server.publicUrl` is configured as `https://example.com//docs`
- **THEN** configuration loading MUST reject the value, because the web UI would resolve `//docs/` as another host
- **AND** it MUST reject `https://example.com/docs//` too, since only a single trailing slash is ignored

### Requirement: Allowed Browser Origins Configuration
The configuration system SHALL expose an optional `server.allowedOrigins` setting: a list of browser origins, beyond loopback and the public URL's origin, that may call the MCP endpoint. The hosts of these origins are also accepted in the `Host` header. It SHALL default to an empty list. It SHALL be settable from the configuration file and from the environment variable `DOCS_MCP_SERVER_ALLOWED_ORIGINS` as a JSON array. Each entry SHALL be an origin (`scheme://host` with an optional port and no path). Configuration loading SHALL reject any other value with a clear validation error. A trailing slash on an entry SHALL be ignored.

#### Scenario: Allowed origins from environment variable
- **WHEN** `DOCS_MCP_SERVER_ALLOWED_ORIGINS` is set to `["https://inspector.example.com"]`
- **THEN** the loaded configuration MUST set `server.allowedOrigins` to `["https://inspector.example.com"]`

#### Scenario: Entry that is not an origin
- **WHEN** `server.allowedOrigins` contains `https://inspector.example.com/app`
- **THEN** configuration loading MUST reject the value with a clear validation error
