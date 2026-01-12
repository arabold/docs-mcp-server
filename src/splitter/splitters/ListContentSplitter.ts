import { TextContentSplitter } from "./TextContentSplitter";
import type { ContentSplitter, ContentSplitterOptions } from "./types";

export class ListContentSplitter implements ContentSplitter {
  private textSplitter: TextContentSplitter;

  constructor(private options: ContentSplitterOptions) {
    this.textSplitter = new TextContentSplitter(options);
  }

  async split(content: string): Promise<string[]> {
    if (content.length <= this.options.chunkSize) {
      return [content];
    }

    // Split by list items
    // This regex looks for lines starting with -, *, or digits followed by dot, at the start of line or after newline
    // It captures the delimiter to keep it
    const listItems = this.splitByListItems(content);

    // Merge items that fit together
    const mergedChunks = this.mergeChunks(listItems);

    // Check if any chunk is still too large
    const finalChunks: string[] = [];
    for (const chunk of mergedChunks) {
      if (chunk.length > this.options.chunkSize) {
        // Fallback to text splitting for huge items
        const subChunks = await this.textSplitter.split(chunk);
        finalChunks.push(...subChunks);
      } else {
        finalChunks.push(chunk);
      }
    }

    return finalChunks;
  }

  private splitByListItems(content: string): string[] {
    const lines = content.split("\n");
    const items: string[] = [];
    let currentItem = "";

    // Regex for list item start: optional whitespace, then -, *, or 1., then space
    const listItemRegex = /^\s*([-*]|\d+\.)\s/;

    for (const line of lines) {
      if (listItemRegex.test(line)) {
        // Start of new item
        if (currentItem) {
          items.push(currentItem);
        }
        currentItem = line;
      } else {
        // Continuation of current item (or content before first item)
        if (currentItem) {
          currentItem += `\n${line}`;
        } else {
          // Content before first list item? Should rarely happen if we passed a list
          // But valid markdown can have text before list in same block if not carefully separated
          currentItem = line;
        }
      }
    }

    if (currentItem) {
      items.push(currentItem);
    }

    return items;
  }

  private mergeChunks(chunks: string[]): string[] {
    const mergedChunks: string[] = [];
    let currentChunk = "";

    for (const chunk of chunks) {
      if (!currentChunk) {
        currentChunk = chunk;
        continue;
      }

      // Check if adding this chunk exceeds size
      // We add a newline separator since we split by lines originally
      if (currentChunk.length + 1 + chunk.length <= this.options.chunkSize) {
        currentChunk += `\n${chunk}`;
      } else {
        mergedChunks.push(currentChunk);
        currentChunk = chunk;
      }
    }

    if (currentChunk) {
      mergedChunks.push(currentChunk);
    }

    return mergedChunks;
  }
}
