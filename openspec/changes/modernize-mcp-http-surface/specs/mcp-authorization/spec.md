# Spec Delta

## Purpose

Defines the server's role as an OAuth 2.0 resource server for its MCP endpoint: the configuration authentication needs, how clients discover the authorization server, which tokens are accepted, which endpoints authentication covers, and how the unauthenticated API is shielded from foreign web pages.

## ADDED Requirements

### Requirement: Authentication configuration

Authentication SHALL apply to the MCP endpoint served over HTTP.

When `auth.enabled` is true for a process that serves that endpoint, the server SHALL require `auth.issuerUrl` and a public URL (`server.publicUrl`, or the deprecated `server.publicOrigin`). It SHALL refuse to start with an error naming the missing setting when either is absent.

The `issuer` in the authorization server metadata the issuer publishes SHALL be identical to the configured `auth.issuerUrl`. Otherwise the server SHALL refuse to start with an error showing both values.

`auth.audience` SHALL be optional. When it is unset, the expected token audience SHALL be the public URL of the MCP endpoint. When it is set, its value SHALL be the expected audience instead.

Over stdio, authentication SHALL NOT apply: enabling it SHALL produce a warning and require no other setting.

#### Scenario: Public URL missing

- **WHEN** authentication is enabled with an issuer for a process serving the MCP endpoint over HTTP
- **AND** neither `server.publicUrl` nor `server.publicOrigin` is set
- **THEN** the server SHALL refuse to start
- **AND** the error SHALL name `server.publicUrl`

#### Scenario: Issuer missing

- **WHEN** authentication is enabled for a process serving the MCP endpoint over HTTP
- **AND** `auth.issuerUrl` is not set
- **THEN** the server SHALL refuse to start
- **AND** the error SHALL name `auth.issuerUrl`

#### Scenario: Issuer differs from the published issuer

- **WHEN** `auth.issuerUrl` is `https://idp.example.com/`
- **AND** the issuer's published metadata names `https://idp.example.com` as its `issuer`
- **THEN** the server SHALL refuse to start with an error showing both values

#### Scenario: Audience defaults to the MCP endpoint URL

- **WHEN** authentication is enabled with public URL `https://example.com/docs`
- **AND** `auth.audience` is not set
- **THEN** the expected token audience SHALL be `https://example.com/docs/mcp`

#### Scenario: Audience override

- **WHEN** authentication is enabled with `auth.audience` set to `https://mcp.example.com`
- **THEN** the expected token audience SHALL be `https://mcp.example.com`

#### Scenario: Authentication enabled over stdio

- **WHEN** the `mcp` command starts over stdio with `auth.enabled` true and no issuer or public URL
- **THEN** the server SHALL start
- **AND** startup output SHALL warn that authentication does not apply to stdio

### Requirement: Protected resource metadata

When authentication is enabled, the server SHALL publish OAuth 2.0 Protected Resource Metadata (RFC 9728) for its MCP endpoint:

- `resource` SHALL equal the public URL of the MCP endpoint.
- `authorization_servers` SHALL contain exactly the configured issuer.
- `bearer_methods_supported` SHALL be `["header"]`.

The document SHALL be served in two places: at the public URL followed by `/.well-known/oauth-protected-resource/mcp`, and at the well-known location RFC 9728 derives from the MCP endpoint URL. The two coincide when the public URL has no path.

Every value in the document SHALL come from configuration, never from the request's `Host` header. The document SHALL be readable from any origin (`Access-Control-Allow-Origin: *`), including through a CORS preflight. The server SHALL NOT serve a protected resource metadata document at the root well-known location.

#### Scenario: Metadata for the MCP endpoint

- **WHEN** the public URL is `https://example.com/docs` and the issuer is `https://auth.example.com`
- **AND** a client sends GET `https://example.com/docs/.well-known/oauth-protected-resource/mcp`
- **THEN** the document's `resource` SHALL be `https://example.com/docs/mcp`
- **AND** its `authorization_servers` SHALL be `["https://auth.example.com"]`
- **AND** its `bearer_methods_supported` SHALL be `["header"]`

#### Scenario: RFC 9728 location for a path-hosted server

- **WHEN** the public URL is `https://example.com/docs`
- **AND** a client sends GET `/.well-known/oauth-protected-resource/docs/mcp` to the server
- **THEN** the server SHALL answer with the same document

#### Scenario: No root metadata document

- **WHEN** a client sends GET `/.well-known/oauth-protected-resource`
- **THEN** the response SHALL be HTTP 404

#### Scenario: Host header differs from the public URL

- **WHEN** a metadata request carries `Host: 10.9.8.7:6280`
- **THEN** the document SHALL still describe the configured public URL
- **AND** it SHALL NOT mention `10.9.8.7`

#### Scenario: Read from a browser on another origin

- **WHEN** a browser on `https://inspector.example.com` fetches the metadata document
- **THEN** the response SHALL carry `Access-Control-Allow-Origin: *`

### Requirement: Unauthenticated requests receive a discovery challenge

When authentication is enabled, the MCP endpoint SHALL answer a request that lacks a valid bearer token with HTTP 401. The response SHALL carry a `WWW-Authenticate` header using the `Bearer` scheme, whose `resource_metadata` parameter is the public URL followed by `/.well-known/oauth-protected-resource/mcp`.

- When the request carried no bearer token, the challenge SHALL carry no error code.
- When a token was presented and rejected, the challenge SHALL carry `error="invalid_token"`. Its description SHALL be the same for every rejection reason, so the response does not reveal which check the token failed.

#### Scenario: No token

- **WHEN** a request to the MCP endpoint carries no `Authorization` header
- **THEN** the response SHALL be HTTP 401
- **AND** its `WWW-Authenticate` header SHALL carry `resource_metadata` pointing at the metadata document
- **AND** it SHALL NOT carry an `error` parameter

#### Scenario: Rejected token

- **WHEN** a request to the MCP endpoint carries a bearer token the server rejects
- **THEN** the response SHALL be HTTP 401
- **AND** its `WWW-Authenticate` header SHALL carry `error="invalid_token"` and `resource_metadata`

#### Scenario: Rejection reason is not disclosed

- **WHEN** one request carries a token with the wrong audience and another carries a token with an invalid signature
- **THEN** both responses SHALL carry the same `error_description`

### Requirement: Only tokens issued for this server are accepted

When authentication is enabled, the MCP endpoint SHALL accept a request only when its `Authorization` header carries a bearer token that:

- is a JWT signed with a key the configured issuer publishes,
- has an `iss` equal to the configured issuer,
- has an `aud` that contains the expected audience,
- and has not expired.

No other validation path SHALL grant access. When the issuer's keys cannot be retrieved, the endpoint SHALL answer with a server error (5xx), not with a token rejection.

#### Scenario: Token issued for this server

- **WHEN** a request carries an unexpired JWT from the configured issuer whose `aud` is the expected audience
- **THEN** the request SHALL be processed

#### Scenario: Token issued for another resource

- **WHEN** a request carries an unexpired JWT from the configured issuer whose `aud` is `https://other.example/mcp`
- **THEN** the response SHALL be HTTP 401

#### Scenario: Opaque token

- **WHEN** a request carries a token that is not a JWT
- **AND** the issuer would confirm the token is valid if asked
- **THEN** the response SHALL be HTTP 401

#### Scenario: Expired token

- **WHEN** a request carries a JWT for this server whose `exp` lies in the past
- **THEN** the response SHALL be HTTP 401

#### Scenario: Token from another issuer

- **WHEN** a request carries a JWT whose `iss` differs from the configured issuer
- **THEN** the response SHALL be HTTP 401

#### Scenario: Issuer keys unavailable

- **WHEN** a request carries a JWT
- **AND** the issuer's key set cannot be retrieved
- **THEN** the response SHALL be a 5xx status
- **AND** it SHALL NOT carry `error="invalid_token"`

### Requirement: The server hosts no authorization server endpoints

The server SHALL NOT serve OAuth authorization-server endpoints or authorization-server metadata. Clients register with, authorize against, and obtain tokens from the configured issuer directly.

#### Scenario: Former OAuth proxy endpoints

- **WHEN** a client requests `/.well-known/oauth-authorization-server`, `/oauth/authorize`, `/oauth/token`, `/oauth/register`, or `/oauth/revoke`
- **THEN** each response SHALL be HTTP 404

### Requirement: Authentication covers the MCP endpoint only, and says so

Authentication SHALL apply to the MCP endpoint only. The web UI and the HTTP API at `/api`, including its WebSocket, SHALL stay reachable without a token.

At startup with authentication enabled, the server SHALL state which endpoint authentication protects, and that the web UI and API are not protected. When authentication is enabled for a command that serves no MCP endpoint over HTTP, startup SHALL warn that authentication protects nothing in that process.

#### Scenario: Startup statement

- **WHEN** the `server` command starts with authentication enabled and public URL `https://example.com/docs`
- **THEN** startup output SHALL name `https://example.com/docs/mcp` as the protected endpoint
- **AND** it SHALL state that the web UI and API are not protected

#### Scenario: Authentication enabled without an MCP endpoint

- **WHEN** the `web` command starts with authentication enabled
- **THEN** startup output SHALL warn that authentication protects nothing in this process

#### Scenario: API stays reachable

- **WHEN** authentication is enabled
- **AND** a request to the HTTP API carries no token
- **THEN** the request SHALL NOT be refused for lack of authentication

### Requirement: Requests for unknown host names are refused

On every bind, the server SHALL answer HTTP 403 to any request, and refuse any WebSocket upgrade, whose `Host` header names a host other than:

- an IP address literal;
- `localhost`;
- a single-label name (one without a dot, such as a Docker service name);
- the host of the configured public URL;
- the host of an origin listed in `server.allowedOrigins`.

A request without a `Host` header SHALL be served. The server SHALL log a warning naming a refused host, at most once per host.

This stops DNS rebinding: a page on an attacker's domain that resolves to the server sends same-origin GET requests without an `Origin` header, and only its `Host` header gives it away.

#### Scenario: DNS-rebound page reads the API

- **WHEN** the server is bound to `127.0.0.1` with no public URL
- **AND** a GET to the HTTP API carries `Host: attacker.example:6280` and no `Origin` header
- **THEN** the response SHALL be HTTP 403

#### Scenario: DNS-rebound page opens the WebSocket

- **WHEN** a WebSocket upgrade to the API carries `Host: attacker.example:6280`
- **THEN** the upgrade SHALL be refused

#### Scenario: Reached by address, by localhost or by service name

- **WHEN** a request carries `Host: 192.168.1.20:6280`, `Host: localhost:6280` or `Host: docs-mcp-server:6280`
- **THEN** the request SHALL be served

#### Scenario: Reached under the public URL's host

- **WHEN** the public URL is `https://docs.example.com`
- **AND** a request carries `Host: docs.example.com`
- **THEN** the request SHALL be served

#### Scenario: LAN name that is not configured

- **WHEN** neither the public URL nor `server.allowedOrigins` names `nas.local`
- **AND** a request carries `Host: nas.local:6280`
- **THEN** the response SHALL be HTTP 403

### Requirement: The API rejects foreign browser origins on a loopback bind

When the server is bound to a loopback address, the HTTP API at `/api` and its WebSocket SHALL reject any request or WebSocket upgrade whose `Origin` header is present but is not an allowed origin. The allowed origins are those defined for the MCP endpoint. A request without an `Origin` header SHALL be served. When the server is bound to any other address, the API SHALL NOT check `Origin`.

#### Scenario: Foreign page calls the API on a local install

- **WHEN** the server is bound to `127.0.0.1`
- **AND** a request to the HTTP API carries `Origin: https://attacker.example`
- **THEN** the response SHALL be HTTP 403

#### Scenario: Foreign page opens the live-update WebSocket

- **WHEN** the server is bound to `127.0.0.1`
- **AND** a WebSocket upgrade to the API carries `Origin: https://attacker.example`
- **THEN** the upgrade SHALL be refused

#### Scenario: The web UI's own requests

- **WHEN** the server is bound to `127.0.0.1`
- **AND** the web UI is loaded from `http://localhost:6280`
- **THEN** its API requests and its WebSocket SHALL be served

#### Scenario: Network-exposed bind

- **WHEN** the server is bound to `0.0.0.0`
- **AND** a request to the HTTP API carries `Origin: https://attacker.example`
- **THEN** the request SHALL NOT be refused because of its `Origin`
