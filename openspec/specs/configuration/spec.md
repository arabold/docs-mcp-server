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

The system SHALL apply configuration overrides in a defined priority order.

#### Scenario: Auto-Generated Env Var Takes Precedence Over Explicit Alias

- **GIVEN** both `PORT=3000` and `DOCS_MCP_SERVER_PORTS_DEFAULT=4000` are set
- **WHEN** the configuration is loaded
- **THEN** `server.ports.default` SHALL be `4000` (auto-generated wins)

#### Scenario: CLI Args Override Environment Variables

- **GIVEN** `DOCS_MCP_APP_STORE_PATH=/env/path` is set
- **AND** `--storePath=/cli/path` is passed
- **WHEN** the configuration is loaded
- **THEN** `app.storePath` SHALL be `/cli/path`

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

