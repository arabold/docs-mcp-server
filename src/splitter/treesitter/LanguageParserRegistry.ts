/**
 * LanguageParserRegistry - Registry for TreeSitter language parsers
 *
 * This registry manages the available language parsers for different programming
 * languages. It provides methods to register parsers and find the appropriate
 * parser for a given file extension or MIME type.
 */

import type { BaseLanguageParser } from "./parsers/BaseLanguageParser";
import { PythonParser } from "./parsers/PythonParser";

export class LanguageParserRegistry {
  private parsers: BaseLanguageParser[] = [];
  private static instance: LanguageParserRegistry | null = null;

  constructor() {
    this.registerDefaultParsers();
  }

  /**
   * Get the singleton instance of the registry
   */
  static getInstance(): LanguageParserRegistry {
    if (!LanguageParserRegistry.instance) {
      LanguageParserRegistry.instance = new LanguageParserRegistry();
    }
    return LanguageParserRegistry.instance;
  }

  /**
   * Register the default language parsers
   */
  private registerDefaultParsers(): void {
    this.registerParser(new PythonParser());
  }

  /**
   * Register a language parser
   */
  registerParser(parser: BaseLanguageParser): void {
    this.parsers.push(parser);
  }

  /**
   * Get a parser for the given file extension
   */
  getParserByExtension(extension: string): BaseLanguageParser | null {
    let normalizedExt = extension.toLowerCase();
    if (!normalizedExt.startsWith(".")) {
      normalizedExt = "." + normalizedExt;
    }

    for (const parser of this.parsers) {
      const langDef = parser.getLanguageDefinition();
      if (langDef.extensions.includes(normalizedExt)) {
        return parser;
      }
    }

    return null;
  }

  /**
   * Get a parser for the given MIME type
   */
  getParserByMimeType(mimeType: string): BaseLanguageParser | null {
    const normalizedMimeType = mimeType.toLowerCase();

    for (const parser of this.parsers) {
      const langDef = parser.getLanguageDefinition();
      if (langDef.mimeTypes.includes(normalizedMimeType)) {
        return parser;
      }
    }

    return null;
  }

  /**
   * Get a parser for the given file path
   */
  getParserByFilePath(filePath: string): BaseLanguageParser | null {
    const extension = this.extractExtension(filePath);
    return extension ? this.getParserByExtension(extension) : null;
  }

  /**
   * Get all registered parsers
   */
  getAllParsers(): BaseLanguageParser[] {
    return [...this.parsers];
  }

  /**
   * Get all supported extensions
   */
  getSupportedExtensions(): string[] {
    const extensions = new Set<string>();
    
    for (const parser of this.parsers) {
      const langDef = parser.getLanguageDefinition();
      for (const ext of langDef.extensions) {
        extensions.add(ext);
      }
    }

    return Array.from(extensions).sort();
  }

  /**
   * Get all supported MIME types
   */
  getSupportedMimeTypes(): string[] {
    const mimeTypes = new Set<string>();
    
    for (const parser of this.parsers) {
      const langDef = parser.getLanguageDefinition();
      for (const mimeType of langDef.mimeTypes) {
        mimeTypes.add(mimeType);
      }
    }

    return Array.from(mimeTypes).sort();
  }

  /**
   * Check if a file extension is supported
   */
  isExtensionSupported(extension: string): boolean {
    return this.getParserByExtension(extension) !== null;
  }

  /**
   * Check if a MIME type is supported
   */
  isMimeTypeSupported(mimeType: string): boolean {
    return this.getParserByMimeType(mimeType) !== null;
  }

  /**
   * Extract file extension from a file path
   */
  private extractExtension(filePath: string): string | null {
    const lastDotIndex = filePath.lastIndexOf(".");
    if (lastDotIndex === -1 || lastDotIndex === filePath.length - 1) {
      return null;
    }
    return filePath.substring(lastDotIndex);
  }
}