# Spec Delta

## ADDED Requirements

### Requirement: Docker Server Defaults

The Docker image SHALL default to an HTTP server reachable through a published container port, with the Web UI, API, and MCP endpoint enabled. Supplying options unrelated to transport or binding SHALL preserve these defaults. Runtime environment variables and CLI arguments SHALL override the Docker defaults using the existing configuration precedence. Explicit subcommands SHALL retain their behavior, and non-container startup SHALL retain protocol auto-detection and loopback binding by default.

#### Scenario: No-argument Docker startup

- **WHEN** the Docker image is started without application arguments and its default port is published
- **THEN** the container SHALL remain running and serve the Web UI, API, and MCP endpoint on port `6280`

#### Scenario: Unrelated option preserves HTTP startup

- **WHEN** the Docker image is started with only `--verbose` and its default port is published
- **THEN** it SHALL serve the same HTTP endpoints as a no-argument launch

#### Scenario: Runtime environment selects stdio

- **WHEN** a Docker launch selects `stdio` through the server protocol environment override and keeps stdin open
- **THEN** the container SHALL serve MCP over stdio instead of starting an HTTP server

#### Scenario: CLI protocol overrides the image default

- **WHEN** a Docker launch supplies `--protocol stdio` and keeps stdin open
- **THEN** the container SHALL serve MCP over stdio instead of starting an HTTP server

#### Scenario: Runtime environment changes the server binding

- **WHEN** a Docker launch sets the server host and default port through runtime environment overrides
- **THEN** the server SHALL use the configured host and port instead of the image defaults

#### Scenario: Explicit subcommand remains a CLI operation

- **WHEN** the Docker image is started with an explicit `scrape` subcommand
- **THEN** it SHALL execute that operation and exit according to the command result rather than launching the default HTTP server

#### Scenario: Non-container defaults remain unchanged

- **WHEN** the application is started outside Docker without protocol or host overrides
- **THEN** it SHALL retain TTY-based protocol auto-detection and default loopback binding
