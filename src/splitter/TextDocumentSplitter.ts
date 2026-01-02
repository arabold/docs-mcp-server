/**
 * TextDocumentSplitter - Simple text-based document splitter
 *
 * This splitter provides basic text splitting functionality for plain text files.
 * It uses the TextContentSplitter for hierarchical text splitting with no semantic organization.
 * This is a fallback splitter for any text document that cannot be handled by HTML, Markdown,
 * or Source Code document splitters.
 */

import { MinimumChunkSizeError } from "./errors";
import { TextContentSplitter } from "./splitters/TextContentSplitter";
import type { Chunk, DocumentSplitter, SplitterConfig } from "./types";

/**
 * Simple document splitter for plain text files.
 * Uses TextContentSplitter for hierarchical text splitting with no semantic organization.
 * This is a fallback splitter for any text document that cannot be handled by HTML,
 * Markdown, or Source Code document splitters.
 */
export class TextDocumentSplitter implements DocumentSplitter {
  private config: SplitterConfig;
  private textSplitter: TextContentSplitter;

  constructor(config: SplitterConfig) {
    this.config = config;

    this.textSplitter = new TextContentSplitter({
      chunkSize: this.config.maxChunkSize,
    });
  }

  async splitText(content: string): Promise<Chunk[]> {
    if (!content.trim()) {
      return [];
    }

    try {
      // Split the text content into chunks
      const chunks = await this.textSplitter.split(content);

      // Convert string chunks to ContentChunk objects
      return chunks.map((chunk) => ({
        types: ["text"] as const,
        content: chunk,
        section: {
          level: 0,
          path: [],
        },
      }));
    } catch (error) {
      // If splitting fails due to minimum chunk size error (e.g., a very long word/token),
      // forcefully split the content by character count to ensure we never return chunks
      // that exceed the maximum size. This is a last resort to handle unsplittable content
      // like very long strings without spaces or newlines.

      // For MinimumChunkSizeError or other text splitting errors, forcefully split by character count
      if (!(error instanceof MinimumChunkSizeError) && error instanceof Error) {
        // Log unexpected errors but still proceed with forceful splitting to avoid data loss
        console.warn(
          `Unexpected text splitting error: ${error.message}. Forcing character-based split.`,
        );
      }

      const chunks: Chunk[] = [];
      let offset = 0;
      while (offset < content.length) {
        const chunkContent = content.substring(offset, offset + this.config.maxChunkSize);
        chunks.push({
          types: ["text"] as const,
          content: chunkContent,
          section: {
            level: 0,
            path: [],
          },
        });
        offset += this.config.maxChunkSize;
      }
      return chunks;
    }
  }
}
