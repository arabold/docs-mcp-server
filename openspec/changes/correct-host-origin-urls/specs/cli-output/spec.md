## ADDED Requirements

### Requirement: Display canonical startup endpoint URLs
Long-running server commands SHALL display startup endpoint URLs using the canonical origin selected for generated server URLs.

#### Scenario: Startup output reflects configured bind host
- **WHEN** the default server starts with `--host 0.0.0.0 --port 6280`
- **AND** no public origin is configured
- **THEN** the startup diagnostics MUST display the web interface URL as `http://0.0.0.0:6280`
- **AND** the startup diagnostics MUST display MCP endpoint URLs under `http://0.0.0.0:6280`
- **AND** the startup diagnostics MUST NOT display `http://127.0.0.1:6280` or `http://localhost:6280`

#### Scenario: Startup output prefers public origin
- **WHEN** the server starts with `--host 0.0.0.0`
- **AND** `server.publicOrigin` is configured as `https://docs.example.com`
- **THEN** the startup diagnostics MUST display web and MCP endpoint URLs under `https://docs.example.com`

#### Scenario: Startup output remains logger-controlled
- **WHEN** startup endpoint URLs are emitted
- **THEN** they MUST be emitted through the shared logger
- **AND** existing quiet and verbose logging controls MUST continue to apply
