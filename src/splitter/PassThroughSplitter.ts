import type { ContentChunk, DocumentSplitter } from "./types";

/**
 * A pass-through splitter that doesn't perform any splitting.
 * Used when content has already been split by pipelines and we just need
 * to satisfy the DocumentSplitter interface requirement.
 */
export class PassThroughSplitter implements DocumentSplitter {
  async splitText(text: string): Promise<ContentChunk[]> {
    // Return a single chunk as-is since content is already processed
    return [
      {
        types: ["text"],
        content: text,
        section: {
          level: 1,
          path: ["Document"],
        },
      },
    ];
  }
}
