## Context

The configuration system currently uses a hybrid approach:
1. **Nested config object** (`DEFAULT_CONFIG`) with Zod schema validation
2. **Explicit mappings** (`configMappings` array) for env vars and CLI args
3. **Priority order**: CLI args > Env vars (explicit) > Config file > Defaults

This change extends the system to support generic env var overrides derived from config paths, while preserving explicit mappings for backwards compatibility (aliases like `PORT`, `HOST`).

## Goals / Non-Goals

**Goals:**
- Enable any config setting to be overridden via environment variable without code changes
- Provide CLI commands to inspect and modify individual config values
- Consolidate document-related scraper settings under `scraper.document.*`
- Maintain backwards compatibility for existing explicit env var mappings

**Non-Goals:**
- CLI args for every config path (too many; use `config set` instead)
- Automatic migration of old `document.maxSize` in user config files
- Validation of env var values beyond Zod schema (coercion handles type conversion)

## Decisions

### 1. Environment Variable Naming Convention

**Decision:** Auto-generate env var names using `DOCS_MCP_<PATH_UPPER_SNAKE>`

**Convention:**
- Path segments joined with `_`
- `camelCase` converted to `UPPER_SNAKE_CASE`
- Example: `scraper.document.maxSize` → `DOCS_MCP_SCRAPER_DOCUMENT_MAX_SIZE`

**Alternatives considered:**
- Flat naming (e.g., `DOCS_MCP_DOCUMENT_MAX_SIZE`) - Rejected: ambiguous for deeply nested paths
- Dot notation in env vars (e.g., `DOCS_MCP.scraper.document.maxSize`) - Rejected: not portable across shells

### 2. Precedence Order

**Decision:** Auto-generated env vars override explicit mappings when both are set

**Priority (highest to lowest):**
1. CLI args
2. Auto-generated env vars (e.g., `DOCS_MCP_SCRAPER_DOCUMENT_MAX_SIZE`)
3. Explicit env var mappings (e.g., `PORT`, `HOST` aliases)
4. Config file
5. Defaults

**Rationale:** Fully-qualified env vars are more intentional than generic aliases.

### 3. Config Path Nesting for Documents

**Decision:** Move `document.maxSize` to `scraper.document.maxSize`

**Rationale:**
- `DocumentPipeline` lives in `src/scraper/pipelines/`
- Mirrors existing `scraper.fetcher.*` pattern
- Leaves room for future document-related settings (e.g., engine, OCR)

### 4. CLI Subcommand Design

**Decision:** Use yargs subcommands under `config`

```
docs-mcp-server config                  # Print full config (existing)
docs-mcp-server config get <path>       # Get single value
docs-mcp-server config set <path> <val> # Set and persist value
```

**Value parsing for `set`:**
- Try `Number()` first
- Then boolean literals (`true`/`false`)
- Fall back to string

**Validation:** Reject paths that don't exist in schema with helpful error.

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| **Breaking change** for `document.maxSize` users | Document in changelog; setting is rarely customized |
| **Env var pollution** if many vars set | Auto-generated vars only checked if env var exists |
| **Type coercion edge cases** | Zod schema handles coercion; numbers/booleans parsed from strings |

## Migration Plan

1. **Config file migration**: Users must manually update `document:` to `scraper.document:` in their config files
2. **Changelog entry**: Document the breaking change with before/after examples
3. **No automatic migration**: Keeping it simple; old key is silently ignored

## Open Questions

None - all questions from discussion have been resolved.
