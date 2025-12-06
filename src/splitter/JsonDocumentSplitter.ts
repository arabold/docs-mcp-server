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

import { JSON_MAX_CHUNKS, JSON_MAX_NESTING_DEPTH } from "../utils/config";
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
      this.processValue(parsed, ["root"], 1, 0, chunks, true);

      // Check if we exceeded the maximum number of chunks
      if (chunks.length > this.maxChunks) {
        // Fall back to text-based chunking
        return this.textFallbackSplitter.splitText(content, _contentType);
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

  private processValue(
    value: JsonValue,
    path: string[],
    level: number,
    indentLevel: number,
    chunks: Chunk[],
    isLastItem: boolean,
  ): void {
    // Check if we've exceeded the maximum depth
    if (level > this.maxDepth) {
      // Switch to simple text-based representation for deep nesting
      this.processValueAsText(value, path, level, indentLevel, chunks, isLastItem);
      return;
    }

    if (Array.isArray(value)) {
      this.processArray(value, path, level, indentLevel, chunks, isLastItem);
    } else if (value !== null && typeof value === "object") {
      this.processObject(value, path, level, indentLevel, chunks, isLastItem);
    } else {
      this.processPrimitive(value, path, level, indentLevel, chunks, isLastItem);
    }
  }

  private processArray(
    array: JsonValue[],
    path: string[],
    level: number,
    indentLevel: number,
    chunks: Chunk[],
    isLastItem: boolean,
  ): void {
    const indent = this.getIndent(indentLevel);
    const comma = isLastItem ? "" : ",";

    // Opening bracket chunk
    chunks.push({
      types: ["code"],
      content: `${indent}[`,
      section: { level, path: [...path] },
    });

    // Process each array element
    array.forEach((item, index) => {
      const isLast = index === array.length - 1;
      const itemPath = [...path, `[${index}]`];
      this.processValue(item, itemPath, level + 1, indentLevel + 1, chunks, isLast);
    });

    // Closing bracket chunk
    chunks.push({
      types: ["code"],
      content: `${indent}]${comma}`,
      section: { level, path: [...path] },
    });
  }

  private processObject(
    obj: Record<string, JsonValue>,
    path: string[],
    level: number,
    indentLevel: number,
    chunks: Chunk[],
    isLastItem: boolean,
  ): void {
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
    entries.forEach(([key, value], index) => {
      const isLast = index === entries.length - 1;
      const propertyPath = [...path, key];
      this.processProperty(
        key,
        value,
        propertyPath,
        level + 1,
        indentLevel + 1,
        chunks,
        isLast,
      );
    });

    // Closing brace chunk
    chunks.push({
      types: ["code"],
      content: `${indent}}${comma}`,
      section: { level, path: [...path] },
    });
  }

  private processProperty(
    key: string,
    value: JsonValue,
    path: string[],
    level: number,
    indentLevel: number,
    chunks: Chunk[],
    isLastProperty: boolean,
  ): void {
    const indent = this.getIndent(indentLevel);

    if (typeof value === "object" && value !== null) {
      // For complex values (objects/arrays), create a property opening chunk
      chunks.push({
        types: ["code"],
        content: `${indent}"${key}": `,
        section: { level, path },
      });

      // Process the complex value (it handles its own comma)
      this.processValue(value, path, level, indentLevel, chunks, isLastProperty);
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
   */
  private processValueAsText(
    value: JsonValue,
    path: string[],
    level: number,
    indentLevel: number,
    chunks: Chunk[],
    isLastItem: boolean,
  ): void {
    const indent = this.getIndent(indentLevel);
    const comma = isLastItem ? "" : ",";

    // Serialize the entire value as a single text chunk
    const serialized = this.preserveFormatting
      ? JSON.stringify(value, null, 2)
          .split("\n")
          .map((line, idx) => (idx === 0 ? line : `${indent}${line}`))
          .join("\n")
      : JSON.stringify(value);

    chunks.push({
      types: ["code"],
      content: `${indent}${serialized}${comma}`,
      section: { level, path: [...path] },
    });
  }
}
