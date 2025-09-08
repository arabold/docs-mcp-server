# Source Code Splitter Architecture

## Overview

The Source Code Splitter transforms source code files into hierarchical, concatenable chunks that preserve semantic structure while enabling effective code search. The system uses tree-sitter for precise syntax tree parsing to detect semantic boundaries, creating context-aware chunks that respect language structure.

## Design Philosophy

### Tree-sitter Semantic Boundaries

The splitter uses tree-sitter parsers to identify semantic boundaries in source code, providing:

- **Precision**: Syntax tree analysis ensures accurate boundary detection
- **Language Awareness**: Native support for JavaScript, TypeScript, JSX, and TSX
- **Semantic Chunking**: One chunk per function/method/class with proper hierarchy
- **Hierarchical Structure**: Chunks maintain proper nesting relationships

### Documentation-Focused Chunking

The chunking strategy prioritizes indexing public interfaces and maintaining comment-signature relationships:

- **Public Interface Emphasis**: Captures outward-facing class methods and top-level functions
- **Comment Preservation**: Documentation comments stay with their associated code
- **Hierarchical Paths**: Enable semantic search within code structure
- **Concatenable Chunks**: Chunks can be reassembled to reconstruct original context

## Architecture Components

```mermaid
graph TD
    subgraph "Tree-sitter Parsing"
        A[Source Code File]
        B[Language Detection]
        C[Tree-sitter Parser]
        D[Syntax Tree Generation]
    end

    subgraph "Boundary Extraction"
        E[Semantic Boundary Detection]
        F[Hierarchical Path Construction]
        G[Boundary Classification]
    end

    subgraph "Chunk Processing"
        H[Content Extraction]
        I[TextSplitter Delegation]
        J[Hierarchical Chunk Creation]
    end

    subgraph "Output Generation"
        K[ContentChunk Array]
        L[GreedySplitter Optimization]
    end

    A --> B
    B --> C
    C --> D
    D --> E
    E --> F
    F --> G
    G --> H
    H --> I
    I --> J
    J --> K
    K --> L

    style A fill:#e1f5fe
    style K fill:#f3e5f5
    style L fill:#e8f5e8
```

## Core Components

### 1. Tree-sitter Language Parsers

The system supports multiple languages through dedicated tree-sitter parsers:

**Supported Languages:**

- **JavaScript**: ES6+ classes, functions, arrow functions, JSX elements
- **TypeScript**: Interfaces, types, enums, namespaces, decorators, generics, TSX
- **JSX/TSX**: React component parsing with TypeScript integration

**Language Registry:**
The `LanguageParserRegistry` automatically selects the appropriate parser based on file extension and content analysis, falling back to `TextDocumentSplitter` for unsupported languages.

### 2. Semantic Boundary Detection

Tree-sitter parsers identify structural elements through syntax tree traversal:

**Primary Boundaries:**

- **Classes**: Complete class definitions with all members
- **Functions**: Top-level function declarations and expressions
- **Methods**: Class and interface method definitions
- **Interfaces**: TypeScript interface declarations
- **Namespaces**: TypeScript namespace blocks
- **Types**: Type alias definitions

**Boundary Extraction:**
Each boundary includes start/end positions, basic type classification, and optional name for context. The system focuses on structural boundaries rather than detailed metadata extraction.

### 3. Hierarchical Chunking Strategy

The chunking approach creates semantic units that respect code structure:

```mermaid
graph LR
    subgraph "Chunk Hierarchy"
        A[File Level] --> B[Class Level]
        B --> C[Method Level]
        A --> D[Function Level]
        B --> E[Property Level]
    end

    subgraph "Path Structure"
        F["['UserService.ts']"] --> G["['UserService.ts', 'UserService']"]
        G --> H["['UserService.ts', 'UserService', 'getUser']"]
        F --> I["['UserService.ts', 'calculateSum']"]
    end

    style A fill:#e1f5fe
    style G fill:#f3e5f5
    style H fill:#e8f5e8
```

**Chunking Rules:**

- **Level 1**: Top-level elements (classes, functions, interfaces, namespaces)
- **Level 2**: Class members (methods, properties, constructor)
- **Level 3**: Nested namespace elements
- **Content Delegation**: Large method bodies delegated to `TextDocumentSplitter`

### 4. Content Processing Pipeline

```mermaid
sequenceDiagram
    participant TSS as TreesitterSourceCodeSplitter
    participant LP as LanguageParser
    participant BE as BoundaryExtractor
    participant TS as TextSplitter

    TSS->>LP: Parse source code
    LP->>BE: Extract semantic boundaries
    BE->>TSS: Return boundary positions

    loop For each boundary
        TSS->>TSS: Extract boundary content
        TSS->>TS: Delegate large content sections
        TS->>TSS: Return subdivided chunks
    end

    TSS->>TSS: Assign hierarchical paths
    TSS->>TSS: Create ContentChunk array
```

## Processing Flow

### Semantic Chunking Process

```mermaid
flowchart TD
    A[Source Code Input] --> B{Language Supported?}
    B -->|Yes| C[Tree-sitter Parsing]
    B -->|No| D[TextDocumentSplitter Fallback]

    C --> E[Boundary Extraction]
    E --> F[Content Sectioning]
    F --> G[Hierarchical Path Assignment]
    G --> H[Chunk Generation]

    D --> I[Line-based Chunks]
    H --> J[Merge Results]
    I --> J
    J --> K[GreedySplitter Optimization]

    style A fill:#e1f5fe
    style K fill:#e8f5e8
    style D fill:#fff3e0
```

### Chunk Generation Strategy

The system creates chunks that balance semantic meaning with search effectiveness:

**Chunk Types:**

- **Structural Chunks**: Class/function/interface signatures with documentation
- **Method Chunks**: Complete method implementations including comments
- **Content Chunks**: Code sections between structural boundaries
- **Delegated Chunks**: Large content sections processed by TextSplitter

**Path Inheritance:**
Each chunk inherits the hierarchical path of its containing structure, enabling context-aware search and proper reassembly.

## Error Handling & Fallback Strategy

### Graceful Degradation

The splitter handles various scenarios through layered fallback mechanisms:

```mermaid
graph TD
    A[Input Source Code] --> B{Language Supported?}
    B -->|No| C[TextDocumentSplitter]
    B -->|Yes| D{Tree-sitter Parse Success?}
    D -->|No| C
    D -->|Yes| E{Boundaries Extracted?}
    E -->|No| C
    E -->|Yes| F[Semantic Chunking]

    F --> G[ContentChunk Array]
    C --> H[Line-based Chunks]
    G --> I[Output]
    H --> I

    style A fill:#e1f5fe
    style I fill:#e8f5e8
    style C fill:#fff3e0
```

**Fallback Scenarios:**

- **Unsupported Languages**: Automatic delegation to TextDocumentSplitter
- **Parse Errors**: Graceful fallback for malformed syntax
- **Boundary Detection Failures**: Line-based processing for complex edge cases

### Error Recovery

The system maintains robust operation through:

- **Parse Error Isolation**: Errors in one section don't affect others
- **Content Preservation**: All source content is retained in chunks
- **Consistent Interface**: All fallback paths produce compatible ContentChunk arrays

## Language Extensibility

### Current Language Support

The tree-sitter implementation provides comprehensive support for web development languages:

**JavaScript (ES6+):**

- Classes with methods and properties
- Functions (regular, async, arrow functions for top-level declarations)
- JSX elements and React components
- Import/export statements

**TypeScript:**

- All JavaScript features plus type system constructs
- Interfaces and type alias definitions
- Namespaces and modules
- Enums and decorators
- Generic type parameters
- TSX (TypeScript + JSX)

### Architecture for Extension

The modular design supports future language additions through:

**Parser Registry System:**

- Automatic language detection by file extension
- Fallback mechanisms for unsupported languages
- Consistent interface across all language parsers

**Tree-sitter Integration:**

- Leverages existing tree-sitter grammar ecosystem
- Language-specific parsers implement common boundary extraction interface
- Shared infrastructure for syntax tree traversal and boundary detection

**Future Language Candidates:**

- Python (classes, functions, indentation-aware parsing)
- Java (packages, classes, methods)
- C# (namespaces, classes, properties, methods)
- Go (packages, structs, methods, functions)

## Integration with Pipeline System

### Source Code Processing Pipeline

The tree-sitter splitter integrates seamlessly with the existing content processing infrastructure:

```mermaid
graph LR
    subgraph "Source Code Processing"
        A[SourceCodePipeline] --> B[TreesitterSourceCodeSplitter]
        B --> C[GreedySplitter]
        C --> D[ContentChunk Array]
        D --> E[Embedding Generation]
        E --> F[Vector Storage]
    end

    style A fill:#e1f5fe
    style D fill:#f3e5f5
    style F fill:#e8f5e8
```

### System Benefits

**Enhanced Search Quality:**

- Semantic chunks respect code structure boundaries
- Hierarchical paths enable context-aware retrieval
- Documentation comments stay associated with relevant code
- Function and method retrieval maintains complete context

**Performance Characteristics:**

- Tree-sitter parsing provides linear time complexity
- Memory efficient processing without large intermediate structures
- Robust error handling prevents pipeline failures
- Maintains compatibility with existing chunk optimization systems

**Developer Experience:**

- Search results respect semantic boundaries
- Retrieved chunks include necessary surrounding context
- Hierarchical structure aids in understanding code relationships
- Consistent interface with other document processing pipelines
