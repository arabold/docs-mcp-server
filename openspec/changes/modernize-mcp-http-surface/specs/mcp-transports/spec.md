# Spec Delta

## Purpose

Defines how MCP clients reach the server. For the Streamable HTTP endpoint that covers the order in which requests are checked, which protocol revision it serves, which browser origins it accepts and how browsers may call it, how it streams through proxies, and which paths do not serve MCP. It also covers the stdio transport.

## ADDED Requirements

### Requirement: Requests to the MCP endpoint are checked in a fixed order

The MCP endpoint SHALL check each request in this order, and answer with the first check that fails:

1. the `Origin` header (403);
2. a CORS preflight, which is answered at this point;
3. the HTTP method (405);
4. authentication, when enabled (401);
5. MCP processing.

Requirements that describe MCP processing apply only to requests that pass the earlier checks.

#### Scenario: Foreign origin with a valid token

- **WHEN** a request carries `Origin: https://attacker.example` and a valid bearer token
- **THEN** the response SHALL be HTTP 403

#### Scenario: Wrong method with authentication enabled

- **WHEN** authentication is enabled
- **AND** a client sends GET to the MCP endpoint without a token
- **THEN** the response SHALL be HTTP 405, not 401

#### Scenario: Handshake-era request without a token

- **WHEN** authentication is enabled
- **AND** a client POSTs an `initialize` request for protocol version `2025-06-18` without a token
- **THEN** the response SHALL be HTTP 401

### Requirement: Streamable HTTP endpoint serves protocol revision 2026-07-28 and earlier clients

The server SHALL serve MCP over the Streamable HTTP transport at one endpoint, the public URL followed by `/mcp`, for protocol revision `2026-07-28`. It SHALL also serve clients on earlier, handshake-based revisions, statelessly: each request SHALL be answered on its own, without a session, as the endpoint did before this change.

- MCP messages SHALL be sent with POST.
- Any other method, except a CORS preflight, SHALL get HTTP 405 with `Allow: POST`.
- An `initialize` request for an earlier revision SHALL be answered with that revision, and SHALL NOT establish a session (no `Mcp-Session-Id`).

#### Scenario: Current-revision request succeeds

- **WHEN** a client POSTs a `tools/list` request to the MCP endpoint with `MCP-Protocol-Version: 2026-07-28`
- **THEN** the response SHALL carry the result listing the server's tools

#### Scenario: Revision discovery

- **WHEN** a client POSTs a `server/discover` request to the MCP endpoint
- **THEN** the result SHALL list `2026-07-28` as the server's only supported protocol version

#### Scenario: Handshake-era client is served statelessly

- **WHEN** a client POSTs an `initialize` request for protocol version `2025-06-18` to the MCP endpoint
- **THEN** the response SHALL be a successful `initialize` result for protocol version `2025-06-18`
- **AND** the response SHALL NOT carry an `Mcp-Session-Id` header

#### Scenario: Handshake-era client uses the tools

- **WHEN** a client completes the `initialize` handshake for protocol version `2025-06-18` at the MCP endpoint
- **THEN** it SHALL be able to list and call the server's tools

#### Scenario: Methods other than POST

- **WHEN** a client sends GET or DELETE to the MCP endpoint
- **THEN** the response SHALL be HTTP 405
- **AND** it SHALL include `Allow: POST`

### Requirement: Paths that do not serve MCP answer 404

The server SHALL answer the following with HTTP 404 and a body that is not HTML, whether or not the web UI is enabled:

- the HTTP+SSE endpoints (`/sse` and `/messages`), when authentication is enabled;
- any path below the MCP endpoint;
- unknown documents under `/.well-known/`.

Only unknown paths outside these SHALL fall back to the web UI.

#### Scenario: SSE endpoint with authentication enabled

- **WHEN** authentication is enabled
- **AND** the web UI is enabled
- **AND** a client sends GET `/sse`
- **THEN** the response SHALL be HTTP 404
- **AND** its content type SHALL NOT be `text/html`

#### Scenario: SSE message endpoint with authentication enabled

- **WHEN** authentication is enabled
- **AND** a client POSTs to `/messages?sessionId=abc`
- **THEN** the response SHALL be HTTP 404

#### Scenario: Path below the MCP endpoint

- **WHEN** a client sends GET `/mcp/anything`
- **THEN** the response SHALL be HTTP 404 with a body that is not HTML

#### Scenario: Unknown well-known document

- **WHEN** the web UI is enabled
- **AND** a client sends GET `/.well-known/unknown-document`
- **THEN** the response SHALL be HTTP 404 with a body that is not HTML

#### Scenario: Client-side routes still load the web UI

- **WHEN** the web UI is enabled
- **AND** a browser requests `/libraries`
- **THEN** the response SHALL be the web UI

### Requirement: Deprecated HTTP+SSE transport while authentication is disabled

While authentication is disabled, the server SHALL keep serving the deprecated HTTP+SSE transport for clients on earlier, handshake-based protocol revisions:

- A GET to the public URL followed by `/sse` SHALL open an event stream. Its first event, `endpoint`, SHALL name the message URL: the public URL's path followed by `/messages` and a `sessionId` query parameter.
- A POST to that message URL SHALL deliver a JSON-RPC message to the session, and responses SHALL arrive on the event stream.
- An open stream SHALL receive keep-alive comments while idle, so proxies and clients don't close it.
- Both endpoints SHALL reject a request whose `Origin` header is present but not an allowed origin, as defined for the MCP endpoint, with HTTP 403.
- The first connection after startup SHALL produce a deprecation warning that names the MCP endpoint as the replacement.

When authentication is enabled, the server SHALL NOT serve this transport.

#### Scenario: Legacy client connects over SSE

- **WHEN** authentication is disabled
- **AND** a client opens `/sse` and completes the `initialize` handshake over the returned message URL
- **THEN** the client SHALL be able to list and call the server's tools

#### Scenario: Message URL carries the base path

- **WHEN** authentication is disabled and the public URL is `https://example.com/docs`
- **AND** a client opens `https://example.com/docs/sse`
- **THEN** the `endpoint` event SHALL name `/docs/messages?sessionId=…`

#### Scenario: Foreign origin

- **WHEN** authentication is disabled
- **AND** a GET to `/sse` carries `Origin: https://attacker.example`
- **THEN** the response SHALL be HTTP 403

#### Scenario: Deprecation warning

- **WHEN** authentication is disabled
- **AND** a client connects to `/sse` for the first time since startup
- **THEN** the server's log output SHALL include a deprecation warning naming the MCP endpoint

### Requirement: Browser origins are validated

The MCP endpoint SHALL reject, with HTTP 403, a request whose `Origin` header is present but is not an allowed origin. The allowed origins are:

- any origin whose host is `localhost`, `127.0.0.1` or `[::1]`, on any scheme and port;
- any origin whose host is the host of the configured public URL, when one is configured;
- each origin listed in `server.allowedOrigins`, matched exactly.

A request without an `Origin` header SHALL be processed normally.

#### Scenario: Non-browser client

- **WHEN** a request to the MCP endpoint carries no `Origin` header
- **THEN** the request SHALL be processed normally

#### Scenario: Local browser-based client

- **WHEN** a request to the MCP endpoint carries `Origin: http://localhost:6274`
- **THEN** the request SHALL be processed normally

#### Scenario: Page served from the public host

- **WHEN** the public URL is `https://example.com/docs`
- **AND** a request to the MCP endpoint carries `Origin: https://example.com`
- **THEN** the request SHALL be processed normally

#### Scenario: Listed hosted client

- **WHEN** `server.allowedOrigins` contains `https://inspector.example.com`
- **AND** a request to the MCP endpoint carries `Origin: https://inspector.example.com`
- **THEN** the request SHALL be processed normally

#### Scenario: Foreign origin

- **WHEN** a request to the MCP endpoint carries `Origin: https://attacker.example`
- **THEN** the response SHALL be HTTP 403
- **AND** the request SHALL NOT reach authentication or MCP processing

### Requirement: Browser-based clients can call the endpoint

For requests from an allowed origin, the MCP endpoint SHALL support cross-origin use from browsers:

- A CORS preflight (`OPTIONS` carrying `Access-Control-Request-Method`) SHALL be answered with a success status, without authentication. The answer SHALL allow the method POST and the request headers the preflight names.
- Every other response, including 401 challenges, SHALL carry `Access-Control-Allow-Origin` set to the request's origin, and `Vary: Origin`, and SHALL expose the `WWW-Authenticate` header to the page.

Responses to requests without an `Origin` header, or from an origin that is not allowed, SHALL NOT carry `Access-Control-Allow-Origin`.

#### Scenario: Preflight from an allowed origin

- **WHEN** authentication is enabled
- **AND** a browser sends `OPTIONS` to the MCP endpoint with `Origin: http://localhost:6274`, `Access-Control-Request-Method: POST` and `Access-Control-Request-Headers: authorization, content-type, mcp-protocol-version`
- **THEN** the response SHALL have a success status
- **AND** it SHALL carry `Access-Control-Allow-Origin: http://localhost:6274`
- **AND** it SHALL allow the method POST and the three requested headers

#### Scenario: Challenge is readable by the page

- **WHEN** authentication is enabled
- **AND** a browser on an allowed origin POSTs to the MCP endpoint without a token
- **THEN** the 401 response SHALL carry `Access-Control-Allow-Origin` set to that origin
- **AND** its `Access-Control-Expose-Headers` SHALL include `WWW-Authenticate`

#### Scenario: Preflight from a foreign origin

- **WHEN** a browser sends a CORS preflight to the MCP endpoint with `Origin: https://attacker.example`
- **THEN** the response SHALL be HTTP 403
- **AND** it SHALL NOT carry `Access-Control-Allow-Origin`

### Requirement: Streamed responses are not buffered by proxies

When the MCP endpoint answers a request with an event stream, the response SHALL carry the header `X-Accel-Buffering: no`, so that reverse proxies pass events on as they are produced.

#### Scenario: Event-stream response

- **WHEN** the MCP endpoint answers a request with `Content-Type: text/event-stream`
- **THEN** the response SHALL include `X-Accel-Buffering: no`

### Requirement: stdio serves both protocol eras

The stdio transport SHALL serve clients that open with the `initialize` handshake of an earlier protocol revision, as well as clients using revision `2026-07-28`.

#### Scenario: Handshake-era stdio client

- **WHEN** a client starts the server over stdio and sends `initialize` for protocol version `2025-06-18`
- **THEN** the server SHALL complete the handshake and serve that client's requests

#### Scenario: Current-revision stdio client

- **WHEN** a client starts the server over stdio and sends a `2026-07-28` request without an `initialize` handshake
- **THEN** the server SHALL answer the request
