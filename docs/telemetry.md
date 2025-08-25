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
- **Focused Data Collection**: Essential functions only, no over-engineering
- **Easy Integration**: Simple service interface for application components

## System Architecture

### Core Components

The telemetry system consists of four main components:

**Analytics Layer** (`src/telemetry/analytics.ts`)

- PostHog integration with privacy-optimized configuration
- Event tracking with automatic session context inclusion
- Installation ID as the distinct user identifier
- Session lifecycle management for different interface types

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

### Session Management

The telemetry system distinguishes between **application lifecycle tracking** and **user interaction sessions**:

**Session Types**

- **CLI Sessions**: One session per command execution (user interaction)
- **MCP Sessions**: One session per SSE connection (AI client interaction)
- **Web Sessions**: One session per browser session (when implemented)
- **Application Lifecycle**: Application instance tracking (not user sessions)

**Session Factory Functions** (`src/telemetry/sessions.ts`)

- `createCliSession()`: Command-line interface usage
- `createMcpSession()`: MCP protocol sessions
- `createWebSession()`: Web interface sessions (browser-based)
- `createPipelineSession()`: Background processing context (not user sessions)

**Architecture Principles**

- **Application Instance**: AppServer tracks application lifecycle, not user sessions
- **Background Services**: Worker and API services emit events within application context
- **User Interfaces**: CLI, MCP, and Web create interaction sessions
- **No Competing Sessions**: Only one session type active per interface

**Session Context**

Properties use consistent naming conventions with domain-specific prefixes:

- `app*` properties: Application-level context (appVersion, appPlatform, appNodeVersion, appServicesEnabled) - **Global Context**
- `session*` properties: Session identification (sessionId) - **Session Context**
- `ai*` properties: AI/embedding model context (aiEmbeddingProvider, aiEmbeddingModel) - **Global Context**
- Interface-specific properties: Sent with APP_STARTED when relevant (cliCommand, mcpProtocol)
- Navigation context: Session-specific when applicable (webRoute for web sessions)

### Installation ID System

The system uses a persistent installation identifier for consistent analytics:

**Installation ID Generation** (`src/telemetry/config.ts`)

- Creates UUID-based installation identifier stored in `installation.id`
- Uses `envPaths` standard for cross-platform directory location (`~/.local/share/docs-mcp-server/`)
- Supports `DOCS_MCP_STORE_PATH` environment variable override for Docker deployments
- Provides consistent identification across sessions without user tracking
- Falls back to new UUID generation if file is corrupted or missing

## Integration Points

### Application Server Integration

The AppServer tracks application lifecycle events rather than user sessions:

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

Services integrate telemetry through the simplified service interface:

**Worker Service** (`src/services/workerService.ts`)

- Pipeline job progress and completion events within application context
- Performance metrics for background processing
- No user sessions - events emitted within application lifecycle

**MCP Service** (`src/services/mcpService.ts`)

- Protocol session lifecycle tracking per SSE connection
- User interaction sessions for AI client connections

**Web Service** (`src/services/webService.ts`)

- Browser-based session tracking (when implemented)
- No per-request sessions to avoid excessive session creation

## Data Collection Patterns

### Event Types

The system tracks essential event types for usage understanding:

- `session_started` / `session_ended`: Session lifecycle tracking
- `tool_used`: Individual tool execution and outcomes
- `job_completed` / `job_failed`: Background processing results
- **Error Tracking**: PostHog's native exception tracking with full stack traces and context

### Session Context

All events automatically include basic session context:

- Interface type (CLI, MCP, Web, Pipeline)
- Application version and platform information
- Session ID and installation ID
- Basic timing information

Property names follow PostHog's snake_case convention through automatic conversion from internal camelCase names.

## Telemetry Properties Reference

The following table details all telemetry properties, their usage patterns, and tracking scope:

| Property                               | Type     | Scope   | Events                 | Description                                             |
| -------------------------------------- | -------- | ------- | ---------------------- | ------------------------------------------------------- |
| **Global Context (Application-level)** |          |         |                        |                                                         |
| `appVersion`                           | string   | Global  | All events             | Application version from package.json                   |
| `appPlatform`                          | string   | Global  | All events             | Node.js platform (darwin, linux, win32)                 |
| `appNodeVersion`                       | string   | Global  | All events             | Node.js version                                         |
| `appServicesEnabled`                   | string[] | Global  | All events             | List of enabled services                                |
| `appAuthEnabled`                       | boolean  | Global  | All events             | Whether authentication is configured                    |
| `appReadOnly`                          | boolean  | Global  | All events             | Whether app is in read-only mode                        |
| `aiEmbeddingProvider`                  | string   | Global  | All events             | Provider: "openai", "google", "aws", "microsoft"        |
| `aiEmbeddingModel`                     | string   | Global  | All events             | Model name: "text-embedding-3-small", etc.              |
| `aiEmbeddingDimensions`                | number   | Global  | All events             | Embedding dimensions used                               |
| **Session Context (User Interaction)** |          |         |                        |                                                         |
| `sessionId`                            | UUID     | Session | All events             | Unique session identifier for correlation               |
| `appInterface`                         | enum     | Session | SESSION_STARTED/ENDED  | Interface type: "cli", "mcp", "web", "pipeline"         |
| `timestamp`                            | ISO8601  | Event   | All events             | Event timestamp                                         |
| **Application Configuration**          |          |         |                        |                                                         |
| `services`                             | string[] | Event   | APP_STARTED            | List of enabled services                                |
| `port`                                 | number   | Event   | APP_STARTED            | Server port number                                      |
| `externalWorker`                       | boolean  | Event   | APP_STARTED            | Whether external worker is configured                   |
| `cliCommand`                           | string   | Event   | APP_STARTED            | CLI command name (when started via CLI)                 |
| `mcpProtocol`                          | enum     | Event   | APP_STARTED            | MCP protocol: "stdio" or "http" (when MCP enabled)      |
| `mcpTransport`                         | enum     | Event   | APP_STARTED            | MCP transport: "sse" or "streamable" (when MCP enabled) |
| `startupSuccess`                       | boolean  | Event   | APP_STARTED            | Whether startup succeeded                               |
| `startupDurationMs`                    | number   | Event   | APP_STARTED            | Startup duration                                        |
| `listenAddress`                        | string   | Event   | APP_STARTED            | Server listen address                                   |
| `activeServices`                       | string[] | Event   | APP_STARTED            | Active services list                                    |
| `errorType`                            | string   | Event   | APP_STARTED            | Error type (failures only)                              |
| `errorMessage`                         | string   | Event   | APP_STARTED            | Error message (failures only)                           |
| **Session-specific Context**           |          |         |                        |                                                         |
| `webRoute`                             | string   | Session | SESSION_STARTED        | Current web route (for web sessions)                    |
| **Application Lifecycle**              |          |         |                        |                                                         |
| `graceful`                             | boolean  | Event   | APP_SHUTDOWN           | Whether shutdown was graceful                           |
| `durationMs`                           | number   | Event   | SESSION_ENDED          | Session duration                                        |
| **Tool Usage**                         |          |         |                        |                                                         |
| `tool`                                 | string   | Event   | TOOL_USED              | Tool name being executed                                |
| `success`                              | boolean  | Event   | TOOL_USED              | Whether tool execution succeeded                        |
| `durationMs`                           | number   | Event   | TOOL_USED              | Tool execution duration                                 |
| **Pipeline Jobs**                      |          |         |                        |                                                         |
| `jobId`                                | string   | Event   | PIPELINE*JOB*\*        | Anonymous job identifier for correlation                |
| `library`                              | string   | Event   | PIPELINE*JOB*\*        | Library being processed                                 |
| `status`                               | string   | Event   | PIPELINE_JOB_COMPLETED | Job final status                                        |
| `durationMs`                           | number   | Event   | PIPELINE_JOB_COMPLETED | Job execution duration                                  |
| `queueWaitTimeMs`                      | number   | Event   | PIPELINE_JOB_COMPLETED | Time job waited in queue                                |
| `pagesProcessed`                       | number   | Event   | PIPELINE_JOB_COMPLETED | Total pages processed                                   |
| `maxPagesConfigured`                   | number   | Event   | PIPELINE_JOB_COMPLETED | Maximum pages configured                                |
| `hasVersion`                           | boolean  | Event   | PIPELINE_JOB_COMPLETED | Whether library version was specified                   |
| `hasError`                             | boolean  | Event   | PIPELINE_JOB_COMPLETED | Whether job had errors                                  |
| `throughputPagesPerSecond`             | number   | Event   | PIPELINE_JOB_COMPLETED | Processing throughput                                   |
| `pagesScraped`                         | number   | Event   | PIPELINE_JOB_PROGRESS  | Number of pages processed so far                        |
| `totalPages`                           | number   | Event   | PIPELINE_JOB_PROGRESS  | Total pages to process                                  |
| `totalDiscovered`                      | number   | Event   | PIPELINE_JOB_PROGRESS  | Total pages discovered                                  |
| `progressPercent`                      | number   | Event   | PIPELINE_JOB_PROGRESS  | Completion percentage                                   |
| `currentDepth`                         | number   | Event   | PIPELINE_JOB_PROGRESS  | Current crawling depth                                  |
| `maxDepth`                             | number   | Event   | PIPELINE_JOB_PROGRESS  | Maximum crawling depth                                  |
| `discoveryRatio`                       | number   | Event   | PIPELINE_JOB_PROGRESS  | Discovery vs processing ratio                           |
| `queueEfficiency`                      | number   | Event   | PIPELINE_JOB_PROGRESS  | Queue processing efficiency                             |
| **Document Processing**                |          |         |                        |                                                         |
| `mimeType`                             | string   | Event   | DOCUMENT_PROCESSED     | Document MIME type                                      |
| `contentSizeBytes`                     | number   | Event   | DOCUMENT_PROCESSED     | Document content size                                   |
| `processingTimeMs`                     | number   | Event   | DOCUMENT_PROCESSED     | Processing duration                                     |
| `chunksCreated`                        | number   | Event   | DOCUMENT_PROCESSED     | Number of chunks created                                |
| `hasTitle`                             | boolean  | Event   | DOCUMENT_PROCESSED     | Whether document has title                              |
| `hasDescription`                       | boolean  | Event   | DOCUMENT_PROCESSED     | Whether document has description                        |
| `urlDomain`                            | string   | Event   | DOCUMENT_PROCESSED     | Sanitized domain (privacy-safe)                         |
| `depth`                                | number   | Event   | DOCUMENT_PROCESSED     | Crawl depth of document                                 |
| `library`                              | string   | Event   | DOCUMENT_PROCESSED     | Library being processed                                 |
| `libraryVersion`                       | string   | Event   | DOCUMENT_PROCESSED     | Library version                                         |
| `avgChunkSizeBytes`                    | number   | Event   | DOCUMENT_PROCESSED     | Average chunk size                                      |
| `processingSpeedKbPerSec`              | number   | Event   | DOCUMENT_PROCESSED     | Processing speed                                        |
| **HTTP Request Processing**            |          |         |                        |                                                         |
| `success`                              | boolean  | Event   | HTTP_REQUEST_COMPLETED | Whether request succeeded                               |
| `hostname`                             | string   | Event   | HTTP_REQUEST_COMPLETED | Sanitized hostname (privacy-safe)                       |
| `protocol`                             | string   | Event   | HTTP_REQUEST_COMPLETED | URL protocol (http/https/file)                          |
| `durationMs`                           | number   | Event   | HTTP_REQUEST_COMPLETED | Request duration                                        |
| `contentSizeBytes`                     | number   | Event   | HTTP_REQUEST_COMPLETED | Response content size                                   |
| `mimeType`                             | string   | Event   | HTTP_REQUEST_COMPLETED | Response MIME type                                      |
| `hasEncoding`                          | boolean  | Event   | HTTP_REQUEST_COMPLETED | Whether response had encoding                           |
| `followRedirects`                      | boolean  | Event   | HTTP_REQUEST_COMPLETED | Whether redirects were followed                         |
| `hadRedirects`                         | boolean  | Event   | HTTP_REQUEST_COMPLETED | Whether redirects occurred                              |
| `statusCode`                           | number   | Event   | HTTP_REQUEST_COMPLETED | HTTP status code (failures only)                        |
| `errorType`                            | string   | Event   | HTTP_REQUEST_COMPLETED | Error type (failures only)                              |
| `errorCode`                            | string   | Event   | HTTP_REQUEST_COMPLETED | Error code (failures only)                              |

### Property Scope Definitions

- **Global**: Properties set once at application startup and included in all events automatically
- **Session**: Properties tied to a user interaction session, managed by SessionTracker
- **Event**: Properties specific to individual events, passed explicitly when tracking

### Tracking Pattern Summary

**Global Context (automatic inclusion):**

- Application metadata: `appVersion`, `appPlatform`, `appAuthEnabled`, `appReadOnly`
- AI/Embedding configuration: `aiEmbeddingProvider`, `aiEmbeddingModel`, `aiEmbeddingDimensions`

**Session Context (minimal):**

- Session correlation: `sessionId` (all events)
- Interface identification: `appInterface` (session lifecycle events only)
- Web navigation: `webRoute` (SESSION_STARTED for web sessions)

**Application Configuration (APP_STARTED event):**

- Service configuration: `services`, `port`, `externalWorker`
- MCP configuration: `mcpProtocol`, `mcpTransport` (when MCP service enabled)
- CLI context: `cliCommand` (when started via CLI)

**Event-specific Properties:**

- Passed explicitly when tracking specific events
- Include performance metrics, outcomes, and event-specific context
- `jobId` used for correlating related pipeline events

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
