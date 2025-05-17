# Documentation MCP Server Architecture

## Overview

The Documentation MCP Server is designed with a modular architecture that ensures feature separation and code reuse between its two main interfaces:

1. Command Line Interface (CLI)
2. Model Context Protocol (MCP) Server

### Core File Naming and Code Quality Conventions

- Files containing classes use PascalCase (e.g., `PipelineManager.ts`, `PipelineWorker.ts`, `DocumentManagementService.ts`)
- Other files use kebab-case or regular camelCase (e.g., `index.ts`, `scraper-service.ts`)
- Avoid typecasting where possible. Never use `any` type but prefer `unknown` or `never`.

## Configuration Management

Default configuration values for the server and its components (e.g., pipeline concurrency, scraping limits) should be defined as constants within the `src/utils/config.ts` file. Avoid hardcoding default values directly within component logic; instead, import and use the constants from this central configuration file. This ensures consistency and simplifies future adjustments.

### Directory Structure

```
src/
├── index.ts                         # Unified CLI, MCP Server, and Web entry point
├── mcp/                             # MCP server implementation details
├── pipeline/                        # Asynchronous job processing pipeline
│   ├── PipelineManager.ts           # Manages job queue, concurrency, state
│   └── PipelineWorker.ts            # Executes a single pipeline job
├── scraper/                         # Web scraping implementation
│   ├── strategies/                  # Scraping strategies for different sources
│   │   ├── WebScraperStrategy.ts    # Handles HTTP/HTTPS content
│   │   └── LocalFileStrategy.ts     # Handles local filesystem content
│   │   └── ...
│   ├── fetcher/                     # Content fetching abstractions
│   ├── middleware/                  # Individual middleware implementations
│   ├── pipelines/                   # HTML and markdown pipelines
│   └── ...
├── splitter/                        # Document splitting and chunking
├── store/                           # Document storage and retrieval
│   ├── DocumentManagementService.ts # Manages document storage and updates
│   ├── DocumentRetrieverService.ts  # Handles document retrieval and context
│   ├── DocumentStore.ts             # Low-level database interactions
│   └── ...
├── tools/                           # Core functionality tools
├── types/                           # Shared type definitions
└── utils/                           # Common utilities and helpers
    ├── config.ts                    # Configuration constants
    ├── logger.ts                    # Centralized logging system
    ├── mimeTypeUtils.ts             # MIME type handling utilities
    └── ...
```

## Scraper Architecture

The scraping system uses a strategy pattern combined with content abstractions to handle different documentation sources uniformly:

### Content Sources

- Web-based content (HTTP/HTTPS)
- Local filesystem content (file://)
- Package registry content (e.g., npm, PyPI)

Each source type has a dedicated strategy that understands its specific protocol and structure, while sharing common processing logic.

### Content Processing Flow

Raw content fetched by a strategy's `fetcher` (e.g., HTML, Markdown) is processed through specialized pipelines based on content type. Each pipeline internally uses appropriate middleware components. See the Middleware Pipeline section below for details.

```mermaid
graph TD
    F[Fetcher fetches RawContent] --> RC[RawContent]
    RC --> HP[HtmlPipeline]
    RC --> MP[MarkdownPipeline]
    RC --> OP[OtherPipeline]
    HP --> PCP[ProcessedContent]
    MP --> PCP
    OP --> PCP
    PCP --> S[Strategy]
```

- **`RawContent`**: Contains the raw content (as string or Buffer), MIME type, charset, and source URL fetched from the source.
- **`MiddlewareContext`**: An object passed through the middleware pipeline, carrying the content (as string), source URL, extracted metadata, links, errors, and options. Middleware may add additional properties as needed for processing.
- **`ContentProcessorMiddleware`**: Individual, reusable components that perform specific tasks on the context, such as:
  - Parsing HTML (`HtmlDomParserMiddleware`)
  - Extracting metadata (`HtmlMetadataExtractorMiddleware`, `MarkdownMetadataExtractorMiddleware`)
  - Extracting links (`HtmlLinkExtractorMiddleware`, `MarkdownLinkExtractorMiddleware`)
  - Sanitizing and cleaning HTML (`HtmlSanitizerMiddleware`)
  - Converting HTML to Markdown (`HtmlToMarkdownMiddleware`)
- **Strategies (`WebScraperStrategy`, `LocalFileStrategy`, etc.)**: Construct and run the appropriate pipeline based on the fetched content's MIME type. After the pipeline completes, the strategy uses the final `content` and `metadata` from the context to create the `Document` object.

This middleware approach ensures:

- **Modularity:** Processing steps are isolated and reusable.
- **Configurability:** Pipelines can be easily assembled for different content types.
- **Testability:** Individual middleware components can be tested independently.
- **Consistency:** Ensures a unified document format regardless of the source.

### Middleware and Pipeline Architecture

The content processing system is organized into specialized pipelines that use middleware components. This architecture is located in `src/scraper/pipelines/` and `src/scraper/middleware/`.

- **`ContentPipeline` Interface**: Defines the contract for all content processing pipelines with methods:

  - `canProcess(rawContent: RawContent)`: Determines if this pipeline can handle the given content type
  - `process(rawContent: RawContent, options: ScraperOptions, fetcher?: ContentFetcher)`: Processes the content and returns ProcessedContent
  - `close()`: Cleans up resources when the pipeline is no longer needed

- **Pipeline Implementations**:

  - `HtmlPipeline`: Processes HTML content using HTML-specific middleware
  - `MarkdownPipeline`: Processes Markdown and text content using Markdown-specific middleware
  - Future pipelines can be added for other content types (e.g., PDF, JSON)

- **`MiddlewareContext`**: An object passed through the middleware pipeline, carrying the content (as string), source URL, extracted metadata, links, errors, and options. Middleware may add additional properties as needed for processing.

- **`ContentProcessorMiddleware`**: Individual, reusable components that perform specific tasks on the context, such as:

  - Parsing HTML (`HtmlCheerioParserMiddleware`)
  - Extracting metadata (`HtmlMetadataExtractorMiddleware`, `MarkdownMetadataExtractorMiddleware`)
  - Extracting links (`HtmlLinkExtractorMiddleware`, `MarkdownLinkExtractorMiddleware`)
  - Sanitizing and cleaning HTML (`HtmlSanitizerMiddleware`)
  - Converting HTML to Markdown (`HtmlToMarkdownMiddleware`)

- **Strategies (`WebScraperStrategy`, `LocalFileStrategy`, etc.)**: Select and use the appropriate pipeline based on the fetched content's MIME type. After the pipeline completes, the strategy uses the returned `ProcessedContent` to create the `Document` object.

This architecture ensures:

- **Modularity:** Processing steps are isolated and reusable
- **Configurability:** Pipelines can be easily assembled for different content types
- **Testability:** Individual middleware components and pipelines can be tested independently
- **Consistency:** Ensures a unified document format regardless of the source
- **Extensibility:** New content types can be supported by adding new pipelines

## Tools Layer

The project maintains a `tools/` directory containing modular implementations of core functionality. This design choice ensures that:

- Features are shared and reused across interfaces
- Business logic only needs to be implemented once
- Testing is simplified as core logic is isolated from interface concerns

Current tools include:

- Documentation scraping functionality
- Search capabilities with context-aware results
- Library version management
- Documentation scraping functionality (now asynchronous via PipelineManager)
- Job management (listing, status checking, cancellation)
- Search capabilities with context-aware results
- Library version management
- Document management operations

The tools interact with the `DocumentManagementService` for managing and retrieving documents, and the `PipelineManager` for handling long-running jobs like scraping. This ensures a consistent interface for all tools and simplifies the integration with the document storage system and job queue.

## Pipeline Architecture

The document processing pipeline is designed as an asynchronous, queue-based system managed by the `PipelineManager`.

- **`PipelineManager`**:
  - Manages a queue of processing jobs (currently just scraping).
  - Controls job concurrency based on configuration (defaulting to 3).
  - Tracks the state (`QUEUED`, `RUNNING`, `COMPLETED`, `FAILED`, `CANCELLED`) and progress of each job.
  - Provides methods (exposed via tools) to enqueue new jobs (`enqueueJob`), get job status (`getJob`, `getJobs`), wait for completion (`waitForJobCompletion`), and request cancellation (`cancelJob`).
  - `enqueueJob` is non-blocking and returns a unique `jobId` immediately.
- **`PipelineWorker`**:
  - Executes a single job dequeued by the `PipelineManager`.
  - Contains the logic for orchestrating scraping (using `ScraperService`) and storing results (using `DocumentManagementService`) for that specific job.
  - Respects cancellation signals passed down from the `PipelineManager`.
- **Cancellation**: Uses the standard `AbortController` and `AbortSignal` pattern to propagate cancellation requests from the manager down through the worker and scraper layers.

```mermaid
graph TD
    subgraph Client Interface
        UI[User Request e.g., scrape]
    end

    subgraph PipelineManager
        direction LR
        Q[Job Queue: Job1, Job2, ...]
        WM[Worker Pool Manager]
        Jobs[Job Status Map<JobID, PipelineJob>]
    end

    subgraph PipelineWorker
        direction TB
        PW[Worker executing JobX]
        Scrape[ScraperService.scrape]
        StoreProc[Store Document Logic]
    end

    UI -- enqueueJob --> PM[PipelineManager]
    PM -- Returns JobID --> UI
    PM -- Adds Job --> Q
    PM -- Updates Job State --> Jobs

    WM -- Has capacity? --> Q
    Q -- Dequeues Job --> WM
    WM -- Assigns Job --> PW

    PW --> Scrape
    Scrape -- Progress Callback --> PW
    PW --> StoreProc
    StoreProc --> DB[(DocumentStore)]
    PW -- Updates Status/Progress --> Jobs[Job Status Map]

    ClientWait[Client.waitForJobCompletion] -->|Checks Status/Promise| Jobs
    ClientCancel[Client.cancelJob] --> PM
    PM -- Calls AbortController.abort() --> Signal([AbortSignal for JobID])
    Signal -- Passed to --> PW
```

### Document Storage Design

The project uses SQLite for document storage, providing a lightweight and efficient database solution that requires no separate server setup.

#### Embedding Generation

Document embeddings are generated using a flexible provider system implemented in `src/store/embeddings/EmbeddingFactory.ts`. This factory supports multiple embedding providers through LangChain.js integrations:

```mermaid
graph TD
    subgraph Input
        EM[DOCS_MCP_EMBEDDING_MODEL]
        DC[Document Content]
    end

    subgraph EmbeddingFactory
        P[Parse provider:model]
        PV[Provider Selection]
        Config[Provider Configuration]
        LangChain[LangChain Integration]
    end

    subgraph Providers
        OpenAI[OpenAI Embeddings]
        VertexAI[Google Vertex AI]
        Bedrock[AWS Bedrock]
        Azure[Azure OpenAI]
    end

    subgraph Output
        Vec[1536d Vector]
        Pad[Zero Padding if needed]
    end

    EM --> P
    P --> PV
    PV --> Config
    Config --> LangChain
    DC --> LangChain

    LangChain --> |provider selection| OpenAI
    LangChain --> |provider selection| VertexAI
    LangChain --> |provider selection| Bedrock
    LangChain --> |provider selection| Azure

    OpenAI & VertexAI & Bedrock & Azure --> Vec
    Vec --> |if dimension < 1536| Pad
```

The factory:

- Parses the `DOCS_MCP_EMBEDDING_MODEL` environment variable to determine the provider and model
- Configures the appropriate LangChain embeddings class based on provider-specific environment variables
- Ensures consistent vector dimensions through the `FixedDimensionEmbeddings` wrapper:
  - Models producing vectors < 1536 dimensions: Padded with zeros
  - Models with MRL support (e.g., Gemini): Safely truncated to 1536 dimensions
  - Other models producing vectors > 1536: Not supported, throws error
- Maintains a fixed database dimension of 1536 for all embeddings for compatibility with `sqlite-vec`

This design allows easy addition of new embedding providers while maintaining consistent vector dimensions in the database.

**Database Location:** The application determines the database file (`documents.db`) location dynamically:

1. It first checks for a `.store` directory in the current project directory. If `.store/documents.db` exists, it uses this path. This prioritizes local development databases.
2. If the local `.store/documents.db` does not exist, it defaults to a standard, OS-specific application data directory (e.g., `~/Library/Application Support/docs-mcp-server/` on macOS, `~/.local/share/docs-mcp-server/` on Linux) determined using the `env-paths` library. This ensures a stable, persistent location when running via `npx` or outside a local project context.

Documents are stored with URLs and sequential ordering to maintain source context:

```mermaid
graph LR
    D1[Previous Doc] --> D2[Current Doc] --> D3[Next Doc]
    subgraph Same URL/Version
        D1 & D2 & D3
    end
```

Search results include surrounding content to provide more complete responses, while maintaining efficient retrieval through compound indexing.

### Document Management and Retrieval

The document storage and retrieval system is divided into two main services:

- **DocumentManagementService:** This service is responsible for managing documents within the store. It handles adding new documents, deleting existing documents, and updating the store. It also includes functionality for finding the best matching version of a library's documentation.
- **DocumentRetrieverService:** This service focuses on retrieving documents and providing contextual information. It handles searching for documents and retrieving related content, such as parent, child, preceding, and subsequent sibling chunks, to provide more complete search results.

This separation of concerns improves the modularity, maintainability, and testability of the system.

### Web Interface

The web interface provides a GUI for interacting with the server, monitoring jobs, and viewing indexed libraries. It follows a server-side rendered architecture using modern web technologies, emphasizing modularity through reusable components.

#### Technology Stack

- **Fastify:** Web server framework
- **`@kitajs/html`:** Server-side JSX rendering for component-based UI
- **HTMX:** Dynamic content updates without full page reloads
- **Tailwind/Flowbite:** Styling via CDN

#### Component Structure

The web interface is organized into logical parts:

- **Entry Point:** Now part of `src/index.ts`. When the `web` command is used, `src/index.ts` calls `startWebServer` from `src/web/web.ts`.
- **Core Server (`src/web/web.ts`):** Configures Fastify, registers plugins, instantiates services/tools (using shared instances provided by `src/index.ts`), and maps routes to handlers.
- **Routes (`src/web/routes/`):** Contains route handler modules, organized into subdirectories by feature (e.g., `jobs/`, `libraries/`). These handlers fetch data using the core Tools and compose the UI using components. The root `index.tsx` defines the main page structure.
- **Components (`src/web/components/`):** Contains reusable JSX components (e.g., Layout, JobItem, LibraryList, Alert) responsible for rendering specific parts of the UI. These components receive data as props from the route handlers.

This structure separates routing and data fetching logic (in `routes/`) from presentation logic (in `components/`), promoting code reuse and maintainability.

#### Integration Flow

```mermaid
graph TD
    subgraph "Entry Point"
        direction LR
        EntryPoint["src/index.ts (Unified CLI)"]
        EntryPoint -- "No command or MCP options" --> McpMode["MCP Server Mode"]
        EntryPoint -- "web command" --> WebMode["Web Interface Mode"]
        EntryPoint -- "Other CLI commands" --> CliCommandMode["CLI Command Mode"]
    end

    subgraph "Core Tools"
        T_Scrape("Scrape Tool")
        T_Search("Search Tool")
        T_Jobs("Job Tools")
        T_Libs("Library Tools")
        T_Remove("Remove Tool")
        T_Fetch("Fetch URL Tool")
        T_Find("Find Version Tool")
    end

    subgraph "Core Services"
        PipelineSvc("Pipeline Manager")
        ScraperSvc("Scraper Service")
        StoreSvc("Document Mgmt Service")
        RetrieverSvc("Document Retriever Service")
    end

    CliCommandMode --> T_Scrape & T_Search & T_Jobs & T_Libs & T_Remove & T_Fetch & T_Find
    McpMode -- "Uses MCP tools from src/mcp/tools.ts" --> T_Scrape & T_Search & T_Jobs & T_Libs & T_Remove & T_Fetch & T_Find

    subgraph "Web Server Logic (invoked by WebMode)"
        WebCore("Core Web Server: src/web/web.ts")
        WebRoutes("Route Handlers: src/web/routes/*.tsx")
    end

    WebMode --> WebCore
    WebCore --> WebRoutes
    WebRoutes -- "Calls Tools" --> T_Jobs & T_Libs & T_Scrape & T_Search & T_Remove & T_Find

    T_Scrape --> PipelineSvc
    T_Jobs --> PipelineSvc
    T_Libs --> StoreSvc
    T_Search --> RetrieverSvc
    T_Remove --> StoreSvc
    T_Fetch --> ScraperSvc
    T_Find --> StoreSvc

    PipelineSvc --> ScraperSvc
    PipelineSvc --> StoreSvc
    RetrieverSvc --> StoreSvc
```

#### AlpineJS and HTMX Interaction Pattern

When using AlpineJS for component state management alongside HTMX for dynamic updates, avoid calling the global `htmx` object directly from within Alpine event handlers (`x-on:`, `@`). Due to potential scope limitations in Alpine's expression evaluation, this can lead to "htmx is not defined" errors.

**Recommended Pattern:**

1.  **Alpine Dispatches Event:** Let the Alpine component manage its state. When an action requires triggering an HTMX request, use `$el.dispatchEvent` to dispatch a standard browser `CustomEvent` from the element.
    ```html
    <button
      x-data="{...}"
      x-on:click="if (confirmed) $el.dispatchEvent(new CustomEvent('confirmed-action'))"
    >
      ...
    </button>
    ```
2.  **HTMX Listens for Event:** Configure the `hx-trigger` attribute on the same element to listen for the dispatched custom event name.
    ```html
    <button ... hx-post="/do-something" hx-trigger="confirmed-action">
      ...
    </button>
    ```

This approach uses standard browser events as the communication bridge, decoupling Alpine's internal scope from HTMX.

The web interface leverages HTMX for dynamic updates, allowing partial page refreshes for job status and library list changes without full page reloads. Static assets are served from the `public` directory with `index: false` to prevent interference with dynamic routes.

### Interface-Specific Adapters

#### Unified Entry Point (`src/index.ts`)

- Uses Commander.js for parsing all command-line arguments.
- **CLI Mode:** If a specific CLI command (e.g., `scrape`, `search`, `list`, `web`) is provided, it executes the corresponding logic.
  - For general CLI commands, it converts arguments to tool options, calls the appropriate tool from the `tools/` directory, and formats results for console output.
  - For the `web` command, it starts the Web Interface by calling `startWebServer` from `src/web/web.ts`.
- **Default MCP Server Mode:** If no command is specified, it defaults to starting the MCP server.
  - It uses global options like `--protocol` and `--port` to configure the MCP server.
  - It calls `startServer` from `src/mcp/index.ts` to launch the MCP server (stdio or HTTP).
- Handles shared service initialization (`DocumentManagementService`, `PipelineManager`) for all modes.
- Manages graceful shutdown for all running components (CLI tools, MCP server, Web server).

#### MCP Server Logic (`src/mcp/index.ts` and `src/mcp/tools.ts`)

- Implements the MCP protocol for AI interaction when `src/index.ts` starts it in MCP Server Mode.
- `src/mcp/tools.ts` defines the MCP-specific tool schemas and maps them to the core tool functionalities from the `tools/` directory.
- `src/mcp/index.ts` (specifically `startStdioServer` and `startHttpServer`) instantiates the `@modelcontextprotocol/sdk McpServer` and registers the defined MCP tools.
- Formats results as MCP responses
- Provides progress feedback through MCP protocol (Note: Currently reports job start via message, detailed progress TBD)

The MCP server exposes the following tools:

- `scrape_docs`: Starts a scraping job.
- `search_docs`: Searches the indexed documentation.
- `list_libraries`: Lists all indexed libraries.
- `find_version`: Finds the best matching version for a library.
- `remove_docs`: Removes indexed documents.
- `fetch_url`: Fetches a single URL and converts to Markdown.
- `list_jobs`: Lists active/completed jobs.
- `get_job_info`: Retrieves the status and progress of a specific job.
- `cancel_job`: Attempts to cancel a running or queued job.

### Progress Reporting

The project uses a unified progress reporting system via callbacks managed by the `PipelineManager`. This design:

- Provides job-level status updates (`onJobStatusChange`).
- Provides detailed progress updates during job execution (`onJobProgress`), including page scraping details.
- Reports errors encountered during document processing within a job (`onJobError`).
- Ensures consistent progress tracking across components via `PipelineManagerCallbacks`.
- Supports different handling of progress/status for CLI (waits for completion) and MCP (returns `jobId` immediately).
- Concurrency is managed by the `PipelineManager`, not just batching within strategies.

### Logging Strategy

The project uses a centralized logging system through `utils/logger.ts` that maps to console methods. The logging follows a hierarchical approach:

1. **Tools Layer (Highest)**

   - Primary user-facing operations
   - Final results and overall progress
   - Example: Search queries and result counts

2. **Core Components (Middle)**

   - Unique operational logs
   - Store creation and management
   - Example: Vector store operations

3. **Strategy Layer (Lowest)**
   - Detailed progress (page crawling)
   - Error conditions and retries
   - Example: Individual page scraping status

This hierarchy ensures:

- Clear operation visibility
- No duplicate logging between layers
- Consistent emoji usage for better readability
- Error logging preserved at all levels for debugging

### Benefits

1. **Maintainability**

   - Single source of truth for business logic
   - Clear separation of concerns
   - Easier to test and debug

2. **Feature Parity**

   - Guaranteed same functionality in both interfaces
   - Consistent behavior and error handling

3. **Extensibility**
   - Easy to add new tools
   - Simple to add new interfaces (e.g., REST API) using same tools

## Testing Conventions

Our testing philosophy emphasizes verifying public contracts and ensuring tests are robust and maintainable.

### 1. Test Public API Behavior

- Focus tests on public methods: verify correct outputs or observable side effects for given inputs.
- Avoid assertions on internal implementation details (private methods, internal state). Tests should remain resilient to refactoring.

### 2. Mocking Principles

- Mock only true external dependencies (e.g., databases, external APIs, file system).
- When mocking modules with Vitest, be aware that `vi.mock` is hoisted. Define top-level mock functions/objects before the `vi.mock` call, and assign them within the mock factory.
- Set default behaviors for mocks globally; override them locally in tests or describe blocks as needed.
- Use shared spies for repeated calls (e.g., a database statement's `.all()`), and reset them in `beforeEach`.

### 3. Test Structure & Assertions

- Organize related tests with `describe`, and use `beforeEach`/`afterEach` for setup and cleanup.
- Assert expected return values and observable side effects. Use `expect(...).resolves/.rejects` for async code.
- Only assert direct calls to mocks if that interaction is a key part of the contract being tested.

These guidelines help ensure tests are clear, maintainable, and focused on the system's observable behavior.

## Releasing

This project uses [semantic-release](https://github.com/semantic-release/semantic-release) and [Conventional Commits](https://www.conventionalcommits.org/) to automate the release process.

**How it works:**

1.  **Commit Messages:** All commits merged into the `main` branch **must** follow the Conventional Commits specification.
2.  **Manual Trigger:** The "Release" GitHub Actions workflow can be triggered manually from the Actions tab when you're ready to create a new release.
3.  **`semantic-release` Actions:** Determines version, updates `CHANGELOG.md` & `package.json`, commits, tags, publishes to npm, and creates a GitHub Release.

**What you need to do:**

- Use Conventional Commits.
- Merge changes to `main`.
- Trigger a release manually when ready from the Actions tab in GitHub.

**Automation handles:** Changelog, version bumps, tags, npm publish, GitHub releases.

## Future Considerations

When adding new functionality:

1. Implement core logic in a new tool under `tools/`
2. Consider data relationships and context requirements
3. Design for efficient retrieval patterns
4. Add CLI command in `src/index.ts` using Commander.js.
5. Define the MCP tool schema and logic in `src/mcp/tools.ts` and ensure it's registered with the `McpServer` instance in `src/mcp/index.ts`.
6. Maintain consistent error handling and progress reporting

When adding new scraping capabilities:

1. Implement a new strategy in `scraper/strategies/`
2. Update the registry to handle the new source type
3. Reuse existing content processing where possible
4. Consider bulk operations and progress reporting
