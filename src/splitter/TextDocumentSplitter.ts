/**
 * TextDocumentSplitter - Simple text-based document splitter
 *
 * This splitter provides basic text splitting functionality for plain text files.
 * It uses the TextContentSplitter for hierarchical text splitting with no semantic organization.
 * This is a fallback splitter for any text document that cannot be handled by HTML, Markdown,
 * or Source Code document splitters.
 */

import { SPLITTER_MAX_CHUNK_SIZE } from "../utils";
import { TextContentSplitter } from "./splitters/TextContentSplitter";
import type { Chunk, DocumentSplitter } from "./types";

/**
 * Configuration options for text document splitting
 */
export interface TextDocumentSplitterOptions {
  /** Maximum size for individual chunks */
  maxChunkSize: number;
}

/**
 * Simple document splitter for plain text files.
 * Uses TextContentSplitter for hierarchical text splitting with no semantic organization.
 * This is a fallback splitter for any text document that cannot be handled by HTML,
 * Markdown, or Source Code document splitters.
 */
export class TextDocumentSplitter implements DocumentSplitter {
  private options: TextDocumentSplitterOptions;
  private textSplitter: TextContentSplitter;

  constructor(options: Partial<TextDocumentSplitterOptions> = {}) {
    this.options = {
      maxChunkSize: options.maxChunkSize ?? SPLITTER_MAX_CHUNK_SIZE,
    };

    this.textSplitter = new TextContentSplitter({
      chunkSize: this.options.maxChunkSize,
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
      // that exceed the maximum size
      const chunks: Chunk[] = [];
      let offset = 0;
      while (offset < content.length) {
        const chunkContent = content.substring(
          offset,
          offset + this.options.maxChunkSize,
        );
        chunks.push({
          types: ["text"] as const,
          content: chunkContent,
          section: {
            level: 0,
            path: [],
          },
        });
        offset += this.options.maxChunkSize;
      }
      return chunks;
    }
  }
}
