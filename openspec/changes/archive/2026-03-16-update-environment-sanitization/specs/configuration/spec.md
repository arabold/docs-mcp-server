## MODIFIED Requirements
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

## ADDED Requirements
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
