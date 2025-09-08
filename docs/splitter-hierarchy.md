# Splitter Hierarchy System

## Overview

The splitter hierarchy system provides a standardized way to organize and relate document chunks through two key properties: `level` and `path`. This hierarchical structure enables semantic chunk reassembly, context-aware search, and document structure preservation across different content types.

## Core Concepts

### Hierarchy Structure

Every `ContentChunk` contains a `section` property with:

```typescript
section: {
  level: number,    // Hierarchical depth starting from 0
  path: string[]    // Array representing the hierarchical path
}
```

### Root Level

All documents start at:

- **Level**: `0`
- **Path**: `[]` (empty array)

This represents the document root and is used for:

- Plain text content with no semantic structure
- Source code at global scope (imports, global variables, unstructured code)
- Base level for structured content

### Level Progression

Levels increase with hierarchical depth:

- **Level 0**: Document root, global/unstructured content
- **Level 1**: Top-level structures (H1 headings, classes, JSON root objects)
- **Level 2**: Sub-structures (H2 headings, class methods, nested objects)
- **Level 3+**: Further nested content (H3+ headings, inner functions, deep nesting)

## Content Type Examples

### Markdown Documents

```typescript
// # Chapter 1          -> level: 1, path: ["Chapter 1"]
// ## Section 1.1       -> level: 2, path: ["Chapter 1", "Section 1.1"]
// ### Subsection 1.1.1 -> level: 3, path: ["Chapter 1", "Section 1.1", "Subsection 1.1.1"]
// Plain text content   -> level: 0, path: []
```

### Source Code

```typescript
// File: UserService.ts
[
  {
    content: "class UserService {",
    section: { level: 1, path: ["UserService", "opening"] },
  },
  {
    content: "  getUser(id) { return db.find(id); }",
    section: { level: 2, path: ["UserService", "getUser"] },
  },
  {
    content: "}",
    section: { level: 1, path: ["UserService", "closing"] },
  },
  {
    content: "// Global code or imports",
    section: { level: 0, path: [] },
  },
];
```

### JSON Documents

```typescript
// {"users": [{"name": "Alice"}, {"name": "Bob"}]}
[
  {
    content: '"Alice"',
    section: { level: 4, path: ["root", "users", "[0]", "name"] },
  },
  {
    content: '"Bob"',
    section: { level: 4, path: ["root", "users", "[1]", "name"] },
  },
];
```

**Note**: JSON documents use `["root"]` as the starting path because the root object/array is a real structural element. This differs from source code where global content uses `[]` (empty path) because there's no meaningful structural container.

## Level and Path Relationship

### Independent but Related

**Important**: Level and path are independent properties that don't need to match exactly:

- Path length often correlates with level, but not always
- A chunk can have `level: 1` with `path: ["A", "B", "C"]` (3 elements)
- Level represents conceptual hierarchy depth
- Path represents the actual navigational structure

### When They Diverge

```typescript
// Example: Content inheriting parent context
{
  content: "Some text under a deep heading",
  section: {
    level: 2,    // Conceptually a level-2 section
    path: ["Chapter", "Section", "Subsection", "Details"]  // But deep path
  }
}
```

## Chunk Merging Rules

The `GreedySplitter` uses sophisticated rules when combining chunks:

### Level Selection

Always uses the **lowest (most general) level** between chunks:

```typescript
// Merging level 1 + level 3 = level 1 (most general)
merge(
  { level: 1, path: ["Section"] },
  { level: 3, path: ["Section", "Sub", "Detail"] }
);
// Result: { level: 1, path: ["Section", "Sub", "Detail"] }
```

### Path Selection Rules

1. **Identical sections**: Preserve original metadata
2. **Parent-child relationship**: Use the child's (deeper) path
3. **Sibling sections**: Use common parent path
4. **Unrelated sections**: Use root path `[]`

### Detailed Merging Examples

#### Parent-Child Merging

```typescript
// Parent content + Child content
current: { level: 1, path: ["Section 1"] }
next:    { level: 2, path: ["Section 1", "SubSection 1.1"] }
// Result: { level: 1, path: ["Section 1", "SubSection 1.1"] }
```

#### Sibling Merging

```typescript
// Two sibling sections
current: { level: 2, path: ["Section 1", "Sub 1.1"] }
next:    { level: 2, path: ["Section 1", "Sub 1.2"] }
// Result: { level: 2, path: ["Section 1"] }  // Common parent
```

#### Unrelated Merging

```typescript
// Completely different sections
current: { level: 1, path: ["Section 1"] }
next:    { level: 1, path: ["Section 2"] }
// Result: { level: 1, path: [] }  // Root level
```

#### Deep Hierarchy Merging

```typescript
// Deep nested content
current: { level: 1, path: ["S1"] }
next:    { level: 2, path: ["S1", "S1.1"] }
final:   { level: 3, path: ["S1", "S1.1", "S1.1.1"] }
// Result: { level: 1, path: ["S1", "S1.1", "S1.1.1"] }  // Lowest level, deepest path
```

## Relationship Detection

### Parent-Child Detection

```typescript
// One path is a prefix of another
isParentChild(["Section"], ["Section", "SubSection"]); // true
isParentChild(["A", "B"], ["A", "B", "C", "D"]); // true
isParentChild(["X"], ["Y"]); // false
```

### Common Path Finding

```typescript
// Longest shared prefix
findCommonPrefix(["A", "B", "C"], ["A", "B", "D"]); // ["A", "B"]
findCommonPrefix(["X", "Y"], ["A", "B"]); // []
findCommonPrefix(["Same"], ["Same"]); // ["Same"]
```

## Storage and Retrieval

### Database Usage

The hierarchy enables sophisticated search operations:

- **Parent chunks**: `path.slice(0, -1)`
- **Child chunks**: Find paths starting with current path + one more element
- **Sibling chunks**: Same path length with shared parent
- **Context retrieval**: Automatically include related chunks in search results

### Search Context

When retrieving search results, the system provides:

1. **Direct match**: The chunk that matched the search
2. **Parent context**: Broader context for understanding
3. **Sibling navigation**: Related content at the same level
4. **Child exploration**: Deeper content for more details

## Implementation Notes

### Path Uniqueness

- **Paths don't need to be unique** within a document
- Multiple chunks can share the same path if they're at the same level
- Example: Multiple paragraphs under the same heading share `path` and `level`

### Content Type Agnostic

The hierarchy system works consistently across:

- Markdown documents (heading-based hierarchy)
- Source code (function/class-based hierarchy)
- JSON files (object structure hierarchy)
- Plain text (root level only)

### Chunk Reassembly

The hierarchy enables perfect document reconstruction:

- Chunks maintain their original structural relationships
- Merged chunks preserve the most specific path information
- Level information indicates conceptual importance/generality

## Best Practices

### For Splitter Implementations

1. **Start with root**: Initialize with `level: 0, path: []`
2. **Increment consistently**: Each structural boundary increases appropriate level
3. **Build paths incrementally**: Add to path array as structure deepens
4. **Preserve semantics**: Level should reflect conceptual hierarchy depth

### For Chunk Processing

1. **Respect boundaries**: Don't merge across major structural breaks (H1/H2)
2. **Use hierarchy for context**: Include parent/child information in search results
3. **Maintain relationships**: Preserve path information during processing
4. **Leverage for navigation**: Enable users to explore related content

## Validation

The hierarchy system ensures:

- **Consistency**: All chunks follow the same structural rules
- **Navigability**: Users can move between related content sections
- **Context preservation**: Document structure survives the chunking process
- **Search enhancement**: Hierarchical information improves result relevance
