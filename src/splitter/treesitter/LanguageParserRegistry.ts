/**
 * LanguageParserRegistry - Registry for tree-sitter language parsers
 *
 * Manages available language parsers and provides parser selection
 * based on file extensions and MIME types.
 */

import { PythonParser } from "./parsers/PythonParser";
import { TypeScriptParser } from "./parsers/TypeScriptParser";
import type { LanguageParser } from "./parsers/types";

export class LanguageParserRegistry {
  private parsers = new Map<string, LanguageParser>();
  private extensionMap = new Map<string, string>();
  private mimeTypeMap = new Map<string, string>();

  constructor() {
    this.initializeParsers();
  }

  /**
   * Get a parser by language name
   */
  getParser(language: string): LanguageParser | undefined {
    return this.parsers.get(language);
  }

  /**
   * Get a parser by file extension
   */
  getParserByExtension(extension: string): LanguageParser | undefined {
    const language = this.extensionMap.get(extension.toLowerCase());
    return language ? this.parsers.get(language) : undefined;
  }

  /**
   * Get a parser by MIME type
   */
  getParserByMimeType(mimeType: string): LanguageParser | undefined {
    const language = this.mimeTypeMap.get(mimeType.toLowerCase());
    return language ? this.parsers.get(language) : undefined;
  }

  /**
   * Check if a language is supported
   */
  isLanguageSupported(language: string): boolean {
    return this.parsers.has(language);
  }

  /**
   * Check if a file extension is supported
   */
  isExtensionSupported(extension: string): boolean {
    return this.extensionMap.has(extension.toLowerCase());
  }

  /**
   * Check if a MIME type is supported
   */
  isMimeTypeSupported(mimeType: string): boolean {
    return this.mimeTypeMap.has(mimeType.toLowerCase());
  }

  /**
   * Get all supported languages
   */
  getSupportedLanguages(): string[] {
    return Array.from(this.parsers.keys());
  }

  /**
   * Get all supported file extensions
   */
  getSupportedExtensions(): string[] {
    return Array.from(this.extensionMap.keys());
  }

  /**
   * Get all supported MIME types
   */
  getSupportedMimeTypes(): string[] {
    return Array.from(this.mimeTypeMap.keys());
  }

  /**
   * Register a new parser
   */
  registerParser(parser: LanguageParser): void {
    this.parsers.set(parser.name, parser);

    // Register file extensions
    for (const extension of parser.fileExtensions) {
      this.extensionMap.set(extension.toLowerCase(), parser.name);
    }

    // Register MIME types
    for (const mimeType of parser.mimeTypes) {
      this.mimeTypeMap.set(mimeType.toLowerCase(), parser.name);
    }
  }

  /**
   * Initialize built-in parsers
   */
  private initializeParsers(): void {
    // Unified TypeScript parser handles the full TS/JS family.
    const unified = new TypeScriptParser();
    this.registerParser(unified); // registers under 'typescript' with all extensions & MIME types

    // Create a bound alias object with name 'javascript' so tests expecting parser.name === 'javascript' pass.
    // We DO NOT call registerParser() again (would overwrite extension mappings); instead we:
    //  1. Provide a proxy parser entry named 'javascript'
    //  2. Remap JS-specific extensions & MIME types to that alias
    const jsAlias: LanguageParser = {
      ...unified,
      name: "javascript",
      // Bind methods to the original instance to retain internal behavior.
      parse: unified.parse.bind(unified),
      extractStructuralNodes: unified.extractStructuralNodes.bind(unified),
      getNodeText: unified.getNodeText.bind(unified),
      getNodeLines: unified.getNodeLines.bind(unified),
      extractBoundaries: unified.extractBoundaries.bind(unified),
      // Narrow advertised extensions/mime types for the alias (informational only).
      fileExtensions: [".js", ".jsx", ".mjs", ".cjs"],
      mimeTypes: [
        "text/javascript",
        "application/javascript",
        "text/jsx",
        "application/jsx",
      ],
    };
    this.parsers.set("javascript", jsAlias);

    // Remap JS-related extensions & MIME types to point to the 'javascript' alias so lookups yield alias name.
    const jsExts = [".js", ".jsx", ".mjs", ".cjs"];
    for (const ext of jsExts) {
      this.extensionMap.set(ext.toLowerCase(), "javascript");
    }
    const jsMimes = [
      "text/javascript",
      "application/javascript",
      "text/jsx",
      "application/jsx",
    ];
    for (const mt of jsMimes) {
      this.mimeTypeMap.set(mt.toLowerCase(), "javascript");
    }

    // Register Python parser
    const pythonParser = new PythonParser();
    this.registerParser(pythonParser);
  }
}
