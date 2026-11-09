# Spec Delta

## MODIFIED Requirements

### Requirement: Environment Variable Precedence

The system SHALL resolve every configuration setting from these layers, highest priority first: an option passed on the command line, then environment variables, then the configuration file, then the built-in default. A command-line option the user did not pass SHALL NOT count as a command-line value: it SHALL leave the setting to the lower layers. This SHALL hold for every setting that a command-line option maps to, on every command that exposes the option.

#### Scenario: Auto-Generated Env Var Takes Precedence Over Explicit Alias

- **GIVEN** both `PORT=3000` and `DOCS_MCP_SERVER_PORTS_DEFAULT=4000` are set
- **WHEN** the configuration is loaded
- **THEN** `server.ports.default` SHALL be `4000` (auto-generated wins)

#### Scenario: CLI Args Override Environment Variables

- **GIVEN** `DOCS_MCP_APP_STORE_PATH=/env/path` is set
- **AND** `--storePath=/cli/path` is passed
- **WHEN** the configuration is loaded
- **THEN** `app.storePath` SHALL be `/cli/path`

#### Scenario: Omitted flag leaves the environment value in effect

- **GIVEN** `DOCS_MCP_AUTH_ENABLED=true` is set
- **WHEN** the `mcp` command starts without `--auth-enabled`
- **THEN** `auth.enabled` SHALL be `true`

#### Scenario: Omitted flag leaves the config file value in effect

- **GIVEN** the configuration file sets `app.readOnly` to `true`
- **AND** no environment variable sets it
- **WHEN** the `server` command starts without `--read-only`
- **THEN** `app.readOnly` SHALL be `true`

#### Scenario: Transport protocol comes from configuration when the flag is omitted

- **GIVEN** `DOCS_MCP_PROTOCOL=http` is set
- **AND** the process runs without a terminal attached
- **WHEN** the `mcp` command starts without `--protocol`
- **THEN** the server SHALL serve MCP over HTTP rather than stdio

#### Scenario: Explicitly passed negation overrides the environment

- **GIVEN** `DOCS_MCP_READ_ONLY=true` is set
- **WHEN** the `server` command starts with `--no-read-only`
- **THEN** `app.readOnly` SHALL be `false`

#### Scenario: Built-in defaults apply when no layer sets a value

- **GIVEN** no command-line option, environment variable, or configuration file entry sets `auth.enabled`, `app.readOnly`, or `server.protocol`
- **WHEN** the `server` command starts
- **THEN** `auth.enabled` SHALL be `false`, `app.readOnly` SHALL be `false`, and `server.protocol` SHALL be `auto`
