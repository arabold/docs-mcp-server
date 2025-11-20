# Data Storage

## Overview

The storage system uses SQLite with a normalized schema design for efficient document storage, retrieval, and version management.

## Database Schema

### Libraries Table

Core library metadata and organization:

```sql
CREATE TABLE libraries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**Purpose:** Library name normalization and metadata storage.

### Versions Table

Version tracking with comprehensive status and configuration:

```sql
CREATE TABLE versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  library_id INTEGER NOT NULL,
  version TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  indexed_at DATETIME,
  error_message TEXT,
  -- Job state fields
  job_status TEXT DEFAULT 'queued',
  progress_current INTEGER DEFAULT 0,
  progress_total INTEGER DEFAULT 0,
  -- Configuration storage
  scraper_config TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (library_id) REFERENCES libraries (id)
);
```

**Purpose:** Job state management, progress tracking, and scraper configuration persistence.

### Documents Table

Document content with embeddings and metadata:

```sql
CREATE TABLE documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  url TEXT NOT NULL,
  order_index INTEGER NOT NULL,
  embedding BLOB,
  metadata TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (version_id) REFERENCES versions (id)
);
```

**Purpose:** Content storage with vector embeddings and search metadata.

## Schema Evolution

### Migration System

Sequential SQL migrations in `db/migrations/`:

- `000-initial-schema.sql`: Base schema creation
- `001-add-indexed-at-column.sql`: Indexing timestamp
- `002-normalize-library-table.sql`: Library normalization
- `003-normalize-vector-table.sql`: Vector storage optimization
- `004-complete-normalization.sql`: Full schema normalization
- `005-add-status-tracking.sql`: Job status tracking
- `006-add-scraper-options.sql`: Configuration persistence

### Migration Application

Automatic migration execution:

- Check current schema version
- Apply pending migrations in sequence
- Validate schema integrity
- Handle migration failures gracefully

## Data Location

### Storage Directory Resolution

Database location determined by priority:

1. Project-local `.store` directory
2. OS-specific application data directory
3. Temporary directory as fallback

### Cross-Platform Support

Platform-specific paths:

- **macOS:** `~/Library/Application Support/docs-mcp-server/`
- **Linux:** `~/.local/share/docs-mcp-server/`
- **Windows:** `%APPDATA%/docs-mcp-server/`

## Document Management

### DocumentManagementService

Handles document lifecycle operations:

**Core Operations:**

- Document addition and removal
- Version management and cleanup
- Library organization
- Duplicate detection

**Version Resolution:**

- Exact version matching
- Semantic version ranges
- Latest version fallback
- Version conflict resolution

### Document Storage Flow

1. Create or resolve library record
2. Create version record with job configuration
3. Process and store document chunks
4. Generate and store embeddings
5. Update version status and metadata

## Embedding Management

### Vector Storage

Embeddings stored as BLOB data:

- Consistent 1536-dimensional vectors
- Provider-agnostic storage format
- Efficient binary serialization
- Null handling for missing embeddings

### EmbeddingFactory

Centralized embedding generation:

- Multiple provider support (OpenAI, Google, Azure, AWS)
- Consistent vector dimensions
- Error handling and retry logic
- Rate limiting and quota management

### Provider Configuration

Support for multiple embedding providers:

**OpenAI:**

- `text-embedding-3-small` (default)
- `text-embedding-3-large`
- Custom API endpoints (Ollama compatibility)

**Google:**

- Gemini embedding models
- Vertex AI integration
- Service account authentication

**Azure:**

- Azure OpenAI service
- Custom deployment support
- Region-specific endpoints

**AWS:**

- Bedrock embedding models
- IAM-based authentication
- Regional deployment support

## Search Implementation

### DocumentRetrieverService

Handles search and retrieval operations:

**Search Methods:**

- Vector similarity search
- Full-text search
- Hybrid search combining both
- Context-aware result ranking

**Context Retrieval:**

- Parent-child chunk relationships
- Sibling chunk context
- Document-level metadata
- Sequential ordering preservation

### Search Optimization

Performance optimizations:

- Vector similarity indexing
- Full-text search indexes
- Query result caching
- Batch retrieval operations

## Data Consistency

### Write-Through Architecture

Immediate persistence of state changes:

- Job status updates
- Progress tracking
- Configuration changes
- Error information

### Transaction Management

Database transactions for consistency:

- Atomic document storage
- Version state transitions
- Batch operations
- Error rollback handling

### Concurrent Access

Safe concurrent database access:

- Connection pooling
- Transaction isolation
- Lock management
- Deadlock prevention

## Performance Considerations

### Index Strategy

Database indexes for performance:

- Primary keys on all tables
- Foreign key indexes
- Search-specific indexes
- Composite indexes for common queries

### Query Optimization

Efficient query patterns:

- Prepared statements
- Batch operations
- Result pagination
- Query plan optimization

### Storage Efficiency

Space-efficient storage:

- Text compression for large content
- Binary embedding storage
- Metadata JSON optimization
- Garbage collection for deleted records

## Backup and Recovery

### Data Export

Export functionality for data portability:

- Complete database export
- Library-specific export
- Version-specific export
- Metadata preservation

### Data Import

Import from various sources:

- Previous database versions
- External documentation sources
- Configuration-based restoration
- Duplicate detection during import

### Disaster Recovery

Recovery mechanisms:

- Database integrity checks
- Automatic backup creation
- Transaction log recovery
- Schema validation and repair

## Monitoring and Maintenance

### Database Health

Health monitoring capabilities:

- Storage space utilization
- Query performance metrics
- Connection pool status
- Error rate tracking

### Maintenance Operations

Regular maintenance tasks:

- Vacuum operations for SQLite
- Index rebuilding
- Orphaned record cleanup
- Performance analysis

### Diagnostics

Debugging and diagnostic tools:

- Query execution analysis
- Storage space breakdown
- Relationship integrity checks
- Performance bottleneck identification
