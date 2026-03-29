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

### Requirement: Scraper Security Configuration
The system SHALL expose configuration for outbound network and local file access controls under `scraper.security`.

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

#### Scenario: Hidden path access defaults to disabled
- **GIVEN** no custom security configuration is provided
- **WHEN** the configuration is loaded
- **THEN** hidden file and directory access SHALL default to disabled

#### Scenario: Symlink following defaults to disabled
- **GIVEN** no custom security configuration is provided
- **WHEN** the configuration is loaded
- **THEN** symlink following for local file access SHALL default to disabled
