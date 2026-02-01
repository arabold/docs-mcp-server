## MODIFIED Requirements
### Requirement: Documentation Guides
The system MUST provide comprehensive user documentation for configuration and client integration.

#### Scenario: Cursor Configuration
- **WHEN** a user configures Cursor
- **THEN** the documentation SHOULD recommend `streamableHttp` as the transport type

#### Scenario: Consistent Naming
- **WHEN** a user copies configuration snippets
- **THEN** the server name key SHOULD consistently be `docs-mcp-server`
