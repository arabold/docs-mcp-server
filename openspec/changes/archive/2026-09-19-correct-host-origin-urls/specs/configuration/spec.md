## ADDED Requirements

### Requirement: Server Public Origin Configuration
The configuration system SHALL expose an optional `server.publicOrigin` setting that defines the absolute HTTP(S) origin used for externally advertised server URLs.

#### Scenario: Public origin absent by default
- **WHEN** no public origin is configured
- **THEN** the loaded configuration MUST leave `server.publicOrigin` unset
- **AND** generated URLs MUST use the bind-derived origin fallback

#### Scenario: Public origin from config file
- **WHEN** a configuration file sets `server.publicOrigin` to `https://docs.example.com`
- **THEN** the loaded configuration MUST set `server.publicOrigin` to `https://docs.example.com`

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
