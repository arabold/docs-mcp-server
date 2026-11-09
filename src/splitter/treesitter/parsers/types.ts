/**
 * Type definitions for tree-sitter based parsers
 */

import type { SyntaxNode, Tree } from "tree-sitter";

export interface ParseResult {
  tree: Tree;
  hasErrors: boolean;
  errorNodes: SyntaxNode[];
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

  /** NEW: Simplified boundary extraction for focused chunking */
  extractBoundaries(tree: Tree, source: string): CodeBoundary[];
}
