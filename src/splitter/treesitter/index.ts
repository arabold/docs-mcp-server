/**
 * TreeSitter-based source code splitting module
 * 
 * This module provides syntax-aware source code splitting using TreeSitter
 * parsers. It includes language-specific parsers and a document splitter
 * that can replace basic line-based splitting for supported languages.
 */

export * from "./types";
export * from "./TreeSitterDocumentSplitter";
export * from "./LanguageParserRegistry";
export * from "./parsers/BaseLanguageParser";
export * from "./parsers/PythonParser";