# Change: Update Environment Variable Sanitization

## Why

Quoted environment variables from Docker Compose, shell exports, and other host-managed environments can reach the application with literal surrounding quotes. This causes configuration values and directly-read runtime environment variables to be misparsed, silently disabled, or rejected by downstream libraries. GitHub issue #353 is one concrete example, but the failure mode is generic across startup and integration paths.

## What Changes

- Add a generic environment sanitization step during application bootstrap so runtime modules read normalized `process.env` values
- Preserve configuration-layer sanitization for `DOCS_MCP_*` overrides as defense in depth
- Define bootstrap ordering requirements so sanitization runs after `.env` loading and before application modules consume environment variables
- Add tests that validate quoted environment variables from non-`.env` sources are handled consistently

## Impact

- Affected specs: `configuration`
- Affected code:
  - `src/index.ts` or equivalent bootstrap path
  - `src/utils/config.ts`
  - runtime modules that read `process.env` directly (for example `src/store/embeddings/EmbeddingFactory.ts`, `src/scraper/strategies/github-auth.ts`, `src/cli/utils.ts`, `src/utils/logger.ts`)
  - configuration and bootstrap tests
- Related issue: GitHub #353
