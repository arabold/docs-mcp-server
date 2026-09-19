## 1. Configuration

- [x] 1.1 Add optional `server.publicOrigin` to the default config shape, Zod schema, typed `AppConfig`, and config serialization path.
- [x] 1.2 Add environment and CLI override support for `server.publicOrigin`, including `DOCS_MCP_SERVER_PUBLIC_ORIGIN` and `--public-origin` on long-running server commands.
- [x] 1.3 Validate `server.publicOrigin` as an absolute `http` or `https` origin with no path, query, or fragment, and normalize a trailing slash.
- [x] 1.4 Add configuration tests for default absence, config-file loading, environment override, CLI precedence, invalid values, and trailing-slash normalization.

## 2. Origin Derivation

- [x] 2.1 Add a shared helper that derives a canonical origin from `server.publicOrigin` when present or from bind `host` plus selected `port` otherwise.
- [x] 2.2 Ensure the helper formats IPv4, hostnames, and IPv6 literals into valid URL origins.
- [x] 2.3 Add unit tests for public-origin preference, bind-derived fallback, wildcard bind hosts, and IPv6 bracket formatting.

## 3. Server Integration

- [x] 3.1 Update `AppServer.start()` and startup logging to use the canonical origin instead of Fastify's returned listen address for displayed endpoint URLs.
- [x] 3.2 Update OAuth route registration to pass the canonical origin into `ProxyAuthManager.registerRoutes()` instead of hard-coded `http://localhost:<port>`.
- [x] 3.3 Emit a warning when auth is enabled, no public origin is configured, and the bind host is a wildcard address.
- [x] 3.4 Preserve existing Fastify binding behavior so `server.host` continues to be passed unchanged to `listen()`.

## 4. Documentation

- [x] 4.1 Update configuration documentation to describe `server.host` as the bind interface and `server.publicOrigin` as the externally advertised origin.
- [x] 4.2 Update `docs/infrastructure/authentication.md` to briefly mention `server.publicOrigin` / `--public-origin` for auth-enabled remote or reverse-proxy deployments.

## 5. Validation

- [x] 5.1 Add AppServer tests proving startup URLs show `0.0.0.0` when `--host 0.0.0.0` is used without a public origin.
- [x] 5.2 Add AppServer or auth tests proving OAuth metadata and forced OAuth resource values use `server.publicOrigin` when configured.
- [x] 5.3 Add tests proving OAuth metadata falls back to the bind-derived origin and never hard-codes localhost.
- [x] 5.4 Run targeted tests for config, AppServer, auth metadata, and any updated CLI command parsing.
