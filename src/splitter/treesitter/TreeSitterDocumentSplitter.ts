/**
 * TreeSitterDocumentSplitter - Syntax-aware document splitter using TreeSitter
 *
 * This splitter uses TreeSitter parsers to perform syntax-aware splitting of
 * source code files. It provides hierarchical organization based on code
 * structure (classes, functions, methods) and replaces the basic line-based
 * TextDocumentSplitter for supported languages.
 */

import type { ContentChunk, DocumentSplitter } from "../types";
import { LanguageParserRegistry } from "./LanguageParserRegistry";
import type { TreeSitterSplitterOptions } from "./types";

export class TreeSitterDocumentSplitter implements DocumentSplitter {
  private registry: LanguageParserRegistry;
  private options: TreeSitterSplitterOptions;

  constructor(options: Partial<TreeSitterSplitterOptions> = {}) {
    this.registry = LanguageParserRegistry.getInstance();
    this.options = {
      maxChunkSize: options.maxChunkSize ?? 2000,
      preserveStructure: options.preserveStructure ?? true,
      includeDocumentation: options.includeDocumentation ?? true,
      includeModifiers: options.includeModifiers ?? true,
    };
  }

  /**
   * Split source code text into content chunks using TreeSitter parsing
   */
  async splitText(content: string, contentType?: string): Promise<ContentChunk[]> {
    if (!content.trim()) {
      return [];
    }

    // Find appropriate parser
    const parser = this.findParser(contentType);
    if (!parser) {
      // Fallback to basic splitting if no parser is available
      return this.createFallbackChunks(content, contentType);
    }

    try {
      // Use TreeSitter parser to split the content
      const chunks = await parser.splitText(content, contentType);
      
      // Validate and filter chunks
      return this.validateAndFilterChunks(chunks);
    } catch (error) {
      // If TreeSitter parsing fails, fall back to basic splitting
      console.warn("TreeSitter parsing failed, falling back to basic splitting:", error);
      return this.createFallbackChunks(content, contentType);
    }
  }

  /**
   * Check if TreeSitter parsing is supported for the given content type
   */
  canParseWithTreeSitter(contentType?: string): boolean {
    return this.findParser(contentType) !== null;
  }

  /**
   * Get all supported content types
   */
  getSupportedContentTypes(): string[] {
    return this.registry.getSupportedMimeTypes();
  }

  /**
   * Find the appropriate parser for the given content type
   */
  private findParser(contentType?: string) {
    if (!contentType) {
      return null;
    }

    return this.registry.getParserByMimeType(contentType);
  }

  /**
   * Validate and filter chunks to ensure they meet quality standards
   */
  private validateAndFilterChunks(chunks: ContentChunk[]): ContentChunk[] {
    return chunks.filter((chunk) => {
      // Filter out empty or whitespace-only chunks
      if (!chunk.content.trim()) {
        return false;
      }

      // Filter out chunks that are too large
      if (chunk.content.length > this.options.maxChunkSize * 2) {
        // Chunk is too large even with structure preservation
        return false;
      }

      return true;
    });
  }

  /**
   * Create fallback chunks when TreeSitter parsing is not available
   */
  private createFallbackChunks(content: string, contentType?: string): ContentChunk[] {
    // Simple line-based splitting as fallback
    const lines = content.split("\n");
    const chunks: ContentChunk[] = [];
    let currentChunkLines: string[] = [];
    let chunkIndex = 1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      currentChunkLines.push(line);

      const currentContent = currentChunkLines.join("\n");
      const shouldCreateChunk = 
        currentContent.length >= this.options.maxChunkSize * 0.8 ||
        i === lines.length - 1;

      if (shouldCreateChunk) {
        if (currentContent.trim()) {
          chunks.push(this.createFallbackChunk(currentContent, chunkIndex, contentType));
          chunkIndex++;
        }
        currentChunkLines = [];
      }
    }

    return chunks;
  }

  /**
   * Create a fallback chunk when TreeSitter parsing is not available
   */
  private createFallbackChunk(
    content: string,
    chunkIndex: number,
    contentType?: string
  ): ContentChunk {
    // Try to detect language from content type
    const language = this.detectLanguageFromMimeType(contentType);
    
    const pathElements: string[] = [];
    if (language) {
      pathElements.push(`${language}-file`);
    } else {
      pathElements.push("source-file");
    }
    pathElements.push(`section-${chunkIndex}`);

    return {
      types: ["code"],
      content: content.trim(),
      section: {
        level: pathElements.length,
        path: pathElements,
      },
    };
  }

  /**
   * Detect programming language from MIME type
   */
  private detectLanguageFromMimeType(contentType?: string): string | undefined {
    if (!contentType) return undefined;

    // Use existing mime type mapping logic
    const mimeToLanguage: Record<string, string> = {
      "text/x-python": "python",
      "application/x-python": "python",
      "text/x-typescript": "typescript",
      "text/javascript": "javascript",
      "application/javascript": "javascript",
      "text/x-java": "java",
      "text/x-c": "c",
      "text/x-c++": "cpp",
      "text/x-go": "go",
      "text/x-rust": "rust",
    };

    return mimeToLanguage[contentType.toLowerCase()];
  }
}