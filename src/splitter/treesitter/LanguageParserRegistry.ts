/**
 * LanguageParserRegistry - Registry for tree-sitter language parsers
 *
 * Manages available language parsers and provides parser selection
 * based on file extensions and MIME types.
 */

import { JavaScriptParser } from "./parsers/JavaScriptParser";
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
    // Register JavaScript parser
    this.registerParser(new JavaScriptParser());

    // Register TypeScript parser
    this.registerParser(new TypeScriptParser());
  }
}
