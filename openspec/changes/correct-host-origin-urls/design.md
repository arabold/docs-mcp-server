## Context

`--host` currently reaches `appConfig.server.host` and is passed to Fastify's `listen` call, so the server binds to the requested interface. The startup banner, however, logs the address string returned by Fastify, which can normalize wildcard binds such as `0.0.0.0` to a loopback URL. Separately, auth metadata registration constructs its base URL from `http://localhost:${port}`, so auth-enabled deployments can advertise localhost endpoints even when the server is intentionally exposed on another host.

The implementation already treats auth metadata origins as trusted configuration rather than request-derived values to avoid Host header spoofing. The new design keeps that security boundary while making the configured origin explicit.

## Goals / Non-Goals

**Goals:**
- Preserve `server.host` / `--host` as the bind-interface setting used by Fastify.
- Display startup endpoint URLs that match the configured bind host when no public origin is configured.
- Add a canonical public origin setting for externally advertised URLs, especially OAuth authorization-server and protected-resource metadata.
- Ensure generated URLs are absolute, valid, and IPv6-safe.
- Add regression coverage for bind-host display and auth metadata origin generation.

**Non-Goals:**
- Do not infer public origins from request `Host`, `Forwarded`, or `X-Forwarded-*` headers.
- Do not change the MCP transport endpoints or introduce new auth flows.
- Do not make `0.0.0.0` a recommended public client URL; it remains a bind address and only becomes the fallback display origin when no public origin is configured.
- Do not change token audience validation semantics beyond using the canonical origin for generated OAuth resource and endpoint URLs.

## Decisions

### Decision: Separate bind host from public origin

Add an optional `server.publicOrigin` configuration value. `server.host` continues to control binding. `server.publicOrigin`, when set, controls externally advertised absolute URLs.

Alternatives considered:
- Reuse `server.host` for all generated URLs. This fixes the issue report but fails for reverse-proxy and TLS deployments where the bind host differs from the client-facing origin.
- Use `auth.audience` as the public origin. Audience identifies the expected token audience and may not be the same string as the HTTP origin or transport-specific resource URL.
- Trust request headers. This would make metadata convenient behind proxies but conflicts with the existing security model and can reintroduce Host header spoofing risks.

### Decision: Centralize URL origin formatting

Introduce a shared helper for deriving URL-safe origins from either `server.publicOrigin` or `{ protocol: "http", host, port }`. The helper should bracket IPv6 literals, omit default ports only if an existing URL parser naturally does so, and normalize configured public origins by removing a trailing slash.

Alternatives considered:
- Format URLs inline at each call site. That risks repeating the same host/IPv6/port edge cases and recreating drift between logs and metadata.
- Continue using Fastify's returned listen address. That describes what Fastify reports, not necessarily what operators configured or what clients should use.

### Decision: Use public origin for auth metadata and startup URLs when present

When `server.publicOrigin` is configured, startup diagnostics and OAuth metadata should use it. When it is absent, startup diagnostics use the bind-derived origin, and OAuth metadata falls back to the same bind-derived origin instead of hard-coded localhost.

Alternatives considered:
- Always display bind origin in startup logs and use public origin only in auth metadata. That makes it harder for operators to copy the correct MCP endpoint in proxy deployments.
- Require public origin whenever auth is enabled. That is safer for production but would be a breaking change for local auth testing.

### Decision: Warn for auth plus wildcard bind without public origin

If auth is enabled, no public origin is configured, and the bind host is wildcard (`0.0.0.0`, `::`, or equivalent), emit a warning that the fallback origin is a bind address and may not be usable by remote clients.

Alternatives considered:
- Fail startup. This would prevent ambiguous production deployments but could break current local workflows.
- Stay silent. That leaves a known footgun unaddressed after introducing the public-origin concept.

## Risks / Trade-offs

- [Risk] Operators may expect `--host 0.0.0.0` to be a public client URL. -> Mitigation: preserve the requested display behavior while documenting that `server.publicOrigin` is the correct external URL for clients.
- [Risk] Adding a new config key increases CLI/config surface area. -> Mitigation: keep it optional, use existing config precedence patterns, and validate it as a simple absolute origin.
- [Risk] Auth deployments behind proxies may still need HTTPS origins while the app listens over HTTP locally. -> Mitigation: `server.publicOrigin` accepts `https://...` even though the local bind uses HTTP.
- [Risk] Changing generated OAuth metadata can affect existing auth setups that accidentally depended on localhost. -> Mitigation: fallback remains local/bind-derived when no public origin is set, and tests cover the new deterministic behavior.

## Migration Plan

1. Add `server.publicOrigin` to defaults, schema, env mappings, config CLI support, and relevant server commands.
2. Add shared origin formatting helpers and replace direct uses of Fastify listen address / hard-coded auth base URL.
3. Update startup logging and auth metadata registration to use the shared origin selection.
4. Add unit coverage for configuration, origin formatting, startup logs, and auth metadata registration.
5. Update deployment and authentication docs to explain bind host versus public origin, with a concise note in `docs/infrastructure/authentication.md` for auth-enabled remote or reverse-proxy deployments.

Rollback is straightforward: unset `server.publicOrigin` to return to bind-derived URL generation, or revert the change if unexpected metadata behavior appears.

## Open Questions

- Resolved: `--public-origin` is available on long-running HTTP server commands only, matching where `--host` is useful and avoiding irrelevant flags on one-shot commands.
