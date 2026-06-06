## ADDED Requirements

### Requirement: Distinguish bind host from advertised origin
The server SHALL treat the configured bind host as the network interface used for listening and SHALL treat the configured public origin as the canonical origin for externally advertised absolute URLs when that public origin is present.

#### Scenario: Bind host controls listener
- **WHEN** the server starts with `server.host` set to `0.0.0.0`
- **THEN** the HTTP listener MUST bind with host `0.0.0.0`
- **AND** the bind host MUST NOT be replaced by `localhost` or `127.0.0.1` before calling the HTTP server listen API

#### Scenario: Public origin controls advertised URLs
- **WHEN** `server.publicOrigin` is set to `https://docs.example.com`
- **THEN** generated externally advertised endpoint URLs MUST use `https://docs.example.com`
- **AND** the generated externally advertised endpoint URLs MUST NOT use the bind host unless the public origin is absent

#### Scenario: Bind-derived origin fallback
- **WHEN** `server.publicOrigin` is not set
- **AND** the server binds to host `0.0.0.0` on port `6280`
- **THEN** generated fallback endpoint URLs MUST use `http://0.0.0.0:6280`
- **AND** they MUST NOT fall back to hard-coded `localhost` or `127.0.0.1`

#### Scenario: IPv6 bind host formatting
- **WHEN** `server.publicOrigin` is not set
- **AND** the server binds to IPv6 host `::` on port `6280`
- **THEN** generated fallback endpoint URLs MUST use bracketed IPv6 host formatting such as `http://[::]:6280`

### Requirement: Generate OAuth metadata from the canonical origin
When authentication is enabled, OAuth authorization-server metadata, protected-resource metadata, advertised MCP transport URLs, and proxied OAuth resource parameters SHALL be generated from the canonical server origin.

#### Scenario: OAuth metadata uses public origin
- **WHEN** authentication is enabled
- **AND** `server.publicOrigin` is set to `https://docs.example.com`
- **THEN** `/.well-known/oauth-authorization-server` MUST advertise OAuth endpoints under `https://docs.example.com`
- **AND** `/.well-known/oauth-protected-resource` MUST advertise MCP transport endpoints under `https://docs.example.com`

#### Scenario: OAuth metadata falls back to bind origin
- **WHEN** authentication is enabled
- **AND** `server.publicOrigin` is not set
- **AND** the server binds to host `0.0.0.0` on port `6280`
- **THEN** OAuth metadata MUST use `http://0.0.0.0:6280` as its fallback origin
- **AND** OAuth metadata MUST NOT use hard-coded `http://localhost:6280`

#### Scenario: OAuth resource parameter uses canonical origin
- **WHEN** authentication is enabled
- **AND** an OAuth authorization or token request is proxied upstream
- **THEN** the forced OAuth `resource` parameter MUST be derived from the canonical server origin
- **AND** it MUST remain consistent with the protected-resource metadata resource URL

#### Scenario: Metadata does not trust request host
- **WHEN** a request for OAuth metadata includes a spoofed `Host` header
- **THEN** generated OAuth metadata MUST continue to use the configured canonical origin
- **AND** it MUST NOT use the spoofed request host

### Requirement: Warn on ambiguous auth wildcard origins
The server SHALL warn operators when auth metadata must fall back to a wildcard bind origin that is unlikely to be directly usable by remote OAuth clients.

#### Scenario: Auth enabled with wildcard bind and no public origin
- **WHEN** authentication is enabled
- **AND** `server.publicOrigin` is not set
- **AND** `server.host` is a wildcard bind address such as `0.0.0.0` or `::`
- **THEN** startup diagnostics MUST include a warning that a public origin should be configured for remote clients

#### Scenario: Auth enabled with public origin suppresses warning
- **WHEN** authentication is enabled
- **AND** `server.publicOrigin` is set
- **THEN** startup diagnostics MUST NOT emit the wildcard bind-origin warning
