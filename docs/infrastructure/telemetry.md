# Telemetry Architecture

The MCP Documentation Server implements privacy-first telemetry to understand usage patterns, monitor performance, and improve user experience. The system is designed with user privacy as the primary concern while providing valuable insights for product development.

## Core Principles

### Privacy First

- **No Sensitive Data**: Never collects URLs, document content, search queries, or authentication tokens
- **Metadata Only**: Tracks counts, durations, success/failure states, and performance metrics
- **Data Sanitization**: Built-in utilities ensure no personally identifiable information is collected
- **User Control**: Simple opt-out mechanisms via CLI flags and environment variables

### Minimal Performance Impact

- **Synchronous Design**: Simple, lightweight telemetry with minimal overhead
- **Graceful Degradation**: System continues functioning normally when telemetry fails
- **No Dependencies**: Core application never depends on telemetry functionality
- **Installation ID Only**: Uses persistent UUID for consistent analytics without user tracking

### Simple Architecture

- **Direct Analytics**: Direct PostHog integration with installation ID as distinct user
- **Global Context**: Application-level properties automatically included in all events
- **Easy Integration**: Simple analytics interface for application components

## System Architecture

### Core Components

The telemetry system consists of three main components:

**Analytics Layer** (`src/telemetry/analytics.ts`)

- PostHog integration with privacy-optimized configuration
- Event tracking with automatic global context inclusion
- Installation ID as the distinct user identifier
- Simple, focused API without unnecessary complexity

**PostHog Client** (`src/telemetry/postHogClient.ts`)

- Automatic camelCase to snake_case property conversion for PostHog compatibility
- Privacy-optimized PostHog configuration
- Error tracking with native PostHog exception capture

**Configuration Management** (`src/telemetry/TelemetryConfig.ts`)

- Installation ID generation and persistence using UUID
- Telemetry enable/disable controls via environment variables and CLI flags
- Configuration validation and fallback handling

**Service Layer** (`src/telemetry/TelemetryService.ts`)

- Simple service factory providing session management
- Unified interface for application components
- Handles configuration and analytics integration

**Data Sanitization** (`src/telemetry/sanitizer.ts`)

- Essential privacy protection functions:
  - Domain extraction without exposing paths
  - Protocol detection for file and web URLs
  - Error message sanitization removing sensitive information
  - Search query analysis without storing content
  - CLI flag extraction for usage patterns
- User agent categorization for browser analytics
- Content size categorization for processing insights

### Session Management (Future Feature)

> **Note**: Session management has been removed from the current implementation to simplify the telemetry system. The current system uses global context and event-specific properties for meaningful analytics without the complexity of session tracking.

**Future Session Concepts** (Not Currently Implemented):

Session tracking could be added in the future to provide:

- User journey mapping across tool usage
- Connection duration tracking for MCP clients
- CLI command workflow analysis
- Per-session error correlation

**Current Approach**: Instead of sessions, the system uses:

- **Installation ID**: Consistent user identification across application runs
- **Global Context**: Application-level properties (version, platform, configuration)
- **Event Properties**: Specific context per event (tool name, duration, success/failure)
- **Correlation IDs**: For related events (e.g., pipeline job tracking)

This provides 90% of the analytical value with 10% of the complexity.

### Installation ID System

The system uses a persistent installation identifier for consistent analytics:

**Installation ID Generation** (`src/telemetry/TelemetryConfig.ts`)

- Creates UUID-based installation identifier stored in `installation.id`
- Uses `envPaths` standard for cross-platform directory location (`~/.local/share/docs-mcp-server/`)
- Supports `DOCS_MCP_STORE_PATH` environment variable override for Docker deployments
- Provides consistent identification across application runs without user tracking
- Falls back to new UUID generation if file is corrupted or missing

## Integration Points

### Application Server Integration

The AppServer tracks application lifecycle events with global context:

**Application Lifecycle Tracking**

- Application startup/shutdown events with service configuration
- Service availability and enabled features
- Application-level error tracking and performance metrics

**Integration Pattern**

- AppServer emits application lifecycle events
- Individual services create user interaction sessions when appropriate
- Background services (worker, API) emit events within application context
- No competing session creation between services

### Service-Level Integration

Services integrate telemetry through direct analytics usage:

**Worker Service** (`src/services/workerService.ts`)

- Pipeline job progress and completion events with global context
- Performance metrics for background processing
- Direct event tracking without session complexity

**MCP Service** (`src/services/mcpService.ts`)

- Simple connection logging for client tracking
- No session management - just basic connection events

**Web Service** (`src/services/webService.ts`)

- Direct event tracking for web interface usage
- No session management needed

## Data Collection Patterns

### Event Types

The system tracks essential event types for usage understanding:

- `app_started` / `app_shutdown`: Application lifecycle tracking
- `cli_command`: CLI command execution and outcomes
- `tool_used`: Individual tool execution and outcomes
- `pipeline_job_started`: Pipeline job initiation
- `pipeline_job_completed`: Pipeline job successful completion
- `pipeline_job_failed`: Pipeline job failures
- **Error Tracking**: PostHog's native exception tracking with full stack traces and context

### Global Context

All events automatically include global application context:

- Application version and platform information
- Installation ID for consistent user identification
- AI/embedding configuration
- Service configuration and enabled features
- Automatic timestamp inclusion

Property names follow PostHog's snake_case convention through automatic conversion from internal camelCase names.

## Telemetry Properties Reference

The following table details all telemetry properties, their usage patterns, and tracking scope:

| Property                               | Type     | Scope  | Events                 | Description                                             |
| -------------------------------------- | -------- | ------ | ---------------------- | ------------------------------------------------------- |
| **Global Context (Application-level)** |          |        |                        |                                                         |
| `appVersion`                           | string   | Global | All events             | Application version from package.json                   |
| `appPlatform`                          | string   | Global | All events             | Node.js platform (darwin, linux, win32)                 |
| `appNodeVersion`                       | string   | Global | All events             | Node.js version                                         |
| `appServicesEnabled`                   | string[] | Global | All events             | List of enabled services                                |
| `appAuthEnabled`                       | boolean  | Global | All events             | Whether authentication is configured                    |
| `appReadOnly`                          | boolean  | Global | All events             | Whether app is in read-only mode                        |
| `aiEmbeddingProvider`                  | string   | Global | All events             | Provider: "openai", "google", "aws", "microsoft"        |
| `aiEmbeddingModel`                     | string   | Global | All events             | Model name: "text-embedding-3-small", etc.              |
| `aiEmbeddingDimensions`                | number   | Global | All events             | Embedding dimensions used                               |
| **Event Context**                      |          |        |                        |                                                         |
| `timestamp`                            | ISO8601  | Event  | All events             | Event timestamp (automatically added)                   |
| **Application Configuration**          |          |        |                        |                                                         |
| `services`                             | string[] | Event  | APP_STARTED            | List of enabled services                                |
| `port`                                 | number   | Event  | APP_STARTED            | Server port number                                      |
| `externalWorker`                       | boolean  | Event  | APP_STARTED            | Whether external worker is configured                   |
| `cliCommand`                           | string   | Event  | APP_STARTED            | CLI command name (when started via CLI)                 |
| `mcpProtocol`                          | enum     | Event  | APP_STARTED            | MCP protocol: "stdio" or "http" (when MCP enabled)      |
| `mcpTransport`                         | enum     | Event  | APP_STARTED            | MCP transport: "sse" or "streamable" (when MCP enabled) |
| **Application Lifecycle**              |          |        |                        |                                                         |
| `graceful`                             | boolean  | Event  | APP_SHUTDOWN           | Whether shutdown was graceful                           |
| **CLI Commands**                       |          |        |                        |                                                         |
| `cliCommand`                           | string   | Event  | CLI_COMMAND            | CLI command name being executed                         |
| `success`                              | boolean  | Event  | CLI_COMMAND            | Whether command execution succeeded                     |
| `durationMs`                           | number   | Event  | CLI_COMMAND            | Command execution duration                              |
| **Tool Usage**                         |          |        |                        |                                                         |
| `tool`                                 | string   | Event  | TOOL_USED              | Tool name being executed                                |
| `success`                              | boolean  | Event  | TOOL_USED              | Whether tool execution succeeded                        |
| `durationMs`                           | number   | Event  | TOOL_USED              | Tool execution duration                                 |
| **Pipeline Jobs**                      |          |        |                        |                                                         |
| `jobId`                                | string   | Event  | PIPELINE*JOB*\*        | Anonymous job identifier for correlation                |
| `library`                              | string   | Event  | PIPELINE*JOB*\*        | Library being processed                                 |
| `hasVersion`                           | boolean  | Event  | PIPELINE*JOB*\*        | Whether library version was specified                   |
| `maxPagesConfigured`                   | number   | Event  | PIPELINE*JOB*\*        | Maximum pages configured                                |
| `queueWaitTimeMs`                      | number   | Event  | PIPELINE_JOB_STARTED   | Time job waited in queue before starting                |
| `durationMs`                           | number   | Event  | PIPELINE_JOB_COMPLETED | Job execution duration                                  |
| `durationMs`                           | number   | Event  | PIPELINE_JOB_FAILED    | Job execution duration before failure                   |
| `pagesProcessed`                       | number   | Event  | PIPELINE_JOB_COMPLETED | Total pages successfully processed                      |
| `pagesProcessed`                       | number   | Event  | PIPELINE_JOB_FAILED    | Pages processed before failure                          |
| `throughputPagesPerSecond`             | number   | Event  | PIPELINE_JOB_COMPLETED | Processing throughput                                   |
| `hasError`                             | boolean  | Event  | PIPELINE_JOB_FAILED    | Whether job had errors (always true)                    |
| `errorMessage`                         | string   | Event  | PIPELINE_JOB_FAILED    | Sanitized error message                                 |

### Property Scope Definitions

- **Global**: Properties set once at application startup and included in all events automatically
- **Session**: Properties tied to a user interaction session, managed by SessionTracker
- **Event**: Properties specific to individual events, passed explicitly when tracking

### Tracking Pattern Summary

**Global Context (automatic inclusion):**

- Application metadata: `appVersion`, `appPlatform`, `appAuthEnabled`, `appReadOnly`
- AI/Embedding configuration: `aiEmbeddingProvider`, `aiEmbeddingModel`, `aiEmbeddingDimensions`

**Application Configuration (APP_STARTED event):**

- Service configuration: `services`, `port`, `externalWorker`
- MCP configuration: `mcpProtocol`, `mcpTransport` (when MCP service enabled)
- CLI context: `cliCommand` (when started via CLI)

**Event-specific Properties:**

- Passed explicitly when tracking specific events
- Include performance metrics, outcomes, and event-specific context
- `jobId` used for correlating related pipeline events across the pipeline lifecycle

This approach minimizes event payload size while ensuring all relevant context is available for analysis and debugging.

### Privacy-Safe Data Collection

The system ensures privacy through essential data sanitization:

**URL and Path Sanitization**

- Hostname extraction without paths or parameters (`extractHostname`)
- Protocol identification for file and web URLs (`extractProtocol`)
- Error message sanitization removing sensitive paths and tokens (`sanitizeErrorMessage`)

**Error Information**

- **Native Error Tracking**: PostHog's exception capture with full stack traces and automatic grouping
- Error sanitization functions available for sensitive contexts (`sanitizeError`, `sanitizeErrorMessage`)
- Component identification and contextual information
- Enhanced debugging capabilities with source code integration

**Usage Patterns**

- CLI flag extraction without values (`extractCliFlags`)
- Search query analysis without storing content (`analyzeSearchQuery`)
- Basic performance metrics without sensitive data

## Configuration and Control

### User Control Mechanisms

**CLI Flags**

- `--no-telemetry`: Disable all telemetry for current session

**Environment Variables**

- `DOCS_MCP_TELEMETRY=false`: Global disable telemetry collection
- `DOCS_MCP_STORE_PATH=/custom/path`: Override installation ID storage location (useful for Docker volumes)

**Configuration Integration**

- Simple enable/disable configuration
- Graceful fallback when disabled
- No impact on core functionality when opted out

**Runtime Behavior**

- Telemetry failures never affect application functionality
- Simple fallback to no-op behavior when disabled
- Installation ID persisted locally in standard user data directory

### Development and Testing

**Development Mode**

- Environment-based configuration for development vs production
- Enhanced logging for telemetry debugging when needed

**Testing**

- Comprehensive test coverage for all telemetry functions
- Privacy validation in data sanitization tests
- Behavior-focused testing without timing dependencies

## Analytics and Insights

### Usage Analytics

The simplified telemetry system provides essential insights:

- Tool usage patterns across different interfaces
- Session frequency and basic engagement metrics
- Error patterns and system reliability
- Feature adoption trends

### Performance Monitoring

Key performance insights include:

- Error rates and common failure patterns
- Basic processing performance metrics
- System stability and reliability trends

### Product Intelligence

Strategic insights for product development:

- Interface preference trends (CLI vs MCP vs Web)
- Tool popularity and usage patterns
- Error categorization for improvement priorities

## Privacy Compliance

### Data Minimization

The system implements strict data minimization:

- Only essential data collection for core insights
- Installation ID as the only persistent identifier
- No user tracking or cross-session correlation beyond installation
- Minimal data retention with focus on current patterns

### Transparency

Users have clear control and visibility:

- Simple opt-out mechanisms
- Clear documentation of collected data types
- No hidden or complex data collection
- Installation ID stored locally and under user control

### Security

Telemetry data protection:

- Encrypted transmission to analytics service
- No sensitive local storage beyond installation ID
- Simple UUID-based identification system
- Essential data sanitization to prevent information leakage

The simplified telemetry architecture provides essential insights while maintaining user privacy and system simplicity, enabling focused product development without complex tracking systems.
