/**
 * LanguageParserRegistry - Registry for tree-sitter language parsers
 *
 * Manages available language parsers and provides parser selection
 * based on file extensions and MIME types.
 */

import { defaults } from "../../utils/config";
import { PythonParser } from "./parsers/PythonParser";
import { TypeScriptParser } from "./parsers/TypeScriptParser";
import type { LanguageParser } from "./parsers/types";

export class LanguageParserRegistry {
  private parsers = new Map<string, LanguageParser>();
  private extensionMap = new Map<string, string>();
  private mimeTypeMap = new Map<string, string>();
  private readonly treeSitterSizeLimit: number;

  constructor(treeSitterSizeLimit: number = defaults.splitter.treeSitterSizeLimit) {
    this.treeSitterSizeLimit = treeSitterSizeLimit;
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

  private initializeParsers(): void {
    const limit = this.treeSitterSizeLimit;

    // Unified TypeScript parser handles the full TS/JS family.
    const unified = new TypeScriptParser(limit);
    this.registerParser(unified); // registers under 'typescript' with all extensions & MIME types

    // Register Python parser
    const pythonParser = new PythonParser(limit);
    this.registerParser(pythonParser);
  }
}
