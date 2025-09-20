/**
 * Simplified standalone TypeScript (and JavaScript) parser.
 *
 * Goals:
 *  - Single, unified parser for .ts/.tsx/.js/.jsx (+ mjs/cjs/mts/cts)
 *  - Direct boundary extraction aligned with canonical ruleset
 *  - Minimal, predictable logic (no complex multi-phase traversals)
 *  - Retain legacy extractStructuralNodes() for existing tests
 *
 * This replaces the previous inheritance-heavy BaseLanguageParser design.
 */

import Parser, { type SyntaxNode, type Tree } from "tree-sitter";
import TypeScript from "tree-sitter-typescript";
import type { CodeBoundary, LanguageParser, ParseResult, StructuralNode } from "./types";
import { StructuralNodeType } from "./types";

/**
 * Helper: language selection (TS vs TSX).
 */
function detectTSX(source: string): boolean {
  // Heuristic: JSX-like tags or React usage
  return /<[A-Za-z][A-Za-z0-9]*\s|<\/[A-Za-z]|React\./.test(source);
}

/**
 * Sets of node types we care about.
 */
const STRUCTURAL_DECL_TYPES = new Set([
  "class_declaration",
  "abstract_class_declaration",
  "interface_declaration",
  "type_alias_declaration",
  "enum_declaration",
  "module_declaration",
  "namespace_declaration",
  "internal_module",
  "import_statement",
  "export_statement",
]);

// Executable / content declarations we also emit
const CONTENT_DECL_TYPES = new Set([
  "function_declaration",
  "method_definition",
  "method_signature",
  "abstract_method_signature",
  "constructor",
  "arrow_function",
  // Only emit arrow-function variables via their variable_declarator to avoid duplicates
  "variable_declarator",
]);

/**
 * Tokens considered modifiers (merged into name for static methods if needed).
 */
const MODIFIER_TOKENS = new Set([
  "export",
  "default",
  "public",
  "private",
  "protected",
  "readonly",
  "abstract",
  "async",
  "static",
]);

/**
 * Decide if node type is boundary-worthy (before suppression rules).
 */
function isCandidateBoundary(node: SyntaxNode): boolean {
  return STRUCTURAL_DECL_TYPES.has(node.type) || CONTENT_DECL_TYPES.has(node.type);
}

/**
 * Determine if a function-like node is a local helper (nested inside another function/method body),
 * in which case we suppress emission (canonical ruleset).
 */
function isLocalHelper(node: SyntaxNode): boolean {
  const functionLike = new Set([
    "function_declaration",
    "arrow_function",
    "method_definition",
    "method_signature",
    "abstract_method_signature",
    "constructor",
  ]);

  let ancestor = node.parent;
  while (ancestor) {
    if (functionLike.has(ancestor.type)) {
      // If ancestor is a class method/constructor and current node is method/constructor,
      // we DO allow emission (method inside class) — only suppress deeper nested function-like inside method bodies.
      if (
        ancestor.type === "method_definition" ||
        ancestor.type === "constructor" ||
        ancestor.type === "function_declaration" ||
        ancestor.type === "arrow_function"
      ) {
        // Current node is nested inside a function/method body -> local helper
        return true;
      }
    }
    // Stop climbing at structural containers where function declarations are allowed as direct members
    if (
      ancestor.type === "class_declaration" ||
      ancestor.type === "abstract_class_declaration" ||
      ancestor.type === "namespace_declaration" ||
      ancestor.type === "module_declaration" ||
      ancestor.type === "internal_module" ||
      ancestor.type === "interface_declaration" ||
      ancestor.type === "enum_declaration"
    ) {
      break;
    }
    ancestor = ancestor.parent;
  }
  return false;
}

/**
 * Extract contiguous documentation (comments + blank lines) preceding a node,
 * crossing transparent export wrappers.
 */
function findDocumentationStart(
  node: SyntaxNode,
  source: string,
): { startLine: number; startByte: number } {
  // If wrapped in export_statement, shift focus to wrapper for doc scan
  let target: SyntaxNode = node;
  if (node.parent && node.parent.type === "export_statement") {
    target = node.parent;
  }

  // Walk backwards among siblings collecting comments/whitespace.
  const parent = target.parent;
  if (!parent) {
    return {
      startLine: target.startPosition.row + 1,
      startByte: target.startIndex,
    };
  }

  const siblings = parent.children;
  const idx = siblings.indexOf(target);
  if (idx === -1) {
    return {
      startLine: target.startPosition.row + 1,
      startByte: target.startIndex,
    };
  }

  let startByte = target.startIndex;
  let startLine = target.startPosition.row + 1;

  // Walk upward collecting contiguous doc comment block.
  // IMPORTANT: Only expand over whitespace that appears AFTER we've seen at least one comment.
  // This prevents pulling in a blank line above the doc block (tests expect the comment line).
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
      // If we haven't yet seen a comment, ignore leading blank lines (do not shift start)
      continue;
    }
    // Hit non-comment code: stop.
    break;
  }

  // Inline doc on same line as declaration (/** ... */ declaration ...)
  // If we didn't already capture a preceding comment node but the same line
  // contains a JSDoc opening before the declaration start, shift start to that line start.
  const lineStartIdx = source.lastIndexOf("\n", target.startIndex - 1) + 1;
  if (lineStartIdx >= 0) {
    const prefix = source.slice(lineStartIdx, target.startIndex);
    if (prefix.includes("/**")) {
      startLine = target.startPosition.row + 1;
      startByte = lineStartIdx;
    }
  }

  return { startLine, startByte };
}

/**
 * Name extraction similar to previous implementation but reduced.
 */
function extractName(node: SyntaxNode): string {
  switch (node.type) {
    case "function_declaration":
    case "class_declaration":
    case "abstract_class_declaration":
    case "interface_declaration":
    case "type_alias_declaration":
    case "enum_declaration":
    case "namespace_declaration":
    case "module_declaration":
    case "internal_module": {
      const nameNode = node.childForFieldName("name");
      return nameNode?.text || `<anonymous_${node.type}>`;
    }
    case "method_definition":
    case "method_signature":
    case "abstract_method_signature": {
      const nameNode = node.childForFieldName("name");
      const isStatic = node.children.some((c) => c.type === "static");
      const base = nameNode?.text || "method";
      return isStatic ? `static ${base}` : base;
    }
    case "constructor":
      return "constructor";
    case "arrow_function": {
      let parent = node.parent;
      while (parent) {
        if (parent.type === "variable_declarator") {
          const nameNode = parent.childForFieldName("name");
          return nameNode?.text || "<anonymous_arrow>";
        }
        parent = parent.parent;
      }
      return "<anonymous_arrow>";
    }
    case "variable_declaration":
    case "lexical_declaration": {
      // If it declares arrow functions, collect their names
      const declarators = node.children.filter((c) => c.type === "variable_declarator");
      const names: string[] = [];
      for (const d of declarators) {
        const value = d.childForFieldName("value");
        if (value?.type === "arrow_function") {
          const nameNode = d.childForFieldName("name");
          if (nameNode) names.push(nameNode.text);
        }
      }
      if (names.length > 0) return names.join(", ");
      return "<variable_declaration>";
    }
    case "variable_declarator": {
      const nameNode = node.childForFieldName("name");
      return nameNode?.text || "<variable>";
    }
    default:
      return node.type;
  }
}

/**
 * Modifier extraction (scan children + backward tokens).
 */
function extractModifiers(node: SyntaxNode): string[] {
  const mods = new Set<string>();
  for (const c of node.children) {
    if (MODIFIER_TOKENS.has(c.type)) mods.add(c.type);
  }
  // Look at preceding siblings for leading modifiers (export/default)
  let prev = node.previousSibling;
  while (prev) {
    if (prev.type === "comment") {
      prev = prev.previousSibling;
      continue;
    }
    if (/^\s*$/.test(prev.text)) {
      prev = prev.previousSibling;
      continue;
    }
    if (MODIFIER_TOKENS.has(prev.type)) {
      mods.add(prev.type);
      prev = prev.previousSibling;
      continue;
    }
    break;
  }
  return Array.from(mods);
}

/**
 * Boundary classification mapping.
 */
function classifyBoundaryKind(node: SyntaxNode): {
  boundaryType: "structural" | "content";
  simple: CodeBoundary["type"];
} {
  if (node.type === "class_declaration" || node.type === "abstract_class_declaration") {
    return { boundaryType: "structural", simple: "class" };
  }
  if (node.type === "interface_declaration" || node.type === "type_alias_declaration") {
    return { boundaryType: "structural", simple: "interface" };
  }
  if (node.type === "enum_declaration") {
    return { boundaryType: "structural", simple: "enum" };
  }
  if (
    node.type === "namespace_declaration" ||
    node.type === "module_declaration" ||
    node.type === "internal_module" ||
    node.type === "export_statement" ||
    node.type === "import_statement"
  ) {
    return { boundaryType: "structural", simple: "module" };
  }
  if (
    node.type === "function_declaration" ||
    node.type === "method_definition" ||
    node.type === "method_signature" ||
    node.type === "abstract_method_signature" ||
    node.type === "constructor" ||
    node.type === "arrow_function" ||
    node.type === "variable_declaration" ||
    node.type === "lexical_declaration" ||
    node.type === "variable_declarator"
  ) {
    return { boundaryType: "content", simple: "function" };
  }
  return { boundaryType: "content", simple: "other" };
}

export class TypeScriptParser implements LanguageParser {
  readonly name = "typescript";

  // Unified extensions: TS + JS
  readonly fileExtensions = [
    ".ts",
    ".tsx",
    ".mts",
    ".cts",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
  ];

  readonly mimeTypes = [
    "text/typescript",
    "application/typescript",
    "text/tsx",
    "application/tsx",
    "text/javascript",
    "application/javascript",
    "text/jsx",
    "application/jsx",
  ];

  private createParser(source: string): Parser {
    const p = new Parser();
    const lang = detectTSX(source)
      ? (TypeScript.tsx as unknown)
      : (TypeScript.typescript as unknown);
    p.setLanguage(lang);
    return p;
  }

  parse(source: string): ParseResult {
    const parser = this.createParser(source);
    const tree = parser.parse(source);
    const errorNodes: SyntaxNode[] = [];
    this.collectErrorNodes(tree.rootNode, errorNodes);
    return {
      tree,
      hasErrors: errorNodes.length > 0,
      errorNodes,
    };
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
        const modifiers = extractModifiers(node);
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
          modifiers,
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
        // Skip wrapper export_statement in favor of its meaningful child(ren)
        if (node.type === "export_statement") {
          for (const c of node.children) walk(c);
          return;
        }

        if (this.shouldSkipStructuralNode(node)) {
          for (const c of node.children) walk(c);
          return;
        }

        // Local helper suppression
        if (
          (node.type === "function_declaration" ||
            node.type === "arrow_function" ||
            node.type === "method_definition" ||
            node.type === "constructor") &&
          isLocalHelper(node)
        ) {
          // Do not emit boundary for local helper
          for (const c of node.children) walk(c);
          return;
        }

        // Suppress arrow_function boundary when parent is variable_declarator (avoid duplicate with variable_declarator)
        if (
          node.type === "arrow_function" &&
          node.parent?.type === "variable_declarator"
        ) {
          for (const c of node.children) walk(c);
          return;
        }

        // Variable declarators: emit if not within function body (local helpers)
        if (node.type === "variable_declarator") {
          if (this.isWithinFunctionLikeBody(node)) {
            for (const c of node.children) walk(c);
            return;
          }
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
   * Determine if a structural node should be skipped in favor of children (transparent wrapper logic).
   * (Reduced compared to previous logic: currently only handles export wrappers already inline.)
   */
  private shouldSkipStructuralNode(_node: SyntaxNode): boolean {
    // Placeholder for future rules (e.g., more wrapper types). Currently we perform
    // explicit export_statement handling inside traversal so always false here.
    return false;
  }

  /**
   * Detect whether a node (e.g., variable_declarator with arrow function) is inside
   * a function/method/constructor body (local helper) before hitting a higher-level
   * structural container (class/namespace/module). Used to suppress local helpers.
   */
  private isWithinFunctionLikeBody(node: SyntaxNode): boolean {
    let ancestor = node.parent;
    while (ancestor) {
      if (
        ancestor.type === "function_declaration" ||
        ancestor.type === "arrow_function" ||
        ancestor.type === "method_definition" ||
        ancestor.type === "constructor"
      ) {
        return true;
      }
      if (
        ancestor.type === "class_declaration" ||
        ancestor.type === "abstract_class_declaration" ||
        ancestor.type === "namespace_declaration" ||
        ancestor.type === "module_declaration" ||
        ancestor.type === "internal_module"
      ) {
        return false;
      }
      ancestor = ancestor.parent;
    }
    return false;
  }

  private classifyStructuralNode(node: SyntaxNode): StructuralNodeType {
    switch (node.type) {
      case "function_declaration":
        return StructuralNodeType.FUNCTION_DECLARATION;
      case "arrow_function":
        return StructuralNodeType.ARROW_FUNCTION;
      case "method_definition":
      case "method_signature":
      case "abstract_method_signature":
        return StructuralNodeType.METHOD_DEFINITION;
      case "constructor":
        return StructuralNodeType.CONSTRUCTOR;
      case "class_declaration":
      case "abstract_class_declaration":
        return StructuralNodeType.CLASS_DECLARATION;
      case "interface_declaration":
        return StructuralNodeType.INTERFACE_DECLARATION;
      case "type_alias_declaration":
        return StructuralNodeType.TYPE_ALIAS_DECLARATION;
      case "enum_declaration":
        return StructuralNodeType.ENUM_DECLARATION;
      case "namespace_declaration":
      case "module_declaration":
      case "internal_module":
        return StructuralNodeType.NAMESPACE_DECLARATION;
      case "import_statement":
        return StructuralNodeType.IMPORT_STATEMENT;
      case "export_statement":
        return StructuralNodeType.EXPORT_STATEMENT;
      case "variable_declaration":
      case "lexical_declaration":
      case "variable_declarator":
        return StructuralNodeType.VARIABLE_DECLARATION;
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
