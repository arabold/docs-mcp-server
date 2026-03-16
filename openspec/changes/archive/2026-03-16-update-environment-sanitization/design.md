## Context

The application currently normalizes quoted values only when they pass through `src/utils/config.ts`, while many runtime paths read `process.env` directly. This split leads to inconsistent behavior: config-backed `DOCS_MCP_*` variables can be corrected in one place, but provider credentials, base URLs, tokens, log settings, and runtime toggles may still include literal outer quotes from Docker Compose or other environment injectors.

A proposal is needed because the fix changes bootstrap behavior across multiple systems rather than addressing a single leaf bug.

## Goals / Non-Goals

**Goals:**
- Normalize surrounding quotes for environment variables from all supported injection paths, not just `.env` files
- Ensure normalization happens before runtime modules interpret environment values
- Keep the normalization rule narrow, predictable, and safe to run repeatedly
- Retain config-layer normalization for `DOCS_MCP_*` overrides as a secondary safeguard

**Non-Goals:**
- Rewriting arbitrary environment variable contents beyond trimming whitespace and removing matching outer quotes
- Changing the meaning of configuration precedence
- Introducing a new user-facing configuration option for environment sanitization
- Special-casing `src/tools/search-provider.ts`; it should benefit from generic handling automatically if it runs through the shared bootstrap path

## Decisions

### Decision 1: Sanitize environment variables during bootstrap

**What:** Add a bootstrap-time environment sanitization pass that runs after `dotenv/config` loads `.env` values and before the rest of the application imports modules that read `process.env`.

**Why:** Some modules interpret environment variables at import time or during early startup. Sanitizing only inside `loadConfig()` does not protect those code paths.

**Alternatives considered:**
- Sanitize only in `loadConfig()`: rejected because direct runtime `process.env` readers remain vulnerable
- Sanitize only in individual call sites: rejected because it is easy to miss direct readers and creates inconsistent behavior over time
- Sanitize all environment values lazily via wrapper helpers: rejected because existing code reads `process.env` directly across multiple modules

### Decision 2: Limit normalization to trimming and removing matching outer quotes

**What:** The sanitizer removes leading/trailing whitespace and strips only matching surrounding single or double quotes.

**Why:** This fixes the Docker Compose and shell-quoting failure mode without rewriting valid values that contain internal quotes.

**Alternatives considered:**
- Removing all quote characters: rejected because it would corrupt legitimate values
- Leaving whitespace untouched: rejected because surrounding spaces create the same class of parsing failures as quotes

### Decision 3: Keep configuration-layer sanitization as defense in depth

**What:** `src/utils/config.ts` continues to normalize environment-derived config values even after bootstrap sanitization exists.

**Why:** Tests and direct consumers of config loading may execute without the normal application bootstrap path. Keeping config normalization local preserves correctness in those contexts.

## Risks / Trade-offs

- Bootstrap import ordering becomes more important → mitigate by documenting that sanitization must occur before importing runtime modules that read `process.env`
- Global mutation of `process.env` may surprise contributors → mitigate by limiting the transformation to matching outer quotes and whitespace trimming, and documenting the rule in code and tests
- Some test setups may bypass the normal entrypoint → mitigate by keeping config-layer normalization and adding targeted bootstrap tests

## Migration Plan

1. Add a shared environment normalization utility
2. Update application bootstrap to sanitize environment variables before importing runtime modules
3. Remove redundant one-off quote handling where the shared bootstrap now guarantees normalized inputs
4. Expand tests for bootstrap-level and config-level behavior
5. Run lint, typecheck, and test suites

## Open Questions

- Should bootstrap emit a debug-only log when it sanitizes one or more environment variables, or remain silent?
- Should non-entrypoint test setup files invoke the same bootstrap helper, or should tests rely only on direct utility coverage?
