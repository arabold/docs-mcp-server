## 1. Restructure Config Schema

- [x] 1.1 Move `document` section inside `scraper` in `DEFAULT_CONFIG` (`src/utils/config.ts`)
- [x] 1.2 Update `AppConfigSchema` to nest `document` under `scraper` schema
- [x] 1.3 Update `DocumentPipeline` to read from `config.scraper.document.maxSize`
- [x] 1.4 Update `DocumentPipeline.test.ts` test config objects
- [x] 1.5 Update `test/archive-integration.test.ts` test config objects

## 2. Generic Environment Variable Support

- [x] 2.1 Add `camelToUpperSnake()` helper function
- [x] 2.2 Add `pathToEnvVar()` function to convert config paths to env var names
- [x] 2.3 Add `collectLeafPaths()` function to recursively discover all config paths
- [x] 2.4 Update `mapEnvToConfig()` to apply auto-generated env vars after explicit mappings
- [x] 2.5 Add unit tests for `pathToEnvVar()` conversion
- [x] 2.6 Add integration tests for auto-generated env var overrides

## 3. CLI Config Subcommands

- [x] 3.1 Export `getConfigValue()` helper from `src/utils/config.ts`
- [x] 3.2 Export `setConfigValue()` helper with file persistence
- [x] 3.3 Add `parseConfigValue()` helper for type coercion (string -> number/boolean)
- [x] 3.4 Add `isValidConfigPath()` helper to validate paths against schema
- [x] 3.5 Refactor `config` command to use yargs subcommands
- [x] 3.6 Implement `config get <path>` subcommand (plain for scalars, JSON for objects)
- [x] 3.7 Implement `config set <path> <value>` subcommand with path validation
- [x] 3.8 Add `--json` and `--yaml` format options for `config` and `config get`
- [x] 3.9 Add read-only mode check for `config set` (error when `--config` specified)
- [x] 3.10 Add unit tests for `config get` subcommand
- [x] 3.11 Add unit tests for `config set` subcommand

## 4. Documentation

- [x] 4.1 Update configuration docs with env var naming convention and examples
- [x] 4.2 Update configuration docs with `config get`/`set` usage
- [x] 4.3 Breaking change note: Changelog auto-generated; include `BREAKING CHANGE:` in commit message
