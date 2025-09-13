# Content-Agnostic Assembly

## Overview

The content-agnostic assembly system improves search result reassembly by using content-type-aware strategies that focus on **selecting the right chunks** rather than complex assembly logic. This approach leverages the existing splitter guarantees that chunks can be concatenated to reconstruct coherent content.

## Design Philosophy

### Core Principle: Query-Focused Strategy

The complexity lies in **selecting the appropriate chunks** for different content types, not in how they are assembled. Since document splitters already create chunks with concatenation guarantees, assembly can be simplified to basic joining operations.

### Strategy Pattern Benefits

- **Content-Type Awareness**: Different content types need different chunk selection strategies
- **Backward Compatibility**: Preserves existing behavior for markdown/text content
- **Extensibility**: Easy to add new content types without changing core logic
- **Separation of Concerns**: Chunk selection logic separated from assembly logic

## Two-Strategy Architecture

### 1. MarkdownAssemblyStrategy (Broad Context)

**Purpose**: Optimized for prose content where broader context enhances understanding.

**Chunk Selection**:

- Uses current context expansion logic
- Includes parents, siblings (limited), and children (limited)
- Provides comprehensive context around matched content

**Assembly**:

- Simple `"\n\n"` joining (current behavior)
- Works well for flowing text content

**Content Types**:

- `text/markdown`, `text/x-markdown`
- `text/html`, `application/xhtml+xml`
- `text/plain` and general text types
- **Default fallback** for unknown MIME types

### 2. HierarchicalAssemblyStrategy (Precise Reconstruction)

**Purpose**: Optimized for structured content where complete hierarchical sections provide better understanding than arbitrary context windows.

**Chunk Selection**:

- **Hierarchical Reconstruction**: Builds complete logical sections
- Follows parent chains to structural roots
- Includes all siblings at each hierarchical level
- Includes all children in proper document order
- **Result**: Complete hierarchical subtrees containing the matches

**Assembly**:

- Simple concatenation (leverages splitter concatenation guarantees)
- No special separators needed since chunks are designed to join seamlessly

**Content Types**:

- **Source Code**: `text/x-typescript`, `text/javascript`, `text/x-python`, etc.
- **JSON**: `application/json`, `text/json`, `text/x-json`
- **Structured Config**: `text/x-yaml`, `text/x-toml`, etc.

## Strategy Selection Logic

### MIME Type Classification

The system uses existing `MimeTypeUtils` to classify content:

```typescript
function selectStrategy(mimeType?: string): ContentAssemblyStrategy {
  if (!mimeType) {
    return new MarkdownAssemblyStrategy(); // Default fallback
  }

  if (
    MimeTypeUtils.isSourceCode(mimeType) ||
    MimeTypeUtils.isJson(mimeType) ||
    isStructuredConfig(mimeType)
  ) {
    return new HierarchicalAssemblyStrategy();
  }

  return new MarkdownAssemblyStrategy(); // Default for text/markdown/html
}
```

### Graceful Fallback

- **Unknown MIME types**: Default to MarkdownAssemblyStrategy
- **Mixed content types**: Use strategy based on first chunk's MIME type
- **Strategy failures**: Fallback to current joining behavior

## Implementation Architecture

### Strategy Interface

```typescript
interface ContentAssemblyStrategy {
  selectChunks(
    library: string,
    version: string,
    initialChunks: Document[],
    documentStore: DocumentStore
  ): Promise<Document[]>;

  assembleContent(chunks: Document[]): string;
}
```

### Integration Point

The strategy pattern integrates into `DocumentRetrieverService.finalizeResult()`:

1. **Current Logic**: Fixed context expansion + `"\n\n"` joining
2. **New Logic**: Strategy-based chunk selection + strategy-specific assembly

## Chunk Selection Comparison

### Current Approach (All Content Types)

```
For each matched chunk:
  - Parent: 1 chunk
  - Preceding siblings: limit 2
  - Children: limit 5
  - Subsequent siblings: limit 2
```

**Result**: Fixed context window around each match

### MarkdownAssemblyStrategy (Prose Content)

```
For each matched chunk:
  - Same as current approach
  - Preserves existing behavior
```

**Result**: Broad context for flowing text understanding

### HierarchicalAssemblyStrategy (Structured Content)

```
For matched chunks grouped by document:
  1. Identify all hierarchical roots containing matches
  2. Reconstruct complete subtrees:
     - Follow parent chains to structural boundaries
     - Include all siblings at each path level
     - Include all children in hierarchical order
  3. Return chunks in proper document order
```

**Result**: Complete logical sections (entire classes, complete JSON objects, etc.)

## Examples

### Markdown Content (Current Behavior Preserved)

**Search Match**: "Installation steps" in documentation

**Selected Chunks**:

- Parent: "Installation" section header
- Previous sibling: "Prerequisites"
- Match: "Installation steps"
- Child: "Step 1 details"
- Next sibling: "Configuration"

**Assembly**: Joined with `"\n\n"`

### Source Code Content (New Hierarchical Behavior)

**Search Match**: Method `validateUser()` inside class `AuthService`

**Selected Chunks**:

- Complete `AuthService` class including:
  - Class declaration and documentation
  - All properties and constructor
  - All methods (including `validateUser()`)
  - Any nested classes or interfaces

**Assembly**: Simple concatenation (chunks designed to join seamlessly)

### JSON Content (New Hierarchical Behavior)

**Search Match**: Property `"timeout"` inside configuration object

**Selected Chunks**:

- Complete containing object/array structure
- All sibling properties at the same level
- Proper JSON structure maintained

**Assembly**: Simple concatenation reconstructing valid JSON

## Performance Considerations

### Query Optimization

- **MarkdownAssemblyStrategy**: Uses existing optimized queries (minimal change)
- **HierarchicalAssemblyStrategy**: May require additional queries for complete reconstruction
- **Batching**: Group related queries to minimize database round trips

### Memory Usage

- **Controlled Expansion**: Hierarchical strategy focuses on complete sections, not unlimited expansion
- **Natural Boundaries**: Uses document structure as natural limits
- **Fallback Limits**: Maximum chunk counts to prevent excessive memory usage

## Error Handling

### Strategy Failures

- **Malformed Hierarchies**: Graceful degradation to available relationships
- **Missing Chunks**: Continue with available chunks
- **Query Errors**: Fallback to current joining behavior

### Content Quality

- **Syntax Validation**: For structured content, validate assembly results
- **Completeness Checks**: Ensure hierarchical reconstruction is complete
- **Fallback Assembly**: Use markdown strategy if hierarchical fails

## Migration Strategy

### Phase 1: Infrastructure

- Implement strategy interfaces and base classes
- Create strategy factory with MIME type detection

### Phase 2: Strategies

- Implement MarkdownAssemblyStrategy (current behavior)
- Implement HierarchicalAssemblyStrategy (new behavior)

### Phase 3: Integration

- Replace current logic in DocumentRetrieverService
- Comprehensive testing with real content samples

### Phase 4: Validation

- Monitor search result quality
- Performance impact assessment
- User feedback integration

## Future Enhancements

### Additional Strategies

- **CodeAssemblyStrategy**: Language-specific optimizations
- **ConfigAssemblyStrategy**: Format-specific handling (YAML, TOML, INI)
- **DataAssemblyStrategy**: Specialized handling for CSV, XML, etc.

### Adaptive Selection

- **Query-Based Strategy**: Choose strategy based on search intent
- **User Preferences**: Allow users to specify preferred assembly method
- **Content Analysis**: Dynamic strategy selection based on content analysis

## Success Metrics

### Functional Metrics

- **Backward Compatibility**: All existing searches produce identical results
- **Syntax Validity**: Structured content maintains syntactic correctness
- **Completeness**: Hierarchical content includes complete logical sections

### Performance Metrics

- **Query Efficiency**: Minimal increase in database queries
- **Response Time**: No significant impact on search response times
- **Memory Usage**: Controlled memory consumption for large hierarchical sections

### Quality Metrics

- **Relevance Preservation**: Search match visibility maintained or improved
- **Context Coherence**: Assembled content remains readable and useful
- **User Satisfaction**: Improved usability for structured content searches
