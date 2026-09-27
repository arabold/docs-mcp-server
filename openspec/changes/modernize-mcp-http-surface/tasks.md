# Tasks

Ordering: this change is implemented first. `cli-defaults-do-not-override-env` follows on the same branch, before release. Until it lands, `DOCS_MCP_AUTH_ENABLED` has no effect on `server`/`mcp`, so manual auth checks pass `--auth-enabled` instead. Automated tests set the config directly and are unaffected.

## 1. Spike: SDK v2 on our Fastify instance

- [x] 1.1 Install `@modelcontextprotocol/server` and `@modelcontextprotocol/node` (and `@modelcontextprotocol/client` as a devDependency) on Node 22. Verify `npm ls @modelcontextprotocol/server @modelcontextprotocol/node` resolves 2.x with no peer warnings.
- [x] 1.2 In a scratch test, mount `toNodeHandler(createMcpHandler(factory, { legacy: "stateless" }))` on an `app.all("/mcp")` route of a plain Fastify instance, with `reply.hijack()`, `request.raw`, `reply.raw` and `request.body`. Verify:
  - a v2 client pinned to `2026-07-28` lists a registered tool;
  - a `2025-06-18` `initialize` is answered statelessly, without `Mcp-Session-Id`;
  - the SDK's own event-stream responses carry `X-Accel-Buffering: no`;
  - a header set on `reply.raw` before hand-off (e.g. `Access-Control-Allow-Origin`) survives on both JSON and event-stream responses.

  Record any deviation from design.md before continuing.

## 2. Public location and configuration

- [x] 2.1 Add `normalizePublicUrl` and `resolvePublicLocation` to `src/utils/serverOrigin.ts`, with TSDoc. Verify `serverOrigin.test.ts` covers:
  - path kept, trailing slash dropped;
  - query, fragment, credentials and non-http schemes rejected;
  - first segments `mcp`, `api`, `assets` and `.well-known` rejected with a collision message;
  - `publicOrigin` used as a path-less URL;
  - `publicUrl` winning over `publicOrigin`;
  - the bind-origin fallback, including IPv6.
- [x] 2.2 In `src/utils/config.ts`, add `server.publicUrl` (schema plus mapping for `DOCS_MCP_SERVER_PUBLIC_URL` / `publicUrl`) and `server.allowedOrigins` (an origin-validated string array, default `[]`). Keep `server.heartbeatMs` for the SSE keep-alive. Verify `config.test.ts` covers:
  - `publicUrl` from file, env and CLI;
  - `DOCS_MCP_SERVER_ALLOWED_ORIGINS` as a JSON array;
  - an allowed-origins entry with a path rejected;
  - `server.heartbeatMs` loading from a config file.
- [x] 2.3 Add `--public-url` to `default`, `mcp`, `web` and `worker`, with no yargs default. Log a deprecation warning naming `server.publicUrl` when `publicOrigin` is in effect, and an "ignored" warning when both are set. Verify `AppServer.test.ts` asserts both warnings (they're logged where the public location is resolved). The guard in `cli-defaults-do-not-override-env` confirms the missing default once that change lands.

## 3. SDK v2 migration of the MCP layer

- [x] 3.1 Run `npx @modelcontextprotocol/codemod@latest v1-to-v2 .` at the package root, then `biome format --write` on the changed files. Verify `grep -rn '@mcp-codemod-error' src test` lists what is left for 3.2–3.4.
- [x] 3.2 In `src/mcp/mcpServer.ts`, register every tool with `registerTool` and every resource with `registerResource`, moving schemas from `zod/v3` to `zod` and wrapping them in `z.object(…)`. Verify `mcpServer.test.ts` asserts the full `tools/list` output, including `patternsSchema` still advertised as `string | string[]` and `.describe()` texts present, and that the read-only tool set is unchanged.
- [x] 3.3 Replace the `StdioServerTransport` wiring in `src/mcp/startStdioServer.ts` with `serveStdio(factory)` from `@modelcontextprotocol/server/stdio` (default legacy posture `"serve"`). Hold the returned `StdioServerHandle` in `src/cli/services.ts` for shutdown. Verify SIGINT shutdown still exits cleanly in `mcp-stdio-e2e`.
- [x] 3.4 Switch the remaining SDK imports (`src/mcp/utils.ts`, tests) to v2 packages and remove `@modelcontextprotocol/sdk` from `package.json`. Verify `grep -rn "@modelcontextprotocol/sdk" src test` returns nothing and `npm run typecheck` passes.

## 4. MCP HTTP endpoint and origins

- [x] 4.1 Add `src/app/originPolicy.ts` (`createOriginPolicy`, `setCorsResponseHeaders`, `answerCorsPreflight`, `isLoopbackBindHost`). Verify `originPolicy.test.ts` covers:
  - absent Origin;
  - loopback on any port;
  - the public hostname;
  - an exact `allowedOrigins` match, and a port mismatch against it denied;
  - `null`, unparsable and foreign origins denied;
  - the preflight echoing requested headers;
  - `Vary` and `Expose-Headers` on responses.
- [x] 4.2 Rewrite `src/services/mcpService.ts` as the single `/mcp` route in design.md's order: origin → preflight → 405 with `Allow: POST` → auth → `createMcpHandler` with `legacy: "stateless"`, which serves handshake-era clients per request as before. Remove the session maps. Verify `mcpService.test.ts` covers every `mcp-transports` scenario:
  - foreign Origin → 403 even with a valid token;
  - GET with auth on and no token → 405 with `Allow: POST`;
  - a legacy POST without a token under auth → 401, and without auth → a stateless `initialize` result;
  - `server/discover` listing only `2026-07-28`;
  - public-host and listed origins accepted;
  - the preflight answered without a token;
  - the 401 readable cross-origin;
  - `X-Accel-Buffering: no` on an event-stream response.
- [x] 4.3 Add `servesSpaShell` in `src/app/basePath.ts` and use it in the not-found handler. Verify with the web UI enabled that `/sse`, `/messages`, `/mcp/anything`, `/.well-known/unknown-document` and the former `/oauth/*` paths get a JSON 404 (not `text/html`), and that `/libraries` still returns the shell. `AppServer.test.ts` mocks Fastify, so these real-HTTP checks live in `test/mcp-http-e2e.test.ts`; `basePath.test.ts` covers the policy itself.
- [x] 4.4 On a loopback bind, apply the origin policy to `/api` (an `onRequest` hook scoped to the prefix) and to the WebSocket `upgrade` handler (write 403 and destroy the socket). Verify, in `AppServer.test.ts` for the hook's presence and `test/mcp-http-e2e.test.ts` for real HTTP:
  - a foreign-origin API request → 403;
  - a foreign-origin upgrade refused;
  - a `localhost` origin served;
  - no check on a `0.0.0.0` bind.

  Also verify that the worker link's WebSocket client (Node's built-in `WebSocket`, used through tRPC) still connects to a loopback-bound server.
- [x] 4.5 Update `src/services/systemInfo.ts` to expose the advertised MCP endpoint URL instead of `["/mcp", "/sse"]`. Update `src/web/client/pages/Settings.tsx` to show it and to describe auth as protecting the MCP endpoint only. Change `logStartupInfo` to print `location.url`-based URLs, with no `/sse`. Verify `systemInfo.test.ts`, `systemHealthRouter.test.ts`, and a startup-output assertion for `https://docs.example.com/tools/mcp`.

- [x] 4.6 Add the deprecated HTTP+SSE shim to `src/services/mcpService.ts`. It mounts `GET /sse` and `POST /messages` only when no auth is passed, and uses `SSEServerTransport` from `@modelcontextprotocol/server-legacy/sse` with endpoint `${basePath}/messages`. Also:
  - the origin policy applies first;
  - an unknown `sessionId` gets 404;
  - each open stream gets a `: keepalive` comment every `server.heartbeatMs`;
  - the first connection per process logs a deprecation warning naming the MCP endpoint.

  Verify `mcpService.test.ts` covers:
  - the `endpoint` event naming `/docs/messages?sessionId=…` for a `/docs` base path;
  - an `initialize` POSTed to it being answered on the stream;
  - an unknown session → 404;
  - a foreign origin → 403;
  - both routes absent when auth is passed;
  - the warning logged once.

## 5. Authorization

- [x] 5.1 Add `src/auth/JwtAccessTokenVerifier.ts`:
  - discovery in MCP client order (RFC 8414 insertion → OIDC insertion → OIDC append);
  - `metadata.issuer` required to equal the configured issuer;
  - `jwtVerify` with `issuer`, `audience` and `exp`;
  - `InvalidToken` for token content, `ServerError` for key-fetch failures;
  - `AuthInfo` with `expiresAt`, `clientId` and `scopes`.

  Verify `JwtAccessTokenVerifier.test.ts` uses a local `jose` key pair to cover: a valid token; wrong `aud`, wrong `iss`, expired, bad signature and opaque tokens; an unreachable JWKS → `ServerError`; an issuer with a path discovered via insertion; `create` failing on an issuer mismatch (trailing slash) and on missing `jwks_uri`.
- [x] 5.2 Add `src/auth/protectedResourceMetadata.ts` and register its GET and OPTIONS routes from `AppServer`. Verify `protectedResourceMetadata.test.ts` and `AppServer.test.ts` cover:
  - `resource` equal to the MCP endpoint URL;
  - `authorization_servers` equal to the issuer;
  - `bearer_methods_supported: ["header"]`;
  - `Access-Control-Allow-Origin: *`;
  - both locations when a base path is set;
  - no root document;
  - a spoofed `Host` not leaking into the document.
- [x] 5.3 Wire the challenges into the `/mcp` route. Verify tests assert:
  - with no `Authorization` header, 401 with `resource_metadata` and *no* `error` parameter;
  - with a rejected token, 401 with `error="invalid_token"` and `resource_metadata`;
  - with an unreachable JWKS, a 5xx without `invalid_token`.
- [x] 5.4 Put the auth startup checks in `AppServer`:
  - auth on with MCP over HTTP: fail on a missing `auth.issuerUrl`, a missing public URL, or an issuer mismatch;
  - auth on without MCP: warn that it protects nothing;
  - auth on: state the protected endpoint and that the web UI and API are unprotected.

  Also:
  - Make the stdio branches of `default.ts` and `mcp.ts` warn that auth doesn't apply, and skip auth validation.
  - Reduce `validateAuthConfig` in `src/cli/utils.ts` to format checks, with `auth.audience` optional (default: the MCP endpoint URL), and update `src/auth/types.ts`.

  Verify tests for each branch, including stdio starting with auth enabled and no issuer, and `/api` reachable without a token.
- [x] 5.5 Delete `ProxyAuthManager` and the old `middleware.ts` with their tests, the OAuth debug `onRequest` hook, and `@fastify/formbody`. Verify `/.well-known/oauth-authorization-server` and `/oauth/authorize|token|register|revoke` return 404 (in `test/mcp-http-e2e.test.ts`, which runs a real server), and `grep -rn "ProxyAuthManager\|formbody" src` returns nothing.

## 6. Base path

- [x] 6.1 Add `stripBasePath` and `injectBaseHref` to `src/app/basePath.ts`. In the `AppServer` constructor, resolve the public location and pass `rewriteUrl` to Fastify, and use `injectBaseHref` in the SPA shell handler. Verify `basePath.test.ts` covers:
  - the segment-aware prefix (`/docs`, `/docs/` and `/docs/mcp` stripped; `/docs-old` not);
  - the identity case with no base path;
  - `<base>` as the first child of `<head>`.
- [x] 6.2 Build the web UI with `base: "./"` in `vite.config.web.ts`. Make the icon link in `src/web/client/index.html` and the paths in `public/manifest.json` relative. In `main.tsx`, derive the `BrowserRouter` `basename` and the tRPC HTTP and WebSocket URLs from `document.baseURI`. Verify `npm run build` emits `./assets/…` references in `public/index.html`, and that the UI still works at the root with no base path.

## 7. End-to-end suites

- [x] 7.1 Rewrite `test/mcp-http-e2e.test.ts` with the v2 client pinned to `2026-07-28`: `server/discover`, tools list, a `search_docs` call, a handshake-era client listing and calling tools, GET → 405 with `Allow: POST`, and the 404 surface. Verify it passes in `npm test`.
- [x] 7.2 Update `test/mcp-stdio-e2e.test.ts` to connect once with a handshake-era client and once with a `2026-07-28` client. Verify both pass.
- [x] 7.3 Rewrite `test/auth-e2e.test.ts` against a local issuer (a `jose` key pair, with RFC 8414 metadata and JWKS served), so it runs in the default suite. Cover:
  - a valid token → 200;
  - wrong audience, wrong issuer, expired and opaque tokens → 401;
  - no token → a challenge without an error code;
  - the metadata shape.

  An issuer outage → 5xx is covered by `JwtAccessTokenVerifier.test.ts` (unreachable keys → `ServerError`) and `mcpService.test.ts` (`ServerError` → 5xx without `invalid_token`). `jose` caches the key set, so on a shared E2E server the result would depend on test order.

  Keep an optional live-provider block that runs only when `DOCS_MCP_AUTH_ISSUER_URL` is set and derives the expected audience from the public URL. Verify the suite passes without a `.env`.
- [x] 7.4 Add `test/base-path-e2e.test.ts`. It runs a small Node proxy in forward-prefix and strip-prefix modes, plus the host-root metadata rule, in front of the server with `server.publicUrl=http://127.0.0.1:<port>/docs`. Cover over HTTP:
  - the shell's `<base>` and its assets;
  - an API call and a WebSocket subscription;
  - an MCP `tools/list`;
  - both metadata locations.

  With Playwright, cover:
  - opening `/docs/libraries/<lib>` directly renders the page with its icons visible;
  - every request the page makes is under `/docs/`;
  - clicking Jobs yields `/docs/jobs`;
  - a page served from an allowed origin can preflight and read a 401 challenge from `/docs/mcp`.

  Verify it passes in both proxy modes.
- [x] 7.5 Cover the deprecated SSE transport end to end:
  - `test/mcp-http-e2e.test.ts`: a legacy `SSEClientTransport` from `@modelcontextprotocol/client` connects to `/sse` with auth off, lists tools and calls `search_docs`;
  - `test/base-path-e2e.test.ts`: in both proxy modes, the `endpoint` event names `/docs/messages?sessionId=…` and a legacy client lists tools through the proxy;
  - `test/auth-e2e.test.ts`: `GET /sse` and `POST /messages` answer 404 with auth on.

  Verify all three pass in `npm test`.

## 8. Documentation

- [x] 8.1 Add `docs/infrastructure/reverse-proxy.md`:
  - a working nginx `location /docs/` block (prefix stripped, `proxy_buffering off`, WebSocket upgrade headers), plus a `location = /.well-known/oauth-protected-resource/docs/mcp` rule;
  - a Traefik example (StripPrefix and pass-through) with the equivalent router;
  - `server.publicUrl` set in each;
  - the web UI is opened under the path;
  - `/api` needs proxy-level auth;
  - hosted browser clients go in `server.allowedOrigins`.

  Verify the nginx config against the base-path suite's strip-prefix behavior.
- [x] 8.2 Rewrite `docs/infrastructure/authentication.md` for the resource-server model:
  - the required public URL and an issuer matching the provider's own;
  - the optional audience, which must name an API or resource identifier, never a client ID;
  - the discovery flow;
  - provider setup, for Clerk: JWT access tokens, `aud` claim, PKCE required, CIMD recommended.

  Remove the proxy/DCR sequence diagram. Verify every documented endpoint and setting exists in code.
- [x] 8.3 Update `README.md`, `ARCHITECTURE.md`, `docs/guides/mcp-clients.md`, `docs/infrastructure/deployment-modes.md`, `docs/setup/configuration.md` and `docs/setup/installation.md`:
  - `/mcp` as the endpoint, with `/sse` only as a deprecated note;
  - `publicUrl` and `allowedOrigins` documented.

  Update the test inventory in `AGENTS.md`: `base-path-e2e.test.ts` listed, and the `auth-e2e` row now hermetic. Verify `grep -rn "/sse\|--public-origin" README.md ARCHITECTURE.md docs AGENTS.md` only finds deprecation notes.
- [x] 8.4 Add a short "Legacy SSE transport (deprecated)" section at the end of `docs/guides/mcp-clients.md`. It covers the `/sse` URL, that it only works with authentication off, and that `/mcp` replaces it. Add one line to the endpoint table in `docs/infrastructure/authentication.md` saying `/sse` and `/messages` are not served with auth on. Verify no other user-facing doc, the startup output or the web UI names `/sse`.

## 9. Verification

- [x] 9.1 Run `npm run lint`, then `npm run typecheck` with a cold cache (delete `*.tsbuildinfo` first), then `npm test` on Node 22. Verify all pass.
- [ ] 9.2 Manually connect a client that speaks `2026-07-28` through a local prefix-stripping proxy at `/docs`, with auth against the Clerk dev instance. Use the MCP Inspector if its current release speaks that revision; otherwise use a script on the v2 client pinned to `2026-07-28`. Verify:
  - the client discovers the metadata, signs in, receives a token with `aud` equal to `<publicUrl>/mcp`, and lists tools;
  - a request without a token gets 401 with `resource_metadata`.
- [x] 9.3 Run `openspec validate modernize-mcp-http-surface --strict`. Verify it reports no issues.

## 10. Archive follow-up

- [ ] 10.1 When archiving, edit the Purpose of `openspec/specs/server-origin-urls/spec.md` so it no longer mentions OAuth metadata (the requirements that covered it are removed). Verify `openspec show server-origin-urls --type spec` reads correctly.
