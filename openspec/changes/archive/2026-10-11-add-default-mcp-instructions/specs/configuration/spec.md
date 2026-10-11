## ADDED Requirements

### Requirement: Default Server Instructions
When neither `server.instructions` nor `server.instructionsFile` is configured, the MCP server SHALL send built-in instructions as `instructions` in the `initialize` result. The built-in instructions SHALL tell the model to search the indexed documentation before answering from memory, and how to find the libraries and versions that are indexed. They SHALL name only tools that the server offers in its current mode. Configured instructions SHALL replace the built-in instructions entirely. The built-in instructions SHALL NOT be a configuration value.

#### Scenario: Built-in instructions when none are configured
- **WHEN** neither `server.instructions` nor `server.instructionsFile` is configured
- **THEN** the MCP `initialize` result MUST include the built-in instructions as `instructions`

#### Scenario: Indexing guidance when indexing is available
- **WHEN** the server is not in read-only mode and no instructions are configured
- **THEN** the built-in instructions MUST explain how to index a library that is not yet indexed and how to follow the progress of that indexing job

#### Scenario: Read-only mode
- **WHEN** the server runs in read-only mode and no instructions are configured
- **THEN** the built-in instructions MUST state that this server cannot index new documentation

#### Scenario: Only offered tools are named
- **WHEN** the built-in instructions name a tool
- **THEN** that tool MUST appear in the server's tool list in the same mode

#### Scenario: Configured instructions replace the built-in instructions
- **WHEN** `server.instructions` or `server.instructionsFile` is configured
- **THEN** the MCP `initialize` result MUST contain only the configured text as `instructions`, without any of the built-in text

#### Scenario: Built-in instructions stay out of the configuration
- **WHEN** no instructions are configured
- **THEN** the loaded configuration MUST leave `server.instructions` unset
- **AND** the automatically updated default configuration file MUST NOT contain the built-in instructions
