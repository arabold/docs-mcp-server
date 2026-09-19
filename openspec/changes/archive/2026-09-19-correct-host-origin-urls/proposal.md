## Why

Startup endpoint URLs and OAuth discovery metadata can disagree with the host/origin that operators intend clients to use. This causes confusion for ordinary `--host` usage and can break auth-enabled remote deployments when metadata advertises `localhost`.

## What Changes

- Generate human-facing startup endpoint URLs from the configured bind host and selected service port instead of relying on Fastify's normalized listen address.
- Introduce an explicit public server origin for externally advertised URLs, so auth metadata can use a client-reachable origin instead of a bind address.
- Use one shared origin-building path for startup display and server-generated endpoint metadata, including IPv6-safe URL formatting.
- Preserve existing bind behavior: `--host` continues to control the network interface the server listens on.
- Document and validate the difference between bind host values such as `0.0.0.0` and externally reachable public origins.

## Capabilities

### New Capabilities
- `server-origin-urls`: Defines how the server derives and uses bind-host, display, and public origins for generated endpoint URLs and metadata.

### Modified Capabilities
- `cli-output`: Startup diagnostics must display endpoint URLs that reflect configured host/origin behavior.
- `configuration`: Server configuration must expose and validate the public origin used for externally advertised URLs.

## Impact

- Affected code: `src/app/AppServer.ts`, configuration schema/loading in `src/utils/config.ts`, CLI option/env mappings, and auth metadata registration.
- Affected tests: AppServer startup logging, auth metadata route registration, configuration precedence/validation, and relevant CLI/E2E coverage.
- Affected docs: server configuration docs and auth/deployment guidance explaining bind host versus public origin.
- No dependency changes expected.
