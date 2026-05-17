## ADDED Requirements

### Requirement: Skip-Known-Trackers Flag Under Scraper

The system SHALL expose a `scraper.skipKnownTrackers` boolean in the typed configuration schema, defaulting to `true`, that governs whether the built-in sub-resource blocklist is consulted during Playwright-driven page rendering. The flag SHALL participate in the standard configuration override chain (config file < environment variables < CLI arguments) and SHALL be persisted through the normal `loadConfig` auto-save path so that existing on-disk config files gain the new key with its default value on first start after upgrade.

#### Scenario: Default value when not configured
- **GIVEN** no configuration file or environment override sets `scraper.skipKnownTrackers`
- **WHEN** the application loads its configuration
- **THEN** the resolved value of `scraper.skipKnownTrackers` is `true`

#### Scenario: Configuration file override
- **GIVEN** a configuration file with `scraper.skipKnownTrackers` set to `false`
- **WHEN** the application loads its configuration
- **THEN** the resolved value of `scraper.skipKnownTrackers` is `false`

#### Scenario: Environment variable override
- **GIVEN** the environment variable `DOCS_MCP_SCRAPER_SKIP_KNOWN_TRACKERS` is set to `false`
- **WHEN** the application loads its configuration
- **THEN** the resolved value of `scraper.skipKnownTrackers` is `false`
- **AND** the environment value takes precedence over a conflicting file value

#### Scenario: Upgrade path supplies the new key
- **GIVEN** an existing on-disk configuration file written by a prior release that lacks `scraper.skipKnownTrackers`
- **WHEN** the application starts and `loadConfig` runs
- **THEN** the resolved configuration contains `scraper.skipKnownTrackers: true`
- **AND** previously set keys in that file retain their values
