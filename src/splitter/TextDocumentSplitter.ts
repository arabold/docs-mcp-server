/**
 * TextDocumentSplitter - Simple text-based document splitter
 *
 * This splitter provides basic text splitting functionality for plain text files.
 * It uses the TextContentSplitter for hierarchical text splitting with no semantic organization.
 * This is a fallback splitter for any text document that cannot be handled by HTML, Markdown,
 * or Source Code document splitters.
 */

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
      // TextContentSplitter cuts even an unbroken token, so this only runs on
      // an unexpected error. Splitting by character count still keeps every
      // chunk within the maximum size rather than losing the document.
      console.warn(
        `Unexpected text splitting error: ${error instanceof Error ? error.message : String(error)}. Forcing character-based split.`,
      );

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
