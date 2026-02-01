# configuration Specification

## Purpose

Defines how the application configuration is structured, loaded, and overridden through config files, environment variables, and CLI commands.

## ADDED Requirements

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

The system SHALL support overriding any configuration setting via environment variables using a predictable naming convention.

#### Scenario: Environment Variable Naming Convention

- **GIVEN** a config path `scraper.document.maxSize`
- **WHEN** the environment variable `DOCS_MCP_SCRAPER_DOCUMENT_MAX_SIZE` is set
- **THEN** its value SHALL override the config file and default values

#### Scenario: CamelCase to Upper Snake Case Conversion

- **GIVEN** a config path segment `maxNestingDepth`
- **WHEN** converted to environment variable format
- **THEN** it SHALL become `MAX_NESTING_DEPTH`

#### Scenario: Deeply Nested Path Conversion

- **GIVEN** a config path `splitter.json.maxNestingDepth`
- **WHEN** converted to environment variable name
- **THEN** it SHALL become `DOCS_MCP_SPLITTER_JSON_MAX_NESTING_DEPTH`

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
