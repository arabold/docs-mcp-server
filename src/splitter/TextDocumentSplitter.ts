/**
 * TextDocumentSplitter - Simple text-based document splitter
 *
 * This splitter provides basic text splitting functionality for source code and plain text files.
 * It uses line-based splitting with basic hierarchical organization. This serves as a foundation
 * for source code files until a more sophisticated syntax-aware splitter (with TreeSitter) is implemented.
 */

import { MinimumChunkSizeError } from "./errors";
import type { ContentChunk, DocumentSplitter } from "./types";

/**
 * Configuration options for text document splitting
 */
export interface TextDocumentSplitterOptions {
  /** Maximum size for individual chunks */
  maxChunkSize: number;
  /** Minimum lines to include in each chunk when possible */
  minLinesPerChunk: number;
  /** Whether to detect and preserve language from content */
  detectLanguage: boolean;
}

/**
 * Simple document splitter for plain text and source code files.
 * Uses line-based splitting with basic hierarchical organization.
 * Suitable for source code until TreeSitter-based syntax-aware splitting is implemented.
 */
export class TextDocumentSplitter implements DocumentSplitter {
  private options: TextDocumentSplitterOptions;

  constructor(options: Partial<TextDocumentSplitterOptions> = {}) {
    this.options = {
      maxChunkSize: options.maxChunkSize ?? 2000,
      minLinesPerChunk: options.minLinesPerChunk ?? 5,
      detectLanguage: options.detectLanguage ?? true,
    };
  }

  async splitText(content: string, contentType?: string): Promise<ContentChunk[]> {
    if (!content.trim()) {
      return [];
    }

    const lines = content.split("\n");
    const chunks: ContentChunk[] = [];
    let currentChunkLines: string[] = [];
    let chunkIndex = 1;

    // Detect language from content type or content
    const language = this.detectLanguageFromContent(content, contentType);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      currentChunkLines.push(line);

      // Calculate current chunk size
      const currentChunkContent = currentChunkLines.join("\n");
      const currentChunkSize = currentChunkContent.length;

      // Check if we should create a chunk
      const shouldCreateChunk = this.shouldCreateChunk(
        currentChunkSize,
        currentChunkLines.length,
        i === lines.length - 1, // is last line
      );

      if (shouldCreateChunk) {
        // Check if chunk is too large
        if (
          currentChunkSize > this.options.maxChunkSize &&
          currentChunkLines.length > 1
        ) {
          // Remove the last line and create chunk with remaining lines
          const lastLine = currentChunkLines.pop();
          if (!lastLine) continue; // Should not happen due to length check above

          const chunkContent = currentChunkLines.join("\n");

          if (chunkContent.trim()) {
            chunks.push(this.createChunk(chunkContent, chunkIndex, language));
            chunkIndex++;
          }

          // Start new chunk with the last line
          currentChunkLines = [lastLine];
        } else {
          // Create chunk with current content
          if (currentChunkContent.trim()) {
            chunks.push(this.createChunk(currentChunkContent, chunkIndex, language));
            chunkIndex++;
          }
          currentChunkLines = [];
        }
      }
    }

    // Handle remaining lines
    if (currentChunkLines.length > 0) {
      const remainingContent = currentChunkLines.join("\n");
      if (remainingContent.trim()) {
        // Check if this final chunk is too large
        if (remainingContent.length > this.options.maxChunkSize) {
          throw new MinimumChunkSizeError(
            remainingContent.length,
            this.options.maxChunkSize,
          );
        }
        chunks.push(this.createChunk(remainingContent, chunkIndex, language));
      }
    }

    return chunks;
  }

  /**
   * Determines if a chunk should be created based on size and line count
   */
  private shouldCreateChunk(
    currentSize: number,
    currentLineCount: number,
    isLastLine: boolean,
  ): boolean {
    // Always create chunk if it's the last line
    if (isLastLine) {
      return true;
    }

    // Create chunk if we've reached minimum lines and a reasonable size
    if (
      currentLineCount >= this.options.minLinesPerChunk &&
      currentSize >= this.options.maxChunkSize * 0.5
    ) {
      return true;
    }

    // Create chunk if we're approaching max size
    if (currentSize >= this.options.maxChunkSize * 0.8) {
      return true;
    }

    return false;
  }

  /**
   * Creates a ContentChunk with appropriate metadata
   */
  private createChunk(
    content: string,
    chunkIndex: number,
    language?: string,
  ): ContentChunk {
    // Create basic hierarchical path
    const pathElements: string[] = [];

    if (language) {
      pathElements.push(`${language}-file`);
    } else {
      pathElements.push("text-file");
    }

    // Add section identifier
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
   * Attempts to detect programming language from content or content type
   */
  private detectLanguageFromContent(
    content: string,
    contentType?: string,
  ): string | undefined {
    if (!this.options.detectLanguage) {
      return undefined;
    }

    // Try to detect from content type first
    if (contentType) {
      const languageFromMime = this.getLanguageFromMimeType(contentType);
      if (languageFromMime) {
        return languageFromMime;
      }
    }

    // Try to detect from content patterns
    return this.getLanguageFromContentPatterns(content);
  }

  /**
   * Maps MIME types to language names
   */
  private getLanguageFromMimeType(contentType: string): string | undefined {
    const mimeToLanguage: Record<string, string> = {
      "text/javascript": "javascript",
      "application/javascript": "javascript",
      "text/typescript": "typescript",
      "application/typescript": "typescript",
      "text/x-python": "python",
      "application/x-python": "python",
      "text/x-java": "java",
      "text/x-c": "c",
      "text/x-c++": "cpp",
      "text/x-csharp": "csharp",
      "text/x-go": "go",
      "text/x-rust": "rust",
      "text/x-php": "php",
      "text/x-ruby": "ruby",
      "text/x-shell": "bash",
      "application/x-sh": "bash",
    };

    return mimeToLanguage[contentType.toLowerCase()];
  }

  /**
   * Attempts to detect language from content patterns
   */
  private getLanguageFromContentPatterns(content: string): string | undefined {
    const firstLines = content.split("\n").slice(0, 10).join("\n");

    // Check for common patterns
    if (
      firstLines.includes("#!/usr/bin/env python") ||
      firstLines.includes("#!/usr/bin/python")
    ) {
      return "python";
    }
    if (firstLines.includes("#!/bin/bash") || firstLines.includes("#!/usr/bin/bash")) {
      return "bash";
    }
    if (
      firstLines.includes("#!/usr/bin/env node") ||
      firstLines.includes("#!/usr/bin/node")
    ) {
      return "javascript";
    }

    // Check for syntax patterns
    if (
      /import\s+.*\s+from\s+['"]/.test(firstLines) &&
      /export\s+(default\s+)?/.test(firstLines)
    ) {
      return "javascript";
    }
    if (/interface\s+\w+|type\s+\w+\s*=/.test(firstLines)) {
      return "typescript";
    }
    if (/def\s+\w+\s*\(|import\s+\w+|from\s+\w+\s+import/.test(firstLines)) {
      return "python";
    }
    if (/class\s+\w+|public\s+(static\s+)?void\s+main/.test(firstLines)) {
      return "java";
    }
    if (/#include\s*<|int\s+main\s*\(/.test(firstLines)) {
      return "c";
    }

    return undefined;
  }
}
