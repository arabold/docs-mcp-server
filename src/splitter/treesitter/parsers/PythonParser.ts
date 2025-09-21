/**
 * Python parser for tree-sitter based source code splitting.
 *
 * Goals:
 *  - Semantic parsing of Python source code (.py files)
 *  - Direct boundary extraction aligned with canonical ruleset
 *  - Handle Python-specific docstrings (inside function/class bodies)
 *  - Support for functions, classes, methods, and nested structures
 */

import Parser, { type SyntaxNode, type Tree } from "tree-sitter";
import Python from "tree-sitter-python";
import type { CodeBoundary, LanguageParser, ParseResult, StructuralNode } from "./types";
import { StructuralNodeType, TREE_SITTER_SIZE_LIMIT } from "./types";

/**
 * Sets of node types we care about for Python.
 */
const STRUCTURAL_DECL_TYPES = new Set([
  "class_definition",
  "import_statement",
  "import_from_statement",
]);

// Executable / content declarations we also emit
const CONTENT_DECL_TYPES = new Set(["function_definition", "async_function_definition"]);

/**
 * Decide if node type is boundary-worthy (before suppression rules).
 */
function isCandidateBoundary(node: SyntaxNode): boolean {
  return STRUCTURAL_DECL_TYPES.has(node.type) || CONTENT_DECL_TYPES.has(node.type);
}

/**
 * Determine if a function-like node is a local helper (nested inside another function body),
 * in which case we suppress emission (canonical ruleset).
 */
function isLocalHelper(node: SyntaxNode): boolean {
  const functionLike = new Set(["function_definition", "async_function_definition"]);

  let ancestor = node.parent;
  while (ancestor) {
    if (functionLike.has(ancestor.type)) {
      // Current node is nested inside a function body -> local helper
      return true;
    }
    // Stop climbing at structural containers where function declarations are allowed as direct members
    if (ancestor.type === "class_definition" || ancestor.type === "module") {
      break;
    }
    ancestor = ancestor.parent;
  }
  return false;
}

/**
 * Extract Python docstring from function or class body.
 * Python docstrings are string literals as the first statement in the body.
 */
function findDocumentationStart(
  node: SyntaxNode,
  source: string,
): { startLine: number; startByte: number } {
  let startByte = node.startIndex;
  let startLine = node.startPosition.row + 1;

  // For Python, look for docstring inside the function/class body
  if (
    node.type === "function_definition" ||
    node.type === "async_function_definition" ||
    node.type === "class_definition"
  ) {
    // Find the body (block) of the function/class
    const body = node.childForFieldName("body");
    if (body && body.type === "block") {
      const firstChild = body.children.find((child) => child.type !== "newline");

      // Check if first statement is a string (docstring)
      if (firstChild && firstChild.type === "expression_statement") {
        const expr = firstChild.childForFieldName("value") || firstChild.children[0];
        if (expr && expr.type === "string") {
          // We keep the function/class signature as the start, but we'll include
          // the docstring in the content by not adjusting the boundaries here.
          // The docstring will be naturally included in the function body.
        }
      }
    }
  }

  // Look for preceding comments (Python uses # comments, not JSDoc)
  const parent = node.parent;
  if (!parent) {
    return { startLine, startByte };
  }

  const siblings = parent.children;
  const idx = siblings.indexOf(node);
  if (idx === -1) {
    return { startLine, startByte };
  }

  // Walk upward collecting contiguous comment block
  let sawComment = false;
  for (let i = idx - 1; i >= 0; i--) {
    const s = siblings[i];
    const text = source.slice(s.startIndex, s.endIndex);

    if (s.type === "comment") {
      sawComment = true;
      startByte = s.startIndex;
      startLine = s.startPosition.row + 1;
      continue;
    }

    if (/^\s*$/.test(text)) {
      if (sawComment) {
        startByte = s.startIndex;
        startLine = s.startPosition.row + 1;
      }
      continue;
    }

    // Hit non-comment code: stop
    break;
  }

  return { startLine, startByte };
}

/**
 * Name extraction for Python nodes.
 */
function extractName(node: SyntaxNode): string {
  switch (node.type) {
    case "function_definition":
    case "async_function_definition":
    case "class_definition": {
      const nameNode = node.childForFieldName("name");
      return nameNode?.text || `<anonymous_${node.type}>`;
    }
    case "import_statement": {
      // Extract imported module names
      const names: string[] = [];
      const dotted_names = node.children.filter(
        (c) => c.type === "dotted_name" || c.type === "identifier",
      );
      for (const name of dotted_names) {
        names.push(name.text);
      }
      return names.length > 0 ? `import ${names.join(", ")}` : "import";
    }
    case "import_from_statement": {
      const moduleNode = node.childForFieldName("module_name");
      const moduleName = moduleNode?.text || "?";
      return `from ${moduleName}`;
    }
    default:
      return node.type;
  }
}

/**
 * Boundary classification mapping for Python.
 */
function classifyBoundaryKind(node: SyntaxNode): {
  boundaryType: "structural" | "content";
  simple: CodeBoundary["type"];
} {
  if (node.type === "class_definition") {
    return { boundaryType: "structural", simple: "class" };
  }
  if (node.type === "import_statement" || node.type === "import_from_statement") {
    return { boundaryType: "structural", simple: "module" };
  }
  if (node.type === "function_definition" || node.type === "async_function_definition") {
    return { boundaryType: "content", simple: "function" };
  }
  return { boundaryType: "content", simple: "other" };
}

export class PythonParser implements LanguageParser {
  readonly name = "python";
  readonly fileExtensions = [".py", ".pyi", ".pyw"];
  readonly mimeTypes = [
    "text/python",
    "text/x-python",
    "application/python",
    "application/x-python",
  ];

  private createParser(): Parser {
    const parser = new Parser();
    parser.setLanguage(Python as unknown);
    return parser;
  }

  parse(source: string): ParseResult {
    // Validate input
    if (typeof source !== "string") {
      throw new Error(`PythonParser expected string input, got ${typeof source}`);
    }

    if (source == null) {
      throw new Error("PythonParser received null or undefined source");
    }

    // Handle tree-sitter size limit
    if (source.length > TREE_SITTER_SIZE_LIMIT) {
      // For files exceeding the limit, we truncate at a reasonable boundary and return a limited parse
      // Try to find a good truncation point (end of line)
      let truncatedSource = source.slice(0, TREE_SITTER_SIZE_LIMIT);
      const lastNewline = truncatedSource.lastIndexOf("\n");
      if (lastNewline > TREE_SITTER_SIZE_LIMIT * 0.9) {
        // If we can find a newline in the last 10% of the limit, use that
        truncatedSource = source.slice(0, lastNewline + 1);
      }

      try {
        const parser = this.createParser();
        const tree = parser.parse(truncatedSource);
        const errorNodes: SyntaxNode[] = [];
        this.collectErrorNodes(tree.rootNode, errorNodes);

        return {
          tree,
          hasErrors: true, // Mark as having errors due to truncation
          errorNodes,
        };
      } catch (error) {
        throw new Error(
          `Failed to parse truncated Python file (${truncatedSource.length} chars): ${(error as Error).message}`,
        );
      }
    }

    // Normal parsing for files within the size limit
    try {
      const parser = this.createParser();
      const tree = parser.parse(source);
      const errorNodes: SyntaxNode[] = [];
      this.collectErrorNodes(tree.rootNode, errorNodes);

      return {
        tree,
        hasErrors: errorNodes.length > 0,
        errorNodes,
      };
    } catch (error) {
      throw new Error(
        `Failed to parse Python file (${source.length} chars): ${(error as Error).message}`,
      );
    }
  }

  private collectErrorNodes(node: SyntaxNode, acc: SyntaxNode[]): void {
    if (node.hasError && node.type === "ERROR") {
      acc.push(node);
    }
    for (const c of node.children) {
      this.collectErrorNodes(c, acc);
    }
  }

  getNodeText(node: SyntaxNode, source: string): string {
    return source.slice(node.startIndex, node.endIndex);
  }

  getNodeLines(node: SyntaxNode, _source: string) {
    return {
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
    };
  }

  /**
   * Legacy structural node extraction (used by existing tests).
   * Produces a flat list (no parent/child linking beyond simple push).
   */
  extractStructuralNodes(tree: Tree, source?: string): StructuralNode[] {
    const src = source ?? tree.rootNode.text;
    const out: StructuralNode[] = [];
    const structuralTypes = new Set<string>([
      ...STRUCTURAL_DECL_TYPES,
      ...CONTENT_DECL_TYPES,
    ]);

    const visit = (node: SyntaxNode): void => {
      if (structuralTypes.has(node.type)) {
        if (this.shouldSkipStructuralNode(node)) {
          for (const child of node.children) visit(child);
          return;
        }

        const name = extractName(node);
        const { startLine, startByte } = findDocumentationStart(node, src);
        const endLine = node.endPosition.row + 1;
        const structuralNode: StructuralNode = {
          type: this.classifyStructuralNode(node),
          name,
          startLine,
          endLine,
          startByte,
          endByte: node.endIndex,
          children: [],
          text: this.getNodeText(node, src),
          indentLevel: 0,
          modifiers: [],
          documentation: undefined,
        };
        out.push(structuralNode);
        // Continue into children (we keep nested declarations; suppression handled separately)
        for (const child of node.children) visit(child);
        return;
      }
      for (const child of node.children) visit(child);
    };

    visit(tree.rootNode);
    return this.deduplicate(out);
  }

  /**
   * Boundary extraction: produces CodeBoundary[] directly from AST.
   */
  extractBoundaries(tree: Tree, source: string): CodeBoundary[] {
    if (!source.trim()) return [];
    const boundaries: CodeBoundary[] = [];

    const walk = (node: SyntaxNode): void => {
      if (isCandidateBoundary(node)) {
        if (this.shouldSkipStructuralNode(node)) {
          for (const c of node.children) walk(c);
          return;
        }

        // Local helper suppression
        if (
          (node.type === "function_definition" ||
            node.type === "async_function_definition") &&
          isLocalHelper(node)
        ) {
          // Do not emit boundary for local helper
          for (const c of node.children) walk(c);
          return;
        }

        const name = extractName(node);
        const docInfo = findDocumentationStart(node, source);
        const classification = classifyBoundaryKind(node);

        boundaries.push({
          type: classification.simple,
          boundaryType: classification.boundaryType,
          name,
          startLine: docInfo.startLine,
          endLine: node.endPosition.row + 1,
          startByte: docInfo.startByte,
          endByte: node.endIndex,
        });

        // Traverse children (we allow nested boundaries where rules permit)
        for (const c of node.children) walk(c);
        return;
      }

      for (const c of node.children) walk(c);
    };

    walk(tree.rootNode);

    // Deduplicate by start/end/name triple
    const seen = new Set<string>();
    return boundaries.filter((b) => {
      const key = `${b.startByte}:${b.endByte}:${b.name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /**
   * Determine if a structural node should be skipped in favor of children.
   */
  private shouldSkipStructuralNode(_node: SyntaxNode): boolean {
    // Currently no wrapper types to skip in Python
    return false;
  }

  private classifyStructuralNode(node: SyntaxNode): StructuralNodeType {
    switch (node.type) {
      case "function_definition":
      case "async_function_definition":
        return StructuralNodeType.FUNCTION_DECLARATION;
      case "class_definition":
        return StructuralNodeType.CLASS_DECLARATION;
      case "import_statement":
      case "import_from_statement":
        return StructuralNodeType.IMPORT_STATEMENT;
      default:
        return StructuralNodeType.VARIABLE_DECLARATION;
    }
  }

  private deduplicate(nodes: StructuralNode[]): StructuralNode[] {
    const seen = new Set<string>();
    const out: StructuralNode[] = [];
    for (const n of nodes) {
      const key = `${n.startByte}:${n.endByte}:${n.type}:${n.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(n);
    }
    out.sort((a, b) => a.startByte - b.startByte);
    return out;
  }
}
