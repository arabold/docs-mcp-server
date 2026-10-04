# Spec Delta

## ADDED Requirements

### Requirement: Server Public URL Configuration
The configuration system SHALL expose an optional `server.publicUrl` setting: the absolute HTTP(S) URL at which clients reach the server, optionally including a path. It SHALL be settable from the configuration file, from the environment variable `DOCS_MCP_SERVER_PUBLIC_URL`, and with the `--public-url` flag on every long-running server command.

The configuration system SHALL reject, with a clear validation error, a value that:

- carries credentials, a query string, or a fragment;
- uses a protocol other than `http` or `https`;
- has a path with an empty segment (`//`);
- has a path whose first segment names a route or file the server itself serves at its root, such as `mcp`, `api`, `assets` or `favicon.ico`.

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

#### Scenario: Path collides with a root file
- **WHEN** `server.publicUrl` is configured as `https://example.com/favicon.ico`
- **THEN** configuration loading MUST reject the value with an error explaining that the path's first segment collides with a file the server serves

#### Scenario: Path with an empty segment
- **WHEN** `server.publicUrl` is configured as `https://example.com//docs`
- **THEN** configuration loading MUST reject the value, because the web UI would resolve `//docs/` as another host

### Requirement: Allowed Browser Origins Configuration
The configuration system SHALL expose an optional `server.allowedOrigins` setting: a list of browser origins, beyond loopback and the public URL's origin, that may call the MCP endpoint. The hosts of these origins are also accepted in the `Host` header. It SHALL default to an empty list. It SHALL be settable from the configuration file and from the environment variable `DOCS_MCP_SERVER_ALLOWED_ORIGINS` as a JSON array. Each entry SHALL be an origin (`scheme://host` with an optional port and no path). Configuration loading SHALL reject any other value with a clear validation error. A trailing slash on an entry SHALL be ignored.

#### Scenario: Allowed origins from environment variable
- **WHEN** `DOCS_MCP_SERVER_ALLOWED_ORIGINS` is set to `["https://inspector.example.com"]`
- **THEN** the loaded configuration MUST set `server.allowedOrigins` to `["https://inspector.example.com"]`

#### Scenario: Entry that is not an origin
- **WHEN** `server.allowedOrigins` contains `https://inspector.example.com/app`
- **THEN** configuration loading MUST reject the value with a clear validation error

## MODIFIED Requirements

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
