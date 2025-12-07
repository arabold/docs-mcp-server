/**
 * Type definitions for tree-sitter based parsers
 */

import type { SyntaxNode, Tree } from "tree-sitter";
import { PARSER_TREE_SITTER_SIZE_LIMIT } from "../../../utils/config";

/**
 * Universal tree-sitter parser size limit.
 * Set to 30,000 characters to be safely under the observed 32,767 limit.
 */
export { PARSER_TREE_SITTER_SIZE_LIMIT };

export enum StructuralNodeType {
  // Function declarations
  FUNCTION_DECLARATION = "function_declaration",
  ARROW_FUNCTION = "arrow_function",
  METHOD_DEFINITION = "method_definition",
  CONSTRUCTOR = "constructor",

  // Class and object structures
  CLASS_DECLARATION = "class_declaration",
  OBJECT_EXPRESSION = "object_expression",

  // TypeScript specific
  INTERFACE_DECLARATION = "interface_declaration",
  TYPE_ALIAS_DECLARATION = "type_alias_declaration",
  NAMESPACE_DECLARATION = "namespace_declaration",
  ENUM_DECLARATION = "enum_declaration",

  // JSX specific
  JSX_ELEMENT = "jsx_element",
  JSX_FRAGMENT = "jsx_fragment",
  JSX_EXPRESSION = "jsx_expression",

  // Module level
  VARIABLE_DECLARATION = "variable_declaration", // for const/let functions
  EXPORT_STATEMENT = "export_statement",
  IMPORT_STATEMENT = "import_statement",

  // Control structures (for content sections)
  IF_STATEMENT = "if_statement",
  FOR_STATEMENT = "for_statement",
  WHILE_STATEMENT = "while_statement",
  SWITCH_STATEMENT = "switch_statement",
}

export interface ParseResult {
  tree: Tree;
  hasErrors: boolean;
  errorNodes: SyntaxNode[];
}

export interface StructuralNode {
  type: StructuralNodeType;
  name: string;
  startLine: number;
  endLine: number;
  startByte: number;
  endByte: number;
  children: StructuralNode[];
  text: string;
  indentLevel: number;
  modifiers: string[];
  documentation?: string[]; // JSDoc/TSDoc and preceding comments
}

export interface LineRange {
  startLine: number;
  endLine: number;
}

/**
 * Simplified boundary interface for focused chunk generation
 * This is what we actually need for semantic splitting
 */
export interface CodeBoundary {
  /** Simple boundary type for context */
  type: "function" | "class" | "interface" | "enum" | "module" | "other";
  /** Classification for downstream chunk typing */
  boundaryType: "structural" | "content";
  /** Optional simple name for debugging/context */
  name?: string;
  /** Start position in the source (1-indexed line) */
  startLine: number;
  /** End position in the source (1-indexed line) */
  endLine: number;
  /** Start byte offset in the source */
  startByte: number;
  /** End byte offset in the source */
  endByte: number;
  /** Parent boundary for building hierarchical paths */
  parent?: CodeBoundary;
  /** Hierarchical path built from parent chain */
  path?: string[];
  /** Level in the hierarchy (calculated from path length) */
  level?: number;
}

/**
 * Result of parsing source code for boundaries
 */
export interface BoundaryParseResult {
  /** List of code boundaries found */
  boundaries: CodeBoundary[];
  /** Whether parsing had errors (but may still have partial results) */
  hasErrors: boolean;
}

export interface LanguageParser {
  readonly name: string;
  readonly fileExtensions: string[];
  readonly mimeTypes: string[];

  parse(source: string): ParseResult;
  extractStructuralNodes(tree: Tree, source?: string): StructuralNode[];
  getNodeText(node: SyntaxNode, source: string): string;
  getNodeLines(node: SyntaxNode, source: string): LineRange;

  /** NEW: Simplified boundary extraction for focused chunking */
  extractBoundaries(tree: Tree, source: string): CodeBoundary[];
}
