# Change: Refactor Configuration System

## Why

The current configuration system has several limitations:
1. The `document.maxSize` setting is a top-level orphan section with only one setting, but semantically belongs under `scraper` since it's exclusively used by `DocumentPipeline`.
2. Environment variable overrides require explicit mappings in `configMappings` for each setting, making it tedious to add new config options.
3. The CLI `config` command only prints the entire config; users cannot get or set individual values.

## What Changes

- **BREAKING**: Move `document.maxSize` to `scraper.document.maxSize`
- Add generic environment variable support: any config path can be overridden via `DOCS_MCP_<PATH_IN_UPPER_SNAKE_CASE>` (e.g., `DOCS_MCP_SCRAPER_DOCUMENT_MAX_SIZE`)
- Add `config get <path>` CLI subcommand to retrieve individual config values
- Add `config set <path> <value>` CLI subcommand to persist config changes to file
- Existing `config` command (no subcommand) continues to print the full config

## Impact

- Affected specs: New `configuration` capability
- Affected code:
  - `src/utils/config.ts` - restructure defaults, schema, add generic env var mapping
  - `src/cli/commands/config.ts` - add `get`/`set` subcommands
  - `src/scraper/pipelines/DocumentPipeline.ts` - update config access path
  - Test files for above
- User config files: Existing `document.maxSize` will be silently ignored (breaking change)
