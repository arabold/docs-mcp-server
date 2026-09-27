# Proposal

## Why

The server's MCP-over-HTTP surface is out of date in three ways at once:

- **It can't run behind a reverse proxy.** Under a subpath such as `https://example.com/docs/` it breaks (issue #493): the SSE transport tells clients to post to a root-absolute `/messages`, and the web UI loads its assets and API from `/`. `server.publicOrigin` rejects any path, so an operator has no way to say where the server lives.
- **Authentication is unsafe and non-conformant (issue #494).** A token rejected by the audience check is accepted anyway when the provider's userinfo endpoint vouches for it. The discovery metadata advertises a `resource` that every current discovery path must discard. The 401 omits `resource_metadata`, and `/messages` carries SSE traffic with no token check at all.
- **It is built for a superseded protocol.** The server implements the handshake-era protocol on SDK 1.x, which is now maintenance-only. The current revision, 2026-07-28, is stateless, and the HTTP+SSE transport is deprecated. SDK v2 implements that revision, drops server-side SSE, and freezes the authorization-server helpers our OAuth proxy is built on.

These all rewrite the same code — the MCP routes, the auth middleware, and the URLs the server advertises — so they are done together: once, against SDK v2.

## What Changes

- The MCP HTTP endpoint serves protocol revision 2026-07-28, and keeps serving handshake-era clients statelessly, as it does today, so existing HTTP integrations keep working. stdio also serves both protocol eras.
- **BREAKING** (auth deployments): The legacy HTTP+SSE transport (`/sse`, `/messages`) is deprecated. It stays available only while authentication is disabled, so existing unauthenticated SSE setups keep working through the upgrade, and it is removed in a later major release. With authentication enabled it is not served, which closes the unauthenticated `/messages` path. It serves handshake-era clients, carries the base path in its message URL, and logs a deprecation warning the first time a client connects. Documentation, startup output and the web UI point to `/mcp` only; the legacy transport is described once, at the end of the client guide.
- **BREAKING** (auth deployments): The server is a resource server only. The OAuth proxy endpoints (`/oauth/authorize`, `/oauth/token`, `/oauth/register`, `/oauth/revoke`) and the server's own authorization-server metadata are removed. Clients register with and authorize against the configured identity provider directly.
- **BREAKING** (auth deployments): The server accepts a token only when it verifies as a JWT signed by the configured issuer whose audience is this server's public MCP endpoint URL. That is the same URL the metadata advertises as `resource`, so it is what clients request tokens for. The userinfo fallback is removed, so tokens from other applications on the same provider are rejected, as are opaque tokens.
- **BREAKING** (auth deployments): `auth.audience` becomes an optional override, only needed for identity providers that issue a fixed audience instead of honoring the requested `resource`. With authentication enabled on a process that serves the MCP endpoint over HTTP, a public URL is required and startup fails without one. The advertised `resource` and the expected audience both derive from it, and must not be guessed from the bind address or the request's `Host`. Over stdio, enabling authentication only produces a warning.
- The protected-resource metadata becomes conformant: its `resource` equals the URL of the MCP endpoint, it is served at the endpoint's path-aware well-known location, and it lists the configured issuer as the authorization server. Every 401 challenge carries `resource_metadata`.
- The MCP endpoint rejects browser requests from origins other than loopback, the public URL's host, or an origin listed in the new `server.allowedOrigins`. This closes the DNS rebinding exposure the transport spec requires servers to prevent. On a loopback bind, the same check shields `/api` and its WebSocket, which carry no authentication.
- Browser-based MCP clients are supported. Allowed origins get CORS on the MCP endpoint (a preflight answered before auth, and a 401 challenge the page can read), and the protected-resource metadata is readable from any origin.
- A new `server.publicUrl` setting (env `DOCS_MCP_SERVER_PUBLIC_URL`, CLI `--public-url`) accepts an absolute URL that may include a path. The path's first segment must not collide with one of the server's own routes. The server then serves every route under that path: MCP endpoint, web UI, HTTP API and WebSocket, and discovery metadata. Every URL the server advertises carries the path too. `server.publicOrigin` stays as a deprecated alias with unchanged validation. It warns on use, and when both are set `publicUrl` wins.
- The MCP endpoint answers methods other than POST with 405 and `Allow: POST`. It checks requests in a fixed order: origin, then preflight, then method, then authentication, then MCP.
- Streaming MCP responses tell reverse proxies not to buffer them. Unknown paths under the MCP endpoint answer 404 instead of the web UI shell.
- Startup output states which endpoints authentication protects. It warns when auth is enabled on a command that serves no MCP endpoint, since auth protects nothing there. The web UI and `/api` are documented as unprotected by design and left to a reverse proxy.
- Docs gain a reverse-proxy guide with working nginx and Traefik configurations.

## Capabilities

### New Capabilities

- `mcp-transports`: How clients reach MCP. For the Streamable HTTP endpoint it covers:
  - the order in which requests are checked;
  - which protocol revision it serves;
  - `Origin` validation and CORS for browser clients;
  - streaming behind proxies;
  - how paths that don't serve MCP answer.

  It also covers the deprecated HTTP+SSE transport, served only while authentication is disabled, and for stdio, which protocol eras it serves.
- `mcp-authorization`: The resource-server contract. It covers:
  - the configuration authentication needs: a public URL, an issuer that matches the provider's own, and an optional audience override;
  - protected-resource metadata and the 401 challenge;
  - which tokens are accepted;
  - the absence of authorization-server endpoints;
  - which endpoints auth protects;
  - the origin check that shields `/api` on a loopback bind.
- `base-path-serving`: Serving the whole application under the path of the public URL. Covers MCP, web UI assets, client-side routes, the HTTP API and its WebSocket, and discovery metadata.

### Modified Capabilities

- `server-origin-urls`: The canonical public location becomes a URL that may carry a path, and all advertised URLs derive from it. The OAuth metadata requirement changes: the server publishes protected-resource metadata only, not authorization-server metadata.
- `configuration`: Adds `server.publicUrl` and `server.allowedOrigins`, and turns `server.publicOrigin` into a deprecated alias whose existing validation still applies.

## Impact

- **Dependencies**: `@modelcontextprotocol/sdk` 1.x is replaced by `@modelcontextprotocol/server` and `@modelcontextprotocol/node` (v2). `@modelcontextprotocol/client` replaces SDK imports in tests. `jose` stays for token verification. `@modelcontextprotocol/server-legacy` provides the SDK's frozen SSE transport for the deprecated endpoint; it goes when that endpoint does.
- **Code**: `src/services/mcpService.ts` (routes, rewritten), `src/auth/` (the OAuth proxy is removed; token verification and metadata remain), `src/mcp/mcpServer.ts` (`server.tool` → `registerTool`), `src/mcp/startStdioServer.ts`, `src/mcp/utils.ts`, `src/cli/services.ts`, `src/app/AppServer.ts` (base path, static files, SPA fallback, startup output), `src/utils/serverOrigin.ts` and `src/utils/config.ts` (public URL), and `src/web/client/` plus `vite.config.web.ts` (base path at runtime).
- **Tests**: `test/mcp-http-e2e.test.ts` is rewritten for the modern protocol, and keeps a legacy SSE client check. `test/mcp-stdio-e2e.test.ts` is updated. `test/auth-e2e.test.ts` is rewritten: it derives the expected audience from the public URL instead of asserting one Clerk tenant's values. A new E2E suite covers serving under a base path behind a prefix-stripping proxy.
- **Docs**: `docs/infrastructure/authentication.md` is rewritten for the resource-server model. It includes provider setup: for Clerk, turn on JWT access tokens, the `aud` claim, and required PKCE. With those enabled, Clerk sets `aud` to the requested `resource`, verified against a dev instance on 2026-09-27. A reverse-proxy guide is added. `README.md`, `ARCHITECTURE.md`, `docs/guides/mcp-clients.md`, `docs/infrastructure/deployment-modes.md`, `docs/setup/configuration.md` and `docs/setup/installation.md` drop `/sse` and adopt `publicUrl`.
- **Ships with**: `cli-defaults-do-not-override-env`, which makes `DOCS_MCP_AUTH_ENABLED` take effect at all. It follows this change on the same branch, before release.
- **Out of scope**: authentication for the web UI, `/api` and the worker link (left to a reverse proxy); adopting 2026-07-28 features beyond what serving it requires (subscriptions, multi-round-trip requests, the tasks extension); and Client ID Metadata Documents, which concern clients and the identity provider.
