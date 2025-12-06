/**
 * JsonDocumentSplitter - Concatenation-friendly JSON document splitting.
 *
 * Creates minimal, concatenable chunks that form valid JSON when combined.
 * Each chunk is a building block: opening braces, individual properties with proper commas,
 * nested structures, and closing braces. Designed to work with GreedySplitter for optimization.
 *
 * Algorithm:
 * 1. Create opening structure chunks (braces/brackets)
 * 2. Create individual property/element chunks with proper punctuation
 * 3. Process nested structures recursively up to maxDepth
 * 4. Maintain proper indentation and hierarchical paths
 * 5. Let GreedySplitter handle size optimization
 * 6. Fall back to text-based chunking if maxChunks limit is exceeded or maxDepth is reached
 */

import {
  JSON_MAX_CHUNKS,
  JSON_MAX_NESTING_DEPTH,
  SPLITTER_MAX_CHUNK_SIZE,
} from "../utils/config";
import { TextDocumentSplitter } from "./TextDocumentSplitter";
import type { Chunk, DocumentSplitter } from "./types";

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface JsonDocumentSplitterOptions {
  // No size constraints - we create minimal chunks and let GreedySplitter optimize
  preserveFormatting?: boolean;
  /** Maximum nesting depth for JSON chunking. After this depth, switches to text chunking for nested content. */
  maxDepth?: number;
  /** Maximum number of chunks allowed. If exceeded, falls back to text-based chunking. */
  maxChunks?: number;
}

export class JsonDocumentSplitter implements DocumentSplitter {
  private preserveFormatting: boolean;
  private maxDepth: number;
  private maxChunks: number;
  private textFallbackSplitter: TextDocumentSplitter;

  constructor(options: JsonDocumentSplitterOptions = {}) {
    this.preserveFormatting = options.preserveFormatting ?? true;
    this.maxDepth = options.maxDepth ?? JSON_MAX_NESTING_DEPTH;
    this.maxChunks = options.maxChunks ?? JSON_MAX_CHUNKS;
    this.textFallbackSplitter = new TextDocumentSplitter();
  }

  async splitText(content: string, _contentType?: string): Promise<Chunk[]> {
    try {
      const parsed: JsonValue = JSON.parse(content);
      const chunks: Chunk[] = [];

      // Process the JSON structure recursively, starting with root path
      await this.processValue(parsed, ["root"], 1, 0, chunks, true);

      // Check if we exceeded the maximum number of chunks
      if (chunks.length > this.maxChunks) {
        // Fall back to text-based chunking
        return this.textFallbackSplitter.splitText(content);
      }

      return chunks;
    } catch {
      // If JSON parsing fails, create a single chunk with the raw content
      return [
        {
          types: ["code"],
          content: content.trim(),
          section: {
            level: 1,
            path: ["invalid-json"],
          },
        },
      ];
    }
  }

  private async processValue(
    value: JsonValue,
    path: string[],
    level: number,
    indentLevel: number,
    chunks: Chunk[],
    isLastItem: boolean,
  ): Promise<void> {
    // Check if we've exceeded the maximum depth
    if (level > this.maxDepth) {
      // Switch to simple text-based representation for deep nesting
      await this.processValueAsText(value, path, level, indentLevel, chunks, isLastItem);
      return;
    }

    if (Array.isArray(value)) {
      await this.processArray(value, path, level, indentLevel, chunks, isLastItem);
    } else if (value !== null && typeof value === "object") {
      await this.processObject(value, path, level, indentLevel, chunks, isLastItem);
    } else {
      this.processPrimitive(value, path, level, indentLevel, chunks, isLastItem);
    }
  }

  private async processArray(
    array: JsonValue[],
    path: string[],
    level: number,
    indentLevel: number,
    chunks: Chunk[],
    isLastItem: boolean,
  ): Promise<void> {
    const indent = this.getIndent(indentLevel);
    const comma = isLastItem ? "" : ",";

    // Opening bracket chunk
    chunks.push({
      types: ["code"],
      content: `${indent}[`,
      section: { level, path: [...path] },
    });

    // Process each array element
    for (let index = 0; index < array.length; index++) {
      const item = array[index];
      const isLast = index === array.length - 1;
      const itemPath = [...path, `[${index}]`];
      await this.processValue(item, itemPath, level + 1, indentLevel + 1, chunks, isLast);
    }

    // Closing bracket chunk
    chunks.push({
      types: ["code"],
      content: `${indent}]${comma}`,
      section: { level, path: [...path] },
    });
  }

  private async processObject(
    obj: Record<string, JsonValue>,
    path: string[],
    level: number,
    indentLevel: number,
    chunks: Chunk[],
    isLastItem: boolean,
  ): Promise<void> {
    const indent = this.getIndent(indentLevel);
    const comma = isLastItem ? "" : ",";
    const entries = Object.entries(obj);

    // Opening brace chunk
    chunks.push({
      types: ["code"],
      content: `${indent}{`,
      section: { level, path: [...path] },
    });

    // Process each property
    for (let index = 0; index < entries.length; index++) {
      const [key, value] = entries[index];
      const isLast = index === entries.length - 1;
      const propertyPath = [...path, key];
      await this.processProperty(
        key,
        value,
        propertyPath,
        level + 1,
        indentLevel + 1,
        chunks,
        isLast,
      );
    }

    // Closing brace chunk
    chunks.push({
      types: ["code"],
      content: `${indent}}${comma}`,
      section: { level, path: [...path] },
    });
  }

  private async processProperty(
    key: string,
    value: JsonValue,
    path: string[],
    level: number,
    indentLevel: number,
    chunks: Chunk[],
    isLastProperty: boolean,
  ): Promise<void> {
    const indent = this.getIndent(indentLevel);

    if (typeof value === "object" && value !== null) {
      // For complex values (objects/arrays), create a property opening chunk
      chunks.push({
        types: ["code"],
        content: `${indent}"${key}": `,
        section: { level, path },
      });

      // Process the complex value (it handles its own comma)
      await this.processValue(value, path, level, indentLevel, chunks, isLastProperty);
    } else {
      // For primitive values, create a complete property chunk
      const comma = isLastProperty ? "" : ",";
      const formattedValue = JSON.stringify(value);
      chunks.push({
        types: ["code"],
        content: `${indent}"${key}": ${formattedValue}${comma}`,
        section: { level, path },
      });
    }
  }

  private processPrimitive(
    value: JsonValue,
    path: string[],
    level: number,
    indentLevel: number,
    chunks: Chunk[],
    isLastItem: boolean,
  ): void {
    const indent = this.getIndent(indentLevel);
    const comma = isLastItem ? "" : ",";
    const formattedValue = JSON.stringify(value);

    chunks.push({
      types: ["code"],
      content: `${indent}${formattedValue}${comma}`,
      section: { level, path },
    });
  }

  private getIndent(level: number): string {
    return this.preserveFormatting ? "  ".repeat(level) : "";
  }

  /**
   * Process a value that has exceeded the maximum depth limit by serializing it as text.
   * This prevents excessive chunking of deeply nested structures.
   * If the serialized value is too large, splits it using the text fallback splitter.
   */
  private async processValueAsText(
    value: JsonValue,
    path: string[],
    level: number,
    indentLevel: number,
    chunks: Chunk[],
    isLastItem: boolean,
  ): Promise<void> {
    const indent = this.getIndent(indentLevel);
    const comma = isLastItem ? "" : ",";

    // Serialize the entire value
    let serialized: string;
    if (this.preserveFormatting) {
      // Use a more efficient approach for indented serialization
      const lines = JSON.stringify(value, null, 2).split("\n");
      serialized = lines
        .map((line, idx) => (idx === 0 ? line : `${indent}${line}`))
        .join("\n");
    } else {
      serialized = JSON.stringify(value);
    }

    const fullContent = `${indent}${serialized}${comma}`;

    // Check if the FINAL formatted content (with indent and comma) exceeds the limit.
    // If so, we split just the serialized content (without structural formatting) because
    // the resulting chunks are treated as searchable text blocks, not structural JSON elements.
    if (fullContent.length > SPLITTER_MAX_CHUNK_SIZE) {
      // Use text splitter to break down the large serialized JSON
      // Note: When content is this large, we prioritize searchability over perfect JSON structure.
      // The chunks contain the actual data that users can search, with proper metadata (level, path)
      // to indicate where in the JSON structure this content originated from.
      const textChunks = await this.textFallbackSplitter.splitText(serialized);

      // Add each text chunk with the current path information
      for (const textChunk of textChunks) {
        chunks.push({
          types: ["code"],
          content: textChunk.content,
          section: { level, path: [...path] },
        });
      }
    } else {
      // Content is small enough, add as single chunk
      chunks.push({
        types: ["code"],
        content: fullContent,
        section: { level, path: [...path] },
      });
    }
  }
}
