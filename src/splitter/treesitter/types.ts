/**
 * TreeSitter-based source code splitting types and interfaces
 * 
 * This module defines the core types used for syntax-aware source code splitting
 * using TreeSitter parsers. It provides structured node identification and 
 * hierarchical code organization capabilities.
 */

/**
 * Structural node types that represent different code constructs
 */
export enum StructuralNodeType {
  CLASS = "class",
  FUNCTION = "function", 
  METHOD = "method",
  INTERFACE = "interface",
  ENUM = "enum",
  NAMESPACE = "namespace",
  MODULE = "module",
  VARIABLE = "variable",
  CONSTANT = "constant",
  PROPERTY = "property",
  TYPE_ALIAS = "type_alias",
  IMPORT = "import",
  EXPORT = "export",
}

/**
 * Represents a node in the source code AST with extracted metadata
 */
export interface StructuralNode {
  /** The type of structural node */
  type: StructuralNodeType;
  /** The name/identifier of the node */
  name: string;
  /** Modifiers like public, private, static, async, etc. */
  modifiers: string[];
  /** Start position in the source code */
  startPosition: { row: number; column: number };
  /** End position in the source code */
  endPosition: { row: number; column: number };
  /** Associated documentation/comments */
  documentation?: string;
  /** Child nodes (for nested structures) */
  children: StructuralNode[];
  /** The raw TreeSitter node */
  node: any; // tree-sitter Node type
}

/**
 * Language definition for TreeSitter parsing
 */
export interface LanguageDefinition {
  /** Language name */
  name: string;
  /** File extensions this language handles */
  extensions: string[];
  /** MIME types this language handles */
  mimeTypes: string[];
}

/**
 * Configuration for TreeSitter document splitting
 */
export interface TreeSitterSplitterOptions {
  /** Maximum size for individual chunks */
  maxChunkSize: number;
  /** Whether to preserve complete functions/classes when possible */
  preserveStructure: boolean;
  /** Whether to include documentation in chunks */
  includeDocumentation: boolean;
  /** Whether to include modifiers in chunk metadata */
  includeModifiers: boolean;
}