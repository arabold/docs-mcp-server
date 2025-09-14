/**
 * BaseLanguageParser - Abstract base class for tree-sitter language parsers
 */

import Parser, { type SyntaxNode, type Tree } from "tree-sitter";
import type { TreeSitterLanguage } from "./languageTypes";
import type {
  CodeBoundary,
  LanguageParser,
  LineRange,
  ParseResult,
  StructuralNode,
} from "./types";
import { StructuralNodeType } from "./types";

export abstract class BaseLanguageParser implements LanguageParser {
  /**
   * NOTE: Parser instances are created fresh per parse() invocation.
   *
   * Rationale:
   * - tree-sitter Parser objects are stateful and not guaranteed to be safe for
   *   concurrent reuse across overlapping async operations.
   * - We parse many different files (not incremental re-parses of the same file),
   *   so there is no performance benefit from retaining a previous syntax tree.
   * - Instantiating a Parser is cheap; the expensive part (loading the grammar)
   *   is handled once by Node's module cache when the grammar module is imported.
   *
   * Consequence:
   * - Each call to parse() assigns a new Parser to this.parser, eliminating
   *   cross-request state corruption that was causing intermittent
   *   "Error: Invalid argument" failures deep inside tree-sitter.
   */
  protected parser: Parser | undefined;

  abstract readonly name: string;
  abstract readonly fileExtensions: string[];
  abstract readonly mimeTypes: string[];

  /**
   * Optional pre-parse hook (e.g. to set mode flags based on content).
   * Default: no-op.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected preParse(_source: string): void {}

  /**
   * Return the tree-sitter language object to use for this parse.
   * Subclasses must implement.
   */
  protected abstract getLanguage(): TreeSitterLanguage;

  /**
   * Get the structural node types that this parser should extract
   */
  protected abstract getStructuralNodeTypes(): Set<string>;

  /**
   * Extract the name from a structural node
   */
  protected abstract extractNodeName(node: SyntaxNode, source: string): string;

  /**
   * Extract modifiers from a structural node (export, async, etc.)
   */
  protected abstract extractNodeModifiers(node: SyntaxNode, source: string): string[];

  /**
   * Classify a structural node to determine its StructuralNodeType
   */
  protected abstract classifyStructuralNode(node: SyntaxNode): StructuralNodeType;

  /**
   * Extract documentation comments associated with a structural node
   * Includes JSDoc/TSDoc comments and preceding line comments
   */
  /**
   * Extracts documentation comments that precede the given node
   */
  protected extractDocumentationComments(node: SyntaxNode, source: string): string[] {
    const documentation: string[] = [];

    // Get all nodes in the parent to find preceding siblings
    if (!node.parent) return documentation;

    const siblings = node.parent.children;
    const nodeIndex = siblings.indexOf(node);
    if (nodeIndex === -1) return documentation;

    // Look for preceding comments (work backwards from the current node)
    for (let i = nodeIndex - 1; i >= 0; i--) {
      const sibling = siblings[i];

      if (sibling.type === "comment" && this.isDocumentationComment(sibling, source)) {
        // Found a documentation comment - extract its content
        const commentText = source.substring(sibling.startIndex, sibling.endIndex);
        const cleanedComment = this.cleanCommentText(commentText);
        if (cleanedComment.length > 0) {
          documentation.unshift(...cleanedComment);
        }
      } else if (this.isWhitespace(sibling, source)) {
      } else {
        // Hit a non-comment, non-whitespace node - stop looking
        break;
      }
    }

    return documentation;
  }

  /**
   * Cleans comment text by removing comment markers and formatting
   */
  protected cleanCommentText(commentText: string): string[] {
    const lines: string[] = [];

    if (commentText.startsWith("/**") || commentText.startsWith("/*!")) {
      // JSDoc/TSDoc comment
      const content = commentText.slice(3, -2); // Remove /** and */
      const commentLines = content.split("\n");

      for (const line of commentLines) {
        const cleaned = line.replace(/^\s*\*?\s?/, "").trim();
        if (cleaned.length > 0) {
          lines.push(cleaned);
        }
      }
    } else if (commentText.startsWith("/*")) {
      // Multi-line comment
      const content = commentText.slice(2, -2); // Remove /* and */
      const commentLines = content.split("\n");

      for (const line of commentLines) {
        const cleaned = line.trim();
        if (cleaned.length > 0) {
          lines.push(cleaned);
        }
      }
    } else if (commentText.startsWith("//")) {
      // Line comment
      const cleaned = commentText.slice(2).trim();
      if (cleaned.length > 0) {
        lines.push(cleaned);
      }
    }

    return lines;
  }

  /**
   * Determines if a comment node is a documentation comment
   */
  protected isDocumentationComment(node: SyntaxNode, source: string): boolean {
    // Debug logging removed; method kept intentionally minimal for performance.
    if (node.type !== "comment") return false;

    const text = source.substring(node.startIndex, node.endIndex);

    // JSDoc/TSDoc comments
    if (text.startsWith("/**") || text.startsWith("/*!")) return true;

    // Multi-line block comments (only treat as documentation if multi-line)
    if (text.startsWith("/*") && text.includes("\n")) return true;

    // Line comments - treat as documentation if they have some substance
    if (text.startsWith("//")) {
      const content = text.substring(2).trim();
      return content.length > 5;
    }

    return false;
  }

  /**
   * Checks if a node represents only whitespace
   */
  protected isWhitespace(node: SyntaxNode, sourceCode: string): boolean {
    const text = sourceCode.substring(node.startIndex, node.endIndex);
    return /^\s*$/.test(text);
  }

  /**
   * Check if this node should be skipped in favor of its children
   * (e.g., prefer class_declaration over export_statement containing it)
   */
  protected shouldSkipForChildren(
    node: SyntaxNode,
    structuralTypes: Set<string>,
  ): boolean {
    // For export statements, check if they contain higher-priority structural nodes
    if (node.type === "export_statement") {
      for (const child of node.children) {
        if (
          [
            "class_declaration",
            "function_declaration",
            "interface_declaration",
            "type_alias_declaration",
            "enum_declaration",
          ].includes(child.type) &&
          structuralTypes.has(child.type)
        ) {
          return true;
        }
      }
    }

    // For lexical_declaration (const/let), check if it contains an arrow function
    if (node.type === "lexical_declaration") {
      for (const child of node.children) {
        if (child.type === "variable_declarator") {
          const value = child.childForFieldName("value");
          if (value?.type === "arrow_function" && structuralTypes.has("arrow_function")) {
            return true;
          }
        }
      }
    }

    return false;
  }

  /**
   * Parse source code and return parse result
   */
  /**
   * Create a new parser instance (fresh per parse).
   * Subclasses may override if they need specialized construction.
   */
  protected createParser(): Parser {
    return new Parser();
  }

  parse(source: string): ParseResult {
    // Allow subclass to inspect content and set mode flags (e.g. TSX detection)
    this.preParse(source);
    // Fresh parser per call to avoid concurrency/state issues
    this.parser = this.createParser();
    const lang = this.getLanguage();
    // Pass language object directly; language packages already expose the correct native handle.
    this.parser.setLanguage(lang as unknown);
    const tree = this.parser.parse(source);
    const errorNodes = this.findErrorNodes(tree.rootNode);
    return {
      tree,
      hasErrors: errorNodes.length > 0,
      errorNodes,
    };
  }

  /**
   * Extract structural nodes from the parsed tree
   */
  extractStructuralNodes(tree: Tree, source?: string): StructuralNode[] {
    const sourceCode = source || tree.rootNode.text;
    const structuralTypes = this.getStructuralNodeTypes();
    const nodes: StructuralNode[] = [];

    this.traverseNode(tree.rootNode, sourceCode, structuralTypes, nodes, [], []);

    // Sort by line position and remove overlapping nodes
    return this.deduplicateNodes(nodes);
  }

  /**
   * Get the text content of a node
   */
  getNodeText(node: SyntaxNode, source: string): string {
    return source.slice(node.startIndex, node.endIndex);
  }

  /**
   * Get the line range of a node
   */
  getNodeLines(node: SyntaxNode, _source: string): LineRange {
    return {
      startLine: node.startPosition.row + 1, // Convert to 1-indexed
      endLine: node.endPosition.row + 1, // Convert to 1-indexed
    };
  }

  /**
   * Traverse the AST and extract structural nodes
   */
  private traverseNode(
    node: SyntaxNode,
    source: string,
    structuralTypes: Set<string>,
    result: StructuralNode[],
    path: string[],
    inheritedDocs: string[] = [],
  ): void {
    // Check if this node is a structural boundary
    if (structuralTypes.has(node.type)) {
      // Check if we should skip this node in favor of its children
      if (this.shouldSkipForChildren(node, structuralTypes)) {
        // Extract any documentation attached to the wrapper node (e.g. export_statement)
        const wrapperDocs = this.extractDocumentationComments(node, source);
        const combinedInherited =
          wrapperDocs.length > 0 ? [...inheritedDocs, ...wrapperDocs] : inheritedDocs;

        // Skip this node and continue with children, propagating docs
        for (const child of node.children) {
          this.traverseNode(
            child,
            source,
            structuralTypes,
            result,
            path,
            combinedInherited,
          );
        }
        return;
      }

      const structuralNode = this.createStructuralNode(node, source, path, inheritedDocs);
      if (structuralNode) {
        result.push(structuralNode);

        // Update path for children
        const newPath = [...path, structuralNode.name];

        // Process children with updated path
        for (const child of node.children) {
          this.traverseNode(child, source, structuralTypes, result, newPath);
        }
        return;
      }
    }

    // Continue traversing children with same path
    for (const child of node.children) {
      this.traverseNode(child, source, structuralTypes, result, path, inheritedDocs);
    }
  }

  /**
   * Create a structural node from a syntax node
   */
  private createStructuralNode(
    node: SyntaxNode,
    source: string,
    _path: string[],
    inheritedDocs: string[] = [],
  ): StructuralNode | null {
    const name = this.extractNodeName(node, source);
    if (!name) {
      return null;
    }

    const modifiers = this.extractNodeModifiers(node, source);
    const lineRange = this.getNodeLines(node, source);
    const text = this.getNodeText(node, source);
    const indentLevel = this.calculateIndentLevel(text);
    const structuralType = this.classifyStructuralNode(node);
    const ownDocumentation = this.extractDocumentationComments(node, source);

    // Merge inherited documentation (from skipped wrapper like export_statement) with own docs
    const mergedDocs: string[] = [];
    const pushUnique = (arr: string[]) => {
      for (const line of arr) {
        if (!mergedDocs.includes(line)) {
          mergedDocs.push(line);
        }
      }
    };
    if (inheritedDocs.length > 0) pushUnique(inheritedDocs);
    if (ownDocumentation.length > 0) pushUnique(ownDocumentation);

    return {
      type: structuralType,
      name,
      startLine: lineRange.startLine,
      endLine: lineRange.endLine,
      startByte: node.startIndex,
      endByte: node.endIndex,
      children: [],
      text,
      indentLevel,
      modifiers,
      documentation: mergedDocs.length > 0 ? mergedDocs : undefined,
    };
  }

  /**
   * Calculate indentation level from text
   */
  private calculateIndentLevel(text: string): number {
    const firstLine = text.split("\\n")[0];
    const leadingSpaces = firstLine.match(/^\\s*/)?.[0] || "";
    return Math.floor(leadingSpaces.length / 2); // Assuming 2-space indentation
  }

  /**
   * Find error nodes in the tree
   */
  private findErrorNodes(node: SyntaxNode): SyntaxNode[] {
    const errorNodes: SyntaxNode[] = [];

    if (node.hasError) {
      if (node.type === "ERROR") {
        errorNodes.push(node);
      }

      for (const child of node.children) {
        errorNodes.push(...this.findErrorNodes(child));
      }
    }

    return errorNodes;
  }

  /**
   * Remove duplicate nodes and sort by position
   * NOTE: We preserve nested structures (methods within classes) rather than removing them
   */
  private deduplicateNodes(nodes: StructuralNode[]): StructuralNode[] {
    // Sort by start line, then by start byte
    nodes.sort((a, b) => {
      if (a.startLine !== b.startLine) {
        return a.startLine - b.startLine;
      }
      return a.startByte - b.startByte;
    });

    // Remove only exact duplicates (same start/end positions)
    const result: StructuralNode[] = [];
    for (const node of nodes) {
      const isDuplicate = result.some(
        (existing) =>
          existing.startByte === node.startByte &&
          existing.endByte === node.endByte &&
          existing.type === node.type,
      );

      if (!isDuplicate) {
        result.push(node);
      }
    }

    return result;
  }

  /**
   * Single-pass boundary extraction with stateful documentation tracking
   * Creates boundaries directly during traversal, merging contiguous preceding documentation
   */
  extractBoundaries(tree: Tree, source: string): CodeBoundary[] {
    const boundaries: CodeBoundary[] = [];
    const structuralTypes = this.getStructuralNodeTypes();

    // State for tracking pending documentation during traversal
    const traversalState = {
      pendingDocs: [] as { startLine: number; startByte: number; lines: string[] }[],
      path: [] as string[],
      insideSkippedWrapper: false, // Track if we're inside a skipped wrapper node
    };

    this.traverseForBoundaries(
      tree.rootNode,
      source,
      structuralTypes,
      boundaries,
      traversalState,
    );

    return boundaries;
  }

  /**
   * Single-pass traversal that creates boundaries directly, tracking pending documentation
   */
  private traverseForBoundaries(
    node: SyntaxNode,
    source: string,
    structuralTypes: Set<string>,
    boundaries: CodeBoundary[],
    state: {
      pendingDocs: { startLine: number; startByte: number; lines: string[] }[];
      path: string[];
      insideSkippedWrapper: boolean;
    },
  ): void {
    // Handle comments - add to pending documentation
    if (node.type === "comment" && this.isDocumentationComment(node, source)) {
      const commentText = source.substring(node.startIndex, node.endIndex);
      const cleanedLines = this.cleanCommentText(commentText);
      if (cleanedLines.length > 0) {
        state.pendingDocs.push({
          startLine: node.startPosition.row + 1,
          startByte: node.startIndex,
          lines: cleanedLines,
        });
      }
    }
    // Handle whitespace - allow it within documentation blocks
    else if (this.isWhitespace(node, source)) {
      // Whitespace is allowed within pending documentation blocks
    }
    // Handle structural nodes
    else if (structuralTypes.has(node.type)) {
      // Check if we should skip this node in favor of its children (e.g., export_statement)
      if (this.shouldSkipForChildren(node, structuralTypes)) {
        // Mark that we're entering a skipped wrapper
        const wasInsideSkipped = state.insideSkippedWrapper;
        state.insideSkippedWrapper = true;

        // For wrapper nodes, continue traversal with same state (carrying pending docs)
        for (const child of node.children) {
          this.traverseForBoundaries(child, source, structuralTypes, boundaries, state);
        }

        // Restore the skipped wrapper flag
        state.insideSkippedWrapper = wasInsideSkipped;
        return;
      }

      // Create boundary for this structural node
      const boundary = this.createBoundaryFromNode(node, source, state);
      if (boundary) {
        boundaries.push(boundary);
        // Update path for children
        state.path = [...state.path, boundary.name || "anonymous"];
      }

      // Process children with updated path
      for (const child of node.children) {
        this.traverseForBoundaries(child, source, structuralTypes, boundaries, state);
      }

      // Restore path after processing children
      if (boundary?.name) {
        state.path.pop();
      }
      return;
    }
    // Handle other nodes that break documentation continuity
    else if (!this.isWhitespace(node, source) && !state.insideSkippedWrapper) {
      // Non-whitespace, non-comment, non-structural node breaks documentation continuity
      // But don't clear if we're inside a skipped wrapper (like export_statement)
      state.pendingDocs = [];
    }

    // Continue traversal for all children
    for (const child of node.children) {
      this.traverseForBoundaries(child, source, structuralTypes, boundaries, state);
    }
  }

  /**
   * Create a CodeBoundary directly from a syntax node, using pending documentation
   */
  private createBoundaryFromNode(
    node: SyntaxNode,
    source: string,
    state: {
      pendingDocs: { startLine: number; startByte: number; lines: string[] }[];
      path: string[];
    },
  ): CodeBoundary | null {
    const name = this.extractNodeName(node, source);
    if (!name) {
      return null;
    }

    // Determine boundary type
    let type: CodeBoundary["type"];
    const structuralType = this.classifyStructuralNode(node);

    switch (structuralType) {
      case StructuralNodeType.FUNCTION_DECLARATION:
      case StructuralNodeType.ARROW_FUNCTION:
      case StructuralNodeType.METHOD_DEFINITION:
      case StructuralNodeType.CONSTRUCTOR:
        type = "function";
        break;
      case StructuralNodeType.CLASS_DECLARATION:
        type = "class";
        break;
      case StructuralNodeType.INTERFACE_DECLARATION:
      case StructuralNodeType.TYPE_ALIAS_DECLARATION:
        type = "interface";
        break;
      case StructuralNodeType.ENUM_DECLARATION:
        type = "enum";
        break;
      case StructuralNodeType.NAMESPACE_DECLARATION:
      case StructuralNodeType.EXPORT_STATEMENT:
      case StructuralNodeType.IMPORT_STATEMENT:
        type = "module";
        break;
      default:
        type = "other";
        break;
    }

    // Classify boundary as structural or content
    const boundaryType: "structural" | "content" = [
      StructuralNodeType.CLASS_DECLARATION,
      StructuralNodeType.INTERFACE_DECLARATION,
      StructuralNodeType.TYPE_ALIAS_DECLARATION,
      StructuralNodeType.ENUM_DECLARATION,
      StructuralNodeType.NAMESPACE_DECLARATION,
      StructuralNodeType.EXPORT_STATEMENT,
      StructuralNodeType.IMPORT_STATEMENT,
    ].includes(structuralType)
      ? "structural"
      : "content";

    // Calculate boundary positions
    let startLine = node.startPosition.row + 1;
    let startByte = node.startIndex;

    // If we have pending documentation, use its start position
    if (state.pendingDocs.length > 0) {
      const earliestDoc = state.pendingDocs[0];
      startLine = earliestDoc.startLine;
      startByte = earliestDoc.startByte;
      // Clear pending docs after using them
      state.pendingDocs = [];
    }

    return {
      type,
      boundaryType,
      name,
      startLine,
      endLine: node.endPosition.row + 1,
      startByte,
      endByte: node.endIndex,
      parent: undefined, // Will be set later if needed
      path: [...state.path],
      level: state.path.length,
    };
  }
}
