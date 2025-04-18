# Documentation MCP Server Architecture

## Overview

The Documentation MCP Server is designed with a modular architecture that ensures feature separation and code reuse between its two main interfaces:

1. Command Line Interface (CLI)
2. Model Context Protocol (MCP) Server

### Core File Naming and Code Quality Conventions

- Files containing classes use PascalCase (e.g., `PipelineManager.ts`, `PipelineWorker.ts`, `DocumentManagementService.ts`)
- Other files use kebab-case or regular camelCase (e.g., `index.ts`, `scraper-service.ts`)
- Avoid typecasting where possible. Never use `any` type but prefer `unknown` or `never`.

### Directory Structure

```
src/
├── cli.ts                           # CLI interface implementation
├── server.ts                        # MCP server entry point (uses mcp/index.ts)
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
│   ├── middleware/                  # Content processing pipeline & middleware
│   │   ├── Pipeline.ts              # Orchestrates middleware execution
│   │   ├── types.ts                 # Context and middleware interfaces
│   │   └── components/              # Individual middleware implementations
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
```

## Scraper Architecture

The scraping system uses a strategy pattern combined with content abstractions to handle different documentation sources uniformly:

### Content Sources

- Web-based content (HTTP/HTTPS)
- Local filesystem content (file://)
- Package registry content (e.g., npm, PyPI)

Each source type has a dedicated strategy that understands its specific protocol and structure, while sharing common processing logic.

### Content Processing Flow

Raw content fetched by a strategy's `fetcher` (e.g., HTML, Markdown) is processed through a configurable middleware pipeline. See the Middleware Pipeline section below for details.

```mermaid
graph TD
    subgraph Strategy Execution
        F[Fetcher Fetches RawContent]
        CtxIn[Create Initial Context]
        Pipe[Run Pipeline]
        CtxOut[Get Final Context]
        Doc[Create Document from Context]
    end

    subgraph ContentProcessingPipeline
        direction LR
        M1[Middleware 1] --> M2[Middleware 2] --> M3[...]
    end

    F --> CtxIn
    CtxIn --> Pipe
    Pipe -- Passes Context --> M1
    M1 -- Passes Context --> M2
    M2 -- Passes Context --> M3
    M3 -- Returns Final Context --> CtxOut
    CtxOut --> Doc
```

- **`ContentProcessingContext`**: An object passed through the pipeline, carrying the content (initially raw, potentially transformed), MIME type, source URL, extracted metadata, links, errors, and options. HTML processing also uses a `dom` property on the context to hold the parsed JSDOM object.
- **`ContentProcessorMiddleware`**: Individual, reusable components that perform specific tasks on the context, such as:
  - Parsing HTML (`HtmlDomParserMiddleware`)
  - Extracting metadata (`HtmlMetadataExtractorMiddleware`, `MarkdownMetadataExtractorMiddleware`)
  - Extracting links (`HtmlLinkExtractorMiddleware`, `MarkdownLinkExtractorMiddleware`)
  - Sanitizing and cleaning HTML (`HtmlSanitizerMiddleware`)
  - Converting HTML to Markdown (`HtmlToMarkdownMiddleware`)
- **`ContentProcessingPipeline`**: Executes a sequence of middleware components in order, passing the context object between them.
- **Strategies (`WebScraperStrategy`, `LocalFileStrategy`, etc.)**: Construct and run the appropriate pipeline based on the fetched content's MIME type. After the pipeline completes, the strategy uses the final `content` and `metadata` from the context to create the `Document` object.

This middleware approach ensures:

- **Modularity:** Processing steps are isolated and reusable.
- **Configurability:** Pipelines can be easily assembled for different content types.
- **Testability:** Individual middleware components can be tested independently.
- **Consistency:** Ensures a unified document format regardless of the source.

### Middleware Pipeline

The core of content processing is the middleware pipeline (`ContentProcessingPipeline` located in `src/scraper/middleware/`). This pattern allows for modular and reusable processing steps.

- **`ContentProcessingContext`**: An object passed through the pipeline, carrying the content (initially raw, potentially transformed), MIME type, source URL, extracted metadata, links, errors, and options. HTML processing also uses a `dom` property on the context to hold the parsed JSDOM object.
- **`ContentProcessorMiddleware`**: Individual, reusable components that perform specific tasks on the context, such as:
  - Parsing HTML (`HtmlDomParserMiddleware`)
  - Extracting metadata (`HtmlMetadataExtractorMiddleware`, `MarkdownMetadataExtractorMiddleware`)
  - Extracting links (`HtmlLinkExtractorMiddleware`, `MarkdownLinkExtractorMiddleware`)
  - Sanitizing and cleaning HTML (`HtmlSanitizerMiddleware`)
  - Converting HTML to Markdown (`HtmlToMarkdownMiddleware`)
- **`ContentProcessingPipeline`**: Executes a sequence of middleware components in order, passing the context object between them.
- **Strategies (`WebScraperStrategy`, `LocalFileStrategy`, etc.)**: Construct and run the appropriate pipeline based on the fetched content's MIME type. After the pipeline completes, the strategy uses the final `content` and `metadata` from the context to create the `Document` object.

This middleware approach ensures:

- **Modularity:** Processing steps are isolated and reusable.
- **Configurability:** Pipelines can be easily assembled for different content types.
- **Testability:** Individual middleware components can be tested independently.
- **Consistency:** Ensures a unified document format regardless of the source.

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

### Interface-Specific Adapters

#### CLI (cli.ts)

- Uses Commander.js for command-line argument parsing
- Converts command-line arguments to tool options
- Formats tool results for console output
- Handles CLI-specific error reporting

#### MCP Server (index.ts)

- Implements MCP protocol for AI interaction
- Wraps tool functions in MCP tool definitions
- Formats results as MCP responses
- Provides progress feedback through MCP protocol (Note: Currently reports job start via message, detailed progress TBD)

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

This section outlines conventions and best practices for writing tests within this project.

### Mocking with Vitest

When mocking modules or functions using `vitest`, it's crucial to follow a specific order due to how `vi.mock` hoisting works. `vi.mock` calls are moved to the top of the file before any imports. This means you cannot define helper functions _before_ `vi.mock` and then use them _within_ the mock setup directly.

To correctly mock dependencies, follow these steps:

1.  **Declare the Mock:** Call `vi.mock('./path/to/module-to-mock')` at the top of your test file, before any imports or other code.
2.  **Define Mock Implementations:** _After_ the `vi.mock` call, define any helper functions, variables, or mock implementations you'll need.
3.  **Import the Actual Module:** Import the specific functions or classes you intend to mock from the original module.
4.  **Apply the Mock:** Use the defined mock implementations to replace the behavior of the imported functions/classes. You might need to cast the imported item as a `Mock` type (`import { type Mock } from 'vitest'`).

**Example Structure:**

```typescript
import { vi, type Mock } from "vitest";

// 1. Declare the mock (hoisted to top)
vi.mock("./dependency");

// 2. Define mock function/variable *after* vi.mock
const mockImplementation = vi.fn(() => "mocked result");

// 3. Import the actual function/class *after* defining mocks
import { functionToMock } from "./dependency";

// 4. Apply the mock implementation
(functionToMock as Mock).mockImplementation(mockImplementation);

// ... rest of your test code using the mocked functionToMock ...
// expect(functionToMock()).toBe('mocked result');
```

This structure ensures that mocks are set up correctly before the modules that depend on them are imported and used in your tests.

## Future Considerations

When adding new functionality:

1. Implement core logic in a new tool under `tools/`
2. Consider data relationships and context requirements
3. Design for efficient retrieval patterns
4. Add CLI command in `cli.ts`
5. Add MCP tool in `index.ts`
6. Maintain consistent error handling and progress reporting

When adding new scraping capabilities:

1. Implement a new strategy in `scraper/strategies/`
2. Update the registry to handle the new source type
3. Reuse existing content processing where possible
4. Consider bulk operations and progress reporting
