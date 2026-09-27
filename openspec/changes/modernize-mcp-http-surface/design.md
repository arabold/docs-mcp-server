# Design

## Context

See proposal.md for the motivation and specs/ for the contracts. This section records only the current state that shapes the approach.

- **One Fastify instance serves everything.** `AppServer` hosts the web UI (static files plus an SPA fallback) and tRPC at `/api`. The tRPC WebSocket is attached to the raw server's `upgrade` event and accepts every path. Via `registerMcpService`, the same instance also serves the MCP routes `/sse`, `/messages` and `/mcp`. Any fix has to work inside that instance, not a second app. Nothing in `src/` emits CORS headers today.
- **The MCP layer is SDK 1.x throughout.**
  - `createMcpServerInstance(tools, config)` already builds a fresh `McpServer` per call. It registers tools with the removed variadic `server.tool(...)` and schemas from `zod/v3`, which SDK v2 rejects.
  - stdio uses `new StdioServerTransport()` + `server.connect()`, and `src/cli/services.ts` keeps the `McpServer` for shutdown.
- **Auth is `ProxyAuthManager`, doing two jobs.**
  - It runs the OAuth proxy routes (`/oauth/*`, `/.well-known/oauth-authorization-server`).
  - It validates tokens: a JWT check with audience, then a fallback to the provider's userinfo endpoint, which never checks audience.
  - Issuer discovery appends `/.well-known/…` to the issuer, which is wrong for issuers with a path.
  - `validateAuthConfig` runs in `default.ts` and `mcp.ts` *before* the stdio/HTTP branch.
- **Verified provider behavior (Clerk dev instance, 2026-09-27).**
  - With `oauth_jwt_access_tokens` and `aud_claim_enabled` on, Clerk issues `typ: at+jwt` RS256 tokens whose `aud` equals the requested `resource`. That held for both `https://mcp.grounded.tools` and `http://localhost:6280/mcp`.
  - With the flags off, it issues opaque tokens with no `aud`.
- **The web UI is built once and ships in one image**, so its base path can't be fixed at build time. Today:
  - the shell references `/assets/…`;
  - `main.tsx` builds API URLs from `window.location.origin`;
  - `BrowserRouter` has no basename;
  - `Icon.tsx` renders `<use href="#name">` fragment references.
- **SDK v2 building blocks used below**, verified in the v2 sources:
  - `createMcpHandler(factory, { legacy })` from `@modelcontextprotocol/server`, and `serveStdio(factory, { legacy })` from `@modelcontextprotocol/server/stdio`;
  - `toNodeHandler(handler)(req, res, parsedBody)` from `@modelcontextprotocol/node`;
  - `verifyBearerToken(header, options): Promise<AuthInfo>`, `bearerAuthChallengeResponse(error, options): Response`, `OAuthTokenVerifier`, `OAuthError` and `localhostAllowedOrigins()` from `@modelcontextprotocol/server`.
- **What the SDK already covers.** The handler implements `server/discover`, `resultType`, and the `ttlMs`/`cacheScope` defaults. It validates `MCP-Protocol-Version`, `Mcp-Method` and `Mcp-Name`, and sends SSE keep-alives. It sets `X-Accel-Buffering: no` on SSE responses and cancels on disconnect.
- **What it doesn't.** Its 405 for non-POST methods carries no `Allow` header.

## Goals / Non-Goals

**Goals:**
- Every URL-producing and URL-matching piece derives from one resolved public location: origin plus base path.
- A single set of routes serves both proxy styles, prefix forwarded and prefix stripped, with no per-deployment switch.
- Token acceptance has exactly one path, and it checks audience.
- Browser-based MCP clients on allowed origins work end to end: preflight, challenge, metadata, calls.

**Non-Goals:**
- Adopting 2026-07-28 features the server doesn't need to serve the revision: `subscriptions/listen`, multi-round-trip requests, the tasks extension, and result caching hints beyond the SDK's defaults.
- `Host` header validation. The transport spec requires `Origin` validation only, and Host checks break proxies that forward the public host unless every operator configures them. Revisit with the SDK's `hostHeaderValidation` if needed.
- Scope enforcement. Access stays binary: any valid token for this server gets full access.
- A wildcard origin for `/mcp`. Hosted browser clients are allowed by listing them in `server.allowedOrigins`.

## Decisions

**Mount the v2 handler on our Fastify route.** The route is `app.all("/mcp")`. After our own checks it calls `reply.hijack()` and hands `request.raw`, `reply.raw` and `request.body` to `toNodeHandler(createMcpHandler(factory, { legacy: "stateless" }))`. The SDK's Fastify guide mounts the same node handler on a route of its own `createMcpFastifyApp`. We keep our instance, because that app is a new Fastify instance and would split the web UI, tRPC and MCP. `hijack()` stops Fastify from also trying to send. `legacy: "stateless"` keeps serving handshake-era clients the way the endpoint always has: a fresh instance per request, no session. That makes the new protocol an addition rather than a breaking change. `"reject"` would make the endpoint modern-only.

**Check requests in one fixed order, in our route.** The order is origin → CORS preflight → method → authentication → MCP. We answer non-POST methods ourselves with `405` and `Allow: POST`: RFC 9110 requires `Allow` on a 405, and the SDK omits it. Doing it before auth also means a GET gets 405 whether or not auth is enabled. The preflight is answered before auth because browsers never attach credentials to it.

**One origin policy, shared by `/mcp`, `/api` and the WebSocket upgrade.** `createOriginPolicy` classifies an `Origin` as absent, allowed or denied. Allowed means:
- a loopback hostname from the SDK's `localhostAllowedOrigins()`, on any port;
- the public URL's hostname;
- an exact match in `server.allowedOrigins`.

`null` and unparsable values are denied.
- `/mcp` always applies the policy (a transport MUST).
- `/api` (a Fastify `onRequest` hook scoped to that prefix) and the `upgrade` handler apply it only when the bind host is loopback. A network-exposed bind is the operator's choice, and a reverse proxy protects it. Checking there would break LAN access by IP or hostname without buying anything.
- A denied upgrade gets `HTTP/1.1 403 Forbidden` written to the socket before it is destroyed.
- *Alternative: the SDK's `originValidation`.* Rejected. It matches hostnames only, while `allowedOrigins` entries are exact origins, and the CORS headers need the same verdict.

**CORS on `/mcp` for allowed origins; metadata readable from anywhere.**
- A preflight gets `204` with:
  - `Access-Control-Allow-Origin: <origin>`;
  - `Access-Control-Allow-Methods: POST`;
  - `Access-Control-Allow-Headers`: the preflight's own `Access-Control-Request-Headers`, echoed. A fixed list can't cover the dynamic `Mcp-Param-*` names, and the `*` wildcard doesn't cover `Authorization`;
  - `Access-Control-Max-Age` of 600 seconds;
  - `Vary: Origin, Access-Control-Request-Headers`.
- Every other `/mcp` response to an allowed origin carries `Access-Control-Allow-Origin: <origin>`, `Vary: Origin` and `Access-Control-Expose-Headers: WWW-Authenticate`. This includes our 405 and 401, and the SDK-written responses. The headers are set on `reply.raw` before any response is written, so they survive both Fastify sends and the SDK's `writeHead`.
- No `Access-Control-Allow-Credentials`: tokens travel in `Authorization`, not cookies.
- The protected-resource metadata gets `Access-Control-Allow-Origin: *`, and a `204` for `OPTIONS`. It is public and carries nothing a page could abuse.

**Keep token verification ours; use the SDK for the rejected-token challenge.**
- **Verifier.** A new `JwtAccessTokenVerifier` implements `OAuthTokenVerifier`. At creation it discovers the issuer's metadata in the order MCP clients use: RFC 8414 with path insertion, then OIDC with path insertion, then OIDC with the path appended. It requires `metadata.issuer` to be identical to the configured `auth.issuerUrl`, and fails startup showing both values otherwise, because every client would reject a mismatch. It then uses `metadata.issuer` everywhere and `jose` against `metadata.jwks_uri`.
- **Errors.** `jwtVerify` checks `issuer`, `audience` and `exp`. Token-content failures throw `OAuthError(InvalidToken)`. Key-retrieval or network failures throw `OAuthError(ServerError)`, which `bearerAuthChallengeResponse` maps to 500, so an outage at the identity provider doesn't send clients into a re-authorization loop.
- **Challenges.** When the `Authorization` header is missing or isn't `Bearer`, we answer `401` with `WWW-Authenticate: Bearer resource_metadata="…"` ourselves. RFC 6750 §3.1 says a request with no credentials SHOULD get no error code, while `verifyBearerToken` would add `invalid_token`. For a presented token, `verifyBearerToken(header, { verifier, resourceMetadataUrl })` runs, and its failure is written with `bearerAuthChallengeResponse`.
- **No `scope` in the challenge.** MCP says servers SHOULD send one. We omit it for the same reason as `scopes_supported`: access is binary, and a requested scope the client's registration doesn't cover fails at the provider. The Clerk probe showed exactly that.
- **`AuthInfo` fields.** `expiresAt` comes from `exp`; `verifyBearerToken` rejects tokens without it. `clientId` comes from `client_id`, then `azp`, then `sub`. `scopes` comes from `scope`.
- **`typ: at+jwt` (RFC 9068) is not required.** Clerk sets it, but other providers don't. With the default audience, ID tokens are excluded anyway, because their `aud` is a client ID, never the MCP endpoint URL. With an `auth.audience` override that names a client ID, ID tokens would pass, so the docs require the override to name an API or resource identifier.
- **Audience compared exactly.** Clients copy `resource` from our metadata, so case variants don't arise in practice.
- *Alternative: `requireBearerAuth` (web-standard).* Rejected. It needs the request converted to a `Request` just to read one header.

**Serve protected resource metadata ourselves, and advertise it under the base path.**
- The document is `{ resource, authorization_servers: [issuer], bearer_methods_supported: ["header"], resource_name }`, without `scopes_supported`.
- The challenge's `resource_metadata` is `<publicUrl>/.well-known/oauth-protected-resource/mcp`. It sits inside the proxy's location, so *that* URL needs no extra proxy rule.
- When the base path is non-empty, the server also answers the RFC 9728 host-root location, `/.well-known/oauth-protected-resource<basePath>/mcp`. That location sits outside the proxy's `/docs/` location, so the proxy guide adds a rule for it, and the base-path E2E suite checks it.
- With a base path, `/.well-known/oauth-protected-resource/mcp` is also reachable at the host root, because `rewriteUrl` leaves it alone. That's harmless: its `resource` doesn't match that location, so clients discard it under RFC 9728 §3.3.
- *Alternative: SDK `oauthMetadataResponse` / `mcpAuthMetadataRouter`.* Rejected. They also mirror authorization-server metadata, which the spec forbids us to serve.
- *Alternative: advertise the SDK's `getOAuthProtectedResourceMetadataUrl`.* Rejected. It yields the host-root form as the primary URL, so every path-hosted deployment would need the extra proxy rule for the common path too.

**Strip the base path in Fastify's `rewriteUrl`; reject base paths that collide.**
- `Fastify({ rewriteUrl })` rewrites `/docs/mcp` to `/mcp` before routing, and leaves an already-stripped `/mcp` alone. That single function makes both proxy styles work.
- The match is segment-aware: `/docs` or `/docs/…` is stripped, `/docs-old` is not.
- It only works if the base path's first segment isn't itself a root route. Otherwise a stripped `/mcp` under `publicUrl=…/mcp` would be stripped again. So `normalizePublicUrl` rejects first segments in a reserved set of route names: `mcp`, `api`, `assets`, `.well-known`, `sse` and `messages`. The top-level static files in `public/` are icons and a manifest, which no realistic base path collides with, so they're left out and the check stays pure, with no filesystem read.
- The WebSocket `upgrade` listener sits outside Fastify routing and accepts any path, so `/docs/api` and `/api` both work.
- *Alternatives: register routes under a prefix plugin (breaks prefix-stripping proxies), or register every route twice (two sets of routes to keep in step).* Rejected.

**Build the web UI relative and inject `<base href>` at serve time.**
- Vite builds with `base: "./"`. The SPA shell handler inserts `<base href="<basePath>/">` as the first child of `<head>`, so relative asset URLs resolve under the base path, even on deep links. It inserts `<base href="/">` when there is no base path too: with relative assets, a deep link like `/libraries/react` would otherwise resolve `./assets/…` under `/libraries/`. `/index.html` is served through the same handler, never raw by the static plugin.
- `main.tsx` derives `BrowserRouter`'s `basename` and the tRPC HTTP and WebSocket URLs from `document.baseURI`.
- Chunk imports resolve through `import.meta.url`, and CSS `url()` resolves relative to its stylesheet.
- Browsers have historically resolved SVG `<use href="#name">` against `<base>`. The base-path E2E suite checks that icons render. If they don't, `Icon.tsx` switches to a fragment on the page's own URL.
- Opening the UI at an unprefixed path while a base path is configured renders nothing. That's documented, not supported.
- *Alternatives: a build-time Vite `base` (one image must serve any path), or an injected `window.__BASE_PATH__` (still needs relative asset URLs fixed for deep links).* Rejected.

**Resolve the public location once, in the `AppServer` constructor.**
- `resolvePublicLocation(config, port)` returns `{ url, origin, basePath }`. It uses `publicUrl`, then `publicOrigin`, then the bind origin. When both public settings are set, `publicUrl` wins, with a warning that `publicOrigin` is ignored.
- It runs in the constructor because `rewriteUrl` is a Fastify constructor option and `buildSystemInfo` runs there too.
- Its readers are startup output, `systemInfo`, the metadata, the challenge, the expected audience, the origin policy and `rewriteUrl`.

**Auth checks live in one place, where HTTP MCP is known.**
- `AppServer` checks the requirements before registering the MCP service. When auth is enabled and MCP is served over HTTP, a missing issuer or public URL fails startup naming the setting, and an issuer mismatch fails with both values.
- `web` and `worker` with auth enabled log one warning that it protects nothing, and never create the verifier.
- The stdio branches of `default.ts` and `mcp.ts` log that auth doesn't apply to stdio, and skip every auth check.
- `validateAuthConfig` in `src/cli/utils.ts` keeps format checks only (an HTTPS issuer). It no longer demands an audience.
- The wildcard-bind warning is removed, since its spec requirement is gone.

**HTTP+SSE stays as a deprecated shim, only while authentication is off.** Existing unauthenticated setups were configured for `/sse` by the old README, so they keep working through 4.0 and are told to move. The shim goes in the next major.
- **Transport.** `registerMcpService` mounts `GET /sse` and `POST /messages` only when it is given no auth. It uses the SDK's frozen `SSEServerTransport` from `@modelcontextprotocol/server-legacy/sse`, one per connection, each connected to a fresh `McpServer` from the same factory. `McpServer.connect()` over a plain transport serves the handshake era.
- **Message URL.** The transport's endpoint is `${basePath}/messages`, so the `endpoint` event works behind a proxy in either style. The client resolves it against the stream's origin, and the proxy or `rewriteUrl` strips the prefix.
- **Order.** Both routes apply the origin policy first (403 for denied). `/messages` looks the session up by `sessionId` and answers an unknown one with 404.
- **Keep-alive.** A `: keepalive` comment goes out every `server.heartbeatMs` (default 30 seconds) on each open stream, the setting the transport has always used.
- **Deprecation.** The first connection per process logs a warning naming the MCP endpoint's public URL.
- **Never with auth.** v1 never authenticated `/messages`, and SSE-era clients predate protected-resource discovery. Offering the transport only without auth avoids both problems instead of retrofitting them.
- **Cost.** The package brings the whole frozen v1 auth kit as dependencies, and npm auto-installs its `express` peer: 41 packages installed. The `/sse` subpath loads neither Express nor the auth helpers at runtime. Writing our own transport would save the install but re-implement a wire protocol we're about to drop.
- **Other removals.** The session maps of the old `/mcp` implementation and `@fastify/formbody` (only the OAuth token proxy used it) are removed.
- **No `X-Accel-Buffering` code of our own.** The SDK sets it on every Streamable HTTP event stream, and a test asserts it.

**One 404 policy.** `setNotFoundHandler` serves the SPA shell only for a GET (or HEAD) whose path isn't under `/api`, `/mcp`, `/sse`, `/messages`, `/oauth`, `/.well-known/` or `/assets`. Everything else gets a JSON 404. The removed `/oauth/*` proxy paths are on the list because clients probing them must get a clean 404, not the web UI; the E2E suite caught `/oauth/authorize` falling through to the shell. The check runs on the already-rewritten URL, so it covers both proxy styles.

## Program Design

```
package.json                     ~ swap @modelcontextprotocol/sdk for @modelcontextprotocol/server + /node
                                   + /server-legacy (deprecated SSE shim) (+ /client as devDependency);
                                   drop @fastify/formbody
vite.config.web.ts               ~ base "./": one build serves any path
public/manifest.json             ~ relative icon paths and start_url
src/
  app/
~   AppServer.ts                 # location in constructor, rewriteUrl, <base> injection, 404 policy,
                                 # /api + upgrade origin checks, auth wiring, startup statement
~   AppServer.test.ts
+   basePath.ts                  # stripBasePath, injectBaseHref, servesSpaShell (pure helpers)
+   basePath.test.ts
+   originPolicy.ts              # origin verdicts and CORS header writers
+   originPolicy.test.ts
  auth/
-   ProxyAuthManager.ts          # OAuth proxy + userinfo fallback removed
-   ProxyAuthManager.test.ts
-   middleware.ts                # replaced by our 401 + verifyBearerToken / bearerAuthChallengeResponse
-   middleware.test.ts
+   JwtAccessTokenVerifier.ts    # MCP-order discovery, issuer identity, JWKS, iss/aud/exp
+   JwtAccessTokenVerifier.test.ts
+   protectedResourceMetadata.ts # RFC 9728 document, paths, advertised URL, missing-token challenge
+   protectedResourceMetadata.test.ts
~   index.ts                     # new exports
~   types.ts                     # AuthConfig: audience optional, scopes removed
  cli/
~   commands/default.ts          # --public-url; stdio branch: warn that auth doesn't apply
~   commands/mcp.ts              # --public-url; stdio branch: warn that auth doesn't apply
~   commands/web.ts              # --public-url
~   commands/worker.ts           # --public-url
~   services.ts                  # holds the StdioServerHandle instead of an McpServer
~   utils.ts                     # validateAuthConfig: formats only, audience optional
  mcp/
~   mcpServer.ts                 # registerTool/registerResource, zod v4 schemas
~   mcpServer.test.ts
~   startStdioServer.ts          # serveStdio(factory), legacy: "serve"
~   utils.ts                     # CallToolResult from @modelcontextprotocol/server
  services/
~   mcpService.ts                # one /mcp route: origin, preflight, 405, auth, handler;
                                 # deprecated /sse + /messages only when unauthenticated
~   mcpService.test.ts
~   systemInfo.ts                # advertises the MCP endpoint URL; no /sse
  utils/
~   config.ts                    # publicUrl + allowedOrigins schema and mapping; publicUrl-wins warning
~   config.test.ts
~   serverOrigin.ts              # normalizePublicUrl (incl. reserved segments), resolvePublicLocation
~   serverOrigin.test.ts
  web/client/
~   index.html                   # relative icon href
~   main.tsx                     # basename + tRPC URLs from document.baseURI
~   components/Icon.tsx          # only if the <base> icon check fails
~   pages/Settings.tsx           # shows the advertised MCP URL; auth protects the MCP endpoint only
test/
~ mcp-http-e2e.test.ts           # v2 client pinned to 2026-07-28
~ mcp-stdio-e2e.test.ts          # legacy and current-revision clients
~ auth-e2e.test.ts               # hermetic local issuer; optional live-provider block
+ base-path-e2e.test.ts          # both proxy styles, host-root metadata rule, Playwright UI checks
docs/
+ infrastructure/reverse-proxy.md
~ infrastructure/authentication.md, deployment-modes.md; setup/configuration.md, installation.md;
  guides/mcp-clients.md; README.md; ARCHITECTURE.md; AGENTS.md (test inventory)
```

New signatures, and what each does on failure:

```ts
// src/utils/serverOrigin.ts
export interface PublicLocation {
  url: string;      // canonical, no trailing slash: "https://example.com/docs"
  origin: string;   // "https://example.com"
  basePath: string; // "" or "/docs"
}
/**
 * Throws Error("server.publicUrl …") on credentials, query, fragment, a non-http(s) scheme,
 * or a first path segment that collides with a root route.
 */
export function normalizePublicUrl(value: string | undefined): string | undefined;
/** Pure. Order: publicUrl, then publicOrigin, then the bind origin. */
export function resolvePublicLocation(config: AppConfig, port: number): PublicLocation;

// src/app/originPolicy.ts
export type OriginVerdict = "absent" | "allowed" | "denied"; // "null" and unparsable values are "denied"
export interface OriginPolicy {
  check(origin: string | undefined): OriginVerdict;
}
export function createOriginPolicy(o: { publicHostname?: string; allowedOrigins: readonly string[] }): OriginPolicy;
/** ACAO echo, Vary: Origin, Expose-Headers: WWW-Authenticate. Call only for "allowed". */
export function setCorsResponseHeaders(res: ServerResponse, origin: string): void;
/** Preflight headers: allow-methods POST, requested headers echoed. The caller sends the 204. Call only for "allowed". */
export function setCorsPreflightHeaders(res: ServerResponse, origin: string, requestedHeaders: string | undefined): void;
/** Requested header names reduced to valid tokens; shared with the metadata preflight. */
export function sanitizeRequestedHeaders(requestedHeaders: string | undefined): string | undefined;
export function isLoopbackBindHost(host: string): boolean;

// src/auth/JwtAccessTokenVerifier.ts
export class JwtAccessTokenVerifier implements OAuthTokenVerifier {
  /**
   * Discovers metadata in MCP client order. Throws when no document answers,
   * the document has no jwks_uri, or metadata.issuer !== issuerUrl.
   */
  static create(options: { issuerUrl: string; audience: string }): Promise<JwtAccessTokenVerifier>;
  /** OAuthError(InvalidToken) for token content; OAuthError(ServerError) when keys can't be fetched. */
  verifyAccessToken(token: string): Promise<AuthInfo>;
}

// src/auth/protectedResourceMetadata.ts
export function buildProtectedResourceMetadata(o: { mcpEndpointUrl: string; issuerUrl: string }): Record<string, unknown>;
/** ["/.well-known/oauth-protected-resource/mcp"], plus the RFC 9728 host-root form when basePath is non-empty. */
export function protectedResourceMetadataPaths(basePath: string): string[];
export function protectedResourceMetadataUrl(location: PublicLocation): string;
/** `Bearer resource_metadata="<url>"`: no error code, for requests without credentials. */
export function missingTokenChallenge(resourceMetadataUrl: string): string;

// src/app/basePath.ts
/** Segment-aware: strips "/docs" and "/docs/…", never "/docs-old". Identity when basePath is "". */
export function stripBasePath(url: string, basePath: string): string;
/** Inserts <base href="{basePath}/"> as the first child of <head>. */
export function injectBaseHref(html: string, basePath: string): string;
export function servesSpaShell(method: string, path: string): boolean;

// src/services/mcpService.ts: no McpServer is returned any more; there is no session state to clean up
export function registerMcpService(
  server: FastifyInstance,
  deps: {
    docService: IDocumentManagement;
    pipeline: IPipeline;
    config: AppConfig;
    originPolicy: OriginPolicy;
  },
  auth?: { verifier: OAuthTokenVerifier; resourceMetadataUrl: string },
): Promise<void>;
```

Request path for the MCP endpoint:

```
Fastify rewriteUrl(req)                          # "/docs/mcp" -> "/mcp"; "/mcp" unchanged
route ALL /mcp
  onRequest hook                                 # invariant: runs before body parsing, so the order holds
    originPolicy.check(Origin)                   # "denied" -> 403 JSON, no CORS headers; stop
    OPTIONS + Access-Control-Request-Method
        -> setCorsPreflightHeaders() -> 204; stop  # invariant: before auth (browsers send no credentials)
    "allowed" -> setCorsResponseHeaders(reply.raw, origin)   # before anything is written
    method != POST -> 405 + Allow: POST; stop
  handler
    [auth] no Bearer header -> 401 + missingTokenChallenge(); stop
           verifyBearerToken(header, { verifier, resourceMetadataUrl })
               JwtAccessTokenVerifier.verifyAccessToken()    # InvalidToken -> 401 | ServerError -> 500
           catch -> bearerAuthChallengeResponse(err, …) copied onto reply; stop
    reply.hijack()                               # Fastify must not also send
    toNodeHandler(createMcpHandler(factory, { legacy: "stateless" }))(
        Object.assign(req.raw, { auth }), reply.raw, request.body)
        factory() -> createMcpServerInstance(tools, config)   # fresh McpServer per request
```

Startup order in `AppServer`:

```
constructor
+   location = resolvePublicLocation(appConfig, port)    # warns: publicOrigin deprecated / ignored
+   originPolicy = createOriginPolicy({ publicHostname, allowedOrigins })
~   Fastify({ logger: false, rewriteUrl: (req) => stripBasePath(req.url, location.basePath) })
~   systemInfo = buildSystemInfo(serverConfig, appConfig, location)
setupServer()
+   if auth enabled && MCP served over HTTP:
+       require issuer + public URL                      # throws naming the missing setting
+       verifier = await JwtAccessTokenVerifier.create({ issuerUrl, audience: auth.audience || mcpEndpointUrl })
+       register metadata routes: protectedResourceMetadataPaths(location.basePath)   # GET + OPTIONS
+   else if auth enabled: warn "authentication protects nothing in this process"
-   initializeAuth() / ProxyAuthManager.registerRoutes()
-   register(formBody); OAuth debug onRequest hook
+   if isLoopbackBindHost(host): onRequest hook on /api applies originPolicy
    enableMcpServer()                                    # registerMcpService(…, { location, originPolicy }, auth)
    enableTrpcApi() / enableWorker()
    setupStaticFiles()                                   # shell via injectBaseHref; not-found uses servesSpaShell
start()
~   upgrade handler: loopback bind && originPolicy denies -> write 403, destroy socket
~   logStartupInfo(location.url)                         # MCP endpoint URL, no /sse; auth boundary statement
```

Implementation constraints:

- **Migrate mechanically first.** Run `npx @modelcontextprotocol/codemod@latest v1-to-v2 .` at the package root, then fix what it marks with `@mcp-codemod-error`. Tool schemas move from `zod/v3` to `zod` (v4.4 is installed, above v2's 4.2 floor) and get wrapped in `z.object(…)`. `patternsSchema` uses `.transform`, so pin its advertised JSON Schema with a `tools/list` assertion: the SDK converts with `io: "input"`, which must stay `string | string[]`.
- **E2E tests must not depend on Clerk.** `auth-e2e` starts a local issuer: a `jose` key pair, with RFC 8414 metadata and JWKS served. A live-provider block runs only when `DOCS_MCP_AUTH_ISSUER_URL` is set.
- **`base-path-e2e` runs a small Node proxy** in forward-prefix and strip-prefix modes, including the host-root metadata rule. It drives Playwright (already a dependency) for the UI checks.

## Risks / Trade-offs

- [Handshake-era clients are served statelessly, so they get no server-initiated messages on a standing stream] → The endpoint was stateless before this change as well, so nothing an existing client relies on goes away.
- [Existing auth deployments break until the provider issues JWTs with `aud`] → Documented per provider. Clerk's setup is verified. Tokens accepted today through the userinfo fallback stop working, which is the point.
- [A reverse proxy in front of a loopback-bound server without `publicUrl` now gets its web UI's API calls refused, because the browser's `Origin` is the public host] → The release notes and the proxy guide tell operators behind a proxy to set `publicUrl`. Auth deployments need it anyway.
- [CORS is new surface] → It is only emitted for allowed origins, there are no credentials, and preflights skip nothing but authentication. `originPolicy.test.ts` and the E2E suites cover allowed, denied and absent origins.
- [The Node WebSocket client on the worker link might send an `Origin` the policy denies] → A test runs a coordinator against a loopback-bound worker and asserts that event subscriptions arrive.
- [`<base href>` changes how every relative URL resolves, including SVG fragment references] → Playwright checks icons, a deep link and in-app navigation. `Icon.tsx` has a known fix if needed.
- [An `auth.audience` override set to a client ID admits ID tokens] → The docs require the override to name an API or resource identifier.
- [The v2 SDK is two months old; its Fastify path is untested here] → The first implementation task is a spike that mounts it and checks the SDK behaviors this design relies on.

## Migration Plan

This is a breaking release for authentication only: HTTP and stdio clients, the legacy SSE transport, the web UI and every setting keep working as before. The commit that reworks authentication carries a `BREAKING CHANGE:` footer, so semantic-release cuts 4.0.0. Change `cli-defaults-do-not-override-env` follows on the same branch as a plain `fix` commit, in the same release. The release notes list, for operators:

- Move MCP clients to `/mcp`.
- Set `server.publicUrl` behind any reverse proxy. Auth requires it, and on a loopback bind the web UI's API calls need it.
- Enable JWT access tokens with an `aud` claim at the identity provider.
- Drop `auth.audience` unless the provider issues a fixed audience.
- List hosted browser clients in `server.allowedOrigins`.

Rollback means reinstalling 3.x; there is no data migration.
