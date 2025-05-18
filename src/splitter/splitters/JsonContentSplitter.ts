import type { ContentSplitter, ContentSplitterOptions } from "./types";

/**
 * Splits large JSON content into valid JSON chunks by recursively splitting arrays and objects.
 * Ensures each chunk is a valid JSON string and does not exceed the specified chunk size.
 *
 * - For arrays: splits by elements, recursively splitting if needed.
 * - For objects: splits by key-value pairs, recursively splitting if needed.
 * - For primitives or large single elements: returns as a single chunk or throws if too large.
 */
export class JsonContentSplitter implements ContentSplitter {
  constructor(private options: ContentSplitterOptions) {}

  /**
   * Splits JSON content into valid JSON chunks respecting the chunk size.
   * @param content JSON string
   */
  async split(content: string): Promise<string[]> {
    let root: unknown;
    try {
      root = JSON.parse(content);
    } catch (err) {
      // If not valid JSON, return as a single chunk
      return [content];
    }
    return this.splitNode(root);
  }

  private splitNode(node: unknown): string[] {
    const json = JSON.stringify(node);
    if (json.length <= this.options.chunkSize) {
      return [json];
    }
    if (Array.isArray(node)) {
      return this.splitArray(node);
    }
    if (node && typeof node === "object") {
      return this.splitObject(node as Record<string, unknown>);
    }
    // Primitive too large, return as is
    return [json];
  }

  private splitArray(arr: unknown[]): string[] {
    const result: string[] = [];
    let currentChunk: unknown[] = [];
    for (const el of arr) {
      const testChunk = [...currentChunk, el];
      const json = JSON.stringify(testChunk);
      if (json.length > this.options.chunkSize) {
        if (currentChunk.length === 0) {
          // Single element too large, split recursively
          result.push(...this.splitNode(el));
        } else {
          result.push(JSON.stringify(currentChunk));
          currentChunk = [el];
        }
      } else {
        currentChunk.push(el);
      }
    }
    if (currentChunk.length > 0) {
      result.push(JSON.stringify(currentChunk));
    }
    return result;
  }

  private splitObject(obj: Record<string, unknown>): string[] {
    const result: string[] = [];
    let currentChunk: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      const testChunk = { ...currentChunk, [key]: value };
      const json = JSON.stringify(testChunk);
      if (json.length > this.options.chunkSize) {
        if (Object.keys(currentChunk).length === 0) {
          // Single property too large, split recursively
          result.push(...this.splitNode(value));
        } else {
          result.push(JSON.stringify(currentChunk));
          currentChunk = { [key]: value };
        }
      } else {
        currentChunk[key] = value;
      }
    }
    if (Object.keys(currentChunk).length > 0) {
      result.push(JSON.stringify(currentChunk));
    }
    return result;
  }
}
