# Spec Delta

## MODIFIED Requirements

### Requirement: Distinguish bind host from advertised origin
The server SHALL treat the configured bind host as the network interface used for listening. When a public URL is configured (`server.publicUrl`, or the deprecated `server.publicOrigin`), the server SHALL treat it as the canonical base for externally advertised absolute URLs, including any path the public URL carries.

#### Scenario: Bind host controls listener
- **WHEN** the server starts with `server.host` set to `0.0.0.0`
- **THEN** the HTTP listener MUST bind with host `0.0.0.0`
- **AND** the bind host MUST NOT be replaced by `localhost` or `127.0.0.1` before calling the HTTP server listen API

#### Scenario: Public origin controls advertised URLs
- **WHEN** the deprecated `server.publicOrigin` is set to `https://docs.example.com`
- **THEN** generated externally advertised endpoint URLs MUST use `https://docs.example.com`
- **AND** the generated externally advertised endpoint URLs MUST NOT use the bind host unless no public URL is configured

#### Scenario: Public URL with a path controls advertised URLs
- **WHEN** `server.publicUrl` is set to `https://docs.example.com/tools`
- **THEN** the MCP endpoint MUST be advertised as `https://docs.example.com/tools/mcp` in startup output and in the web UI
- **AND** advertised endpoint URLs MUST NOT use the bind host

#### Scenario: Bind-derived origin fallback
- **WHEN** no public URL is set
- **AND** the server binds to host `0.0.0.0` on port `6280`
- **THEN** generated fallback endpoint URLs MUST use `http://0.0.0.0:6280`
- **AND** they MUST NOT fall back to hard-coded `localhost` or `127.0.0.1`

#### Scenario: IPv6 bind host formatting
- **WHEN** no public URL is set
- **AND** the server binds to IPv6 host `::` on port `6280`
- **THEN** generated fallback endpoint URLs MUST use bracketed IPv6 host formatting such as `http://[::]:6280`

## REMOVED Requirements

### Requirement: Generate OAuth metadata from the canonical origin
**Reason**: The server no longer publishes authorization-server metadata or proxies OAuth requests. The `mcp-authorization` capability specifies the protected resource metadata it still publishes, derived from the public URL and never from the request's `Host` header.
**Migration**: Configure a public URL. Clients discover the authorization server from the protected resource metadata and talk to it directly.

### Requirement: Warn on ambiguous auth wildcard origins
**Reason**: Authentication now requires a public URL, and startup fails without one (see `mcp-authorization`). There is no longer a bind-address fallback to warn about.
**Migration**: Set `server.publicUrl` when enabling authentication.
