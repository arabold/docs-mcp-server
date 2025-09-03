/**
 * BaseLanguageParser - Abstract base class for tree-sitter language parsers
 */

import Parser, { type SyntaxNode, type Tree } from "tree-sitter";
import type {
  CodeBoundary,
  LanguageParser,
  LineRange,
  ParseResult,
  StructuralNode,
} from "./types";
import { StructuralNodeType } from "./types";

export abstract class BaseLanguageParser implements LanguageParser {
  protected parser: Parser;

  constructor() {
    this.parser = new Parser();
    this.setupLanguage();
  }

  abstract readonly name: string;
  abstract readonly fileExtensions: string[];
  abstract readonly mimeTypes: string[];

  /**
   * Setup the language grammar for this parser
   */
  protected abstract setupLanguage(): void;

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
    if (node.type !== "comment") {
      if (source.includes("function add")) {
        console.log("    isDocumentationComment: not a comment node, returning false");
      }
      return false;
    }

    const text = source.substring(node.startIndex, node.endIndex);

    if (source.includes("function add")) {
      console.log("    isDocumentationComment: checking text:", JSON.stringify(text));
    }

    // JSDoc/TSDoc comments
    if (text.startsWith("/**") || text.startsWith("/*!")) {
      if (source.includes("function add")) {
        console.log(
          "    isDocumentationComment: JSDoc/TSDoc comment found, returning true",
        );
      }
      return true;
    }

    // Multi-line comments that might be documentation
    if (text.startsWith("/*") && text.includes("\n")) {
      if (source.includes("function add")) {
        console.log(
          "    isDocumentationComment: multi-line comment found, returning true",
        );
      }
      return true;
    }

    // Line comments - consider them documentation if they're substantial
    if (text.startsWith("//")) {
      const content = text.substring(2).trim();
      const result = content.length > 5; // Lower threshold for line comments
      if (source.includes("function add")) {
        console.log(
          "    isDocumentationComment: line comment, content length:",
          content.length,
          "returning:",
          result,
        );
      }
      return result;
    }

    if (source.includes("function add")) {
      console.log("    isDocumentationComment: no match, returning false");
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
  parse(source: string): ParseResult {
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

    this.traverseNode(tree.rootNode, sourceCode, structuralTypes, nodes, []);

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
  ): void {
    // Check if this node is a structural boundary
    if (structuralTypes.has(node.type)) {
      // Check if we should skip this node in favor of its children
      if (this.shouldSkipForChildren(node, structuralTypes)) {
        // Skip this node and continue with children
        for (const child of node.children) {
          this.traverseNode(child, source, structuralTypes, result, path);
        }
        return;
      }

      const structuralNode = this.createStructuralNode(node, source, path);
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
      this.traverseNode(child, source, structuralTypes, result, path);
    }
  }

  /**
   * Create a structural node from a syntax node
   */
  private createStructuralNode(
    node: SyntaxNode,
    source: string,
    _path: string[],
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
    const documentation = this.extractDocumentationComments(node, source);

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
      documentation: documentation.length > 0 ? documentation : undefined,
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
   * NEW: Simplified boundary extraction for focused chunking with hierarchical paths
   * Converts complex structural analysis to simple semantic boundaries with parent-child relationships
   */
  extractBoundaries(tree: Tree, source: string): CodeBoundary[] {
    // Extract structural nodes first
    const structuralNodes = this.extractStructuralNodes(tree, source);

    // Convert to boundaries with hierarchy, passing tree and source for comment resolution
    const boundaries = this.buildHierarchicalBoundaries(structuralNodes, tree, source);

    return boundaries;
  }

  /**
   * Build hierarchical boundaries from structural nodes, preserving parent-child relationships
   */
  private buildHierarchicalBoundaries(
    structuralNodes: StructuralNode[],
    tree: Tree,
    source: string,
  ): CodeBoundary[] {
    const boundaries: CodeBoundary[] = [];
    const nodeToParentMap = new Map<StructuralNode, StructuralNode>();

    // First pass: identify parent-child relationships based on position containment
    for (let i = 0; i < structuralNodes.length; i++) {
      const node = structuralNodes[i];
      let parent: StructuralNode | undefined;

      // Find the smallest containing parent
      for (let j = 0; j < structuralNodes.length; j++) {
        if (i === j) continue;
        const candidate = structuralNodes[j];

        // Check if candidate contains node
        if (
          candidate.startLine <= node.startLine &&
          candidate.endLine >= node.endLine &&
          candidate.startByte <= node.startByte &&
          candidate.endByte >= node.endByte
        ) {
          // If we don't have a parent yet, or this candidate is smaller than current parent
          if (
            !parent ||
            (candidate.startLine >= parent.startLine &&
              candidate.endLine <= parent.endLine)
          ) {
            parent = candidate;
          }
        }
      }

      if (parent) {
        nodeToParentMap.set(node, parent);
      }
    }

    // Second pass: create boundaries with hierarchical information
    const nodeToBoundaryMap = new Map<StructuralNode, CodeBoundary>();

    for (const node of structuralNodes) {
      const boundary = this.convertToBoundary(node, tree, source);

      // Find parent boundary if exists
      const parentNode = nodeToParentMap.get(node);
      if (parentNode) {
        boundary.parent = nodeToBoundaryMap.get(parentNode);
      }

      // Build hierarchical path
      boundary.path = this.buildBoundaryPath(boundary);
      boundary.level = boundary.path.length;

      nodeToBoundaryMap.set(node, boundary);
      boundaries.push(boundary);
    }

    return boundaries;
  }

  /**
   * Build hierarchical path for a boundary by walking up the parent chain
   */
  private buildBoundaryPath(boundary: CodeBoundary): string[] {
    const path: string[] = [];
    let current: CodeBoundary | undefined = boundary;

    // Walk up the parent chain
    while (current) {
      if (current.name) {
        path.unshift(current.name); // Add to beginning to build path from root
      }
      current = current.parent;
    }

    return path;
  }

  /**
   * Convert a complex StructuralNode to a simple CodeBoundary
   */
  private convertToBoundary(
    node: StructuralNode,
    tree: Tree,
    source: string,
  ): CodeBoundary {
    // Map complex StructuralNodeType to simple boundary types
    let type: CodeBoundary["type"];

    switch (node.type) {
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

    // For functions with documentation, adjust start position to include preceding comments
    let adjustedStartLine = node.startLine;
    let adjustedStartByte = node.startByte;

    if (
      (type === "function" || type === "class") &&
      node.documentation &&
      node.documentation.length > 0
    ) {
      // Find the start of the documentation in the source
      const docStartPosition = this.findDocumentationStart(node, tree, source);
      if (docStartPosition) {
        adjustedStartLine = docStartPosition.startLine;
        adjustedStartByte = docStartPosition.startByte;
      }
    }

    return {
      type,
      name: node.name || undefined,
      startLine: adjustedStartLine,
      endLine: node.endLine,
      startByte: adjustedStartByte,
      endByte: node.endByte,
      parent: undefined, // Will be set during hierarchy building
      path: undefined, // Will be set during hierarchy building
      level: undefined, // Will be set during hierarchy building
    };
  }

  /**
   * Find the start position of documentation comments for a structural node
   * Uses the tree to locate the actual comment nodes that precede the function
   */
  private findDocumentationStart(
    node: StructuralNode,
    tree: Tree,
    source: string,
  ): { startLine: number; startByte: number } | null {
    if (!node.documentation || node.documentation.length === 0) {
      return null;
    }

    // Find the tree node that corresponds to this structural node
    const treeNode = this.findTreeNode(tree.rootNode, node, source);
    if (!treeNode || !treeNode.parent) {
      return null;
    }

    // Look for preceding comment nodes in the parent
    const siblings = treeNode.parent.children;
    const nodeIndex = siblings.indexOf(treeNode);
    if (nodeIndex <= 0) {
      return null;
    }

    // Search backwards for the first JSDoc comment
    for (let i = nodeIndex - 1; i >= 0; i--) {
      const sibling = siblings[i];

      if (sibling.type === "comment") {
        const commentText = source.substring(sibling.startIndex, sibling.endIndex);
        if (commentText.trim().startsWith("/**")) {
          // Found the JSDoc comment start
          return {
            startLine: sibling.startPosition.row + 1, // Convert to 1-indexed
            startByte: sibling.startIndex,
          };
        }
      } else if (!this.isWhitespace(sibling, source)) {
        // Hit a non-comment, non-whitespace node - stop looking
        break;
      }
    }

    return null;
  }

  /**
   * Find the tree node that corresponds to a structural node
   */
  private findTreeNode(
    root: SyntaxNode,
    structuralNode: StructuralNode,
    source: string,
  ): SyntaxNode | null {
    // Simple approach: find a node that matches the structural node's position and type
    const candidates: SyntaxNode[] = [];
    this.collectNodesByPosition(
      root,
      structuralNode.startByte,
      structuralNode.endByte,
      candidates,
    );

    // Find the best match - prefer exact type matches
    for (const candidate of candidates) {
      const structuralType = this.classifyStructuralNode(candidate);
      if (structuralType === structuralNode.type) {
        const name = this.extractNodeName(candidate, source);
        if (name === structuralNode.name) {
          return candidate;
        }
      }
    }

    // Fallback to first candidate with matching position
    return candidates[0] || null;
  }

  /**
   * Collect tree nodes that match the given byte range
   */
  private collectNodesByPosition(
    node: SyntaxNode,
    startByte: number,
    endByte: number,
    candidates: SyntaxNode[],
  ): void {
    if (node.startIndex === startByte && node.endIndex === endByte) {
      candidates.push(node);
    }

    // Also check children
    for (const child of node.children) {
      this.collectNodesByPosition(child, startByte, endByte, candidates);
    }
  }
}
