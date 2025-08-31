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
 * 3. Process nested structures recursively
 * 4. Maintain proper indentation and hierarchical paths
 * 5. Let GreedySplitter handle size optimization
 */

import type { ContentChunk, DocumentSplitter } from "./types";

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
}

export class JsonDocumentSplitter implements DocumentSplitter {
  private preserveFormatting: boolean;

  constructor(options: JsonDocumentSplitterOptions = {}) {
    this.preserveFormatting = options.preserveFormatting ?? true;
  }

  async splitText(content: string, _contentType?: string): Promise<ContentChunk[]> {
    try {
      const parsed: JsonValue = JSON.parse(content);
      const chunks: ContentChunk[] = [];

      // Process the JSON structure recursively, starting with root path
      this.processValue(parsed, ["root"], 1, 0, chunks, true);

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
    chunks: ContentChunk[],
    isLastItem: boolean,
  ): void {
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
    chunks: ContentChunk[],
    isLastItem: boolean,
  ): void {
    const indent = this.getIndent(indentLevel);
    const comma = isLastItem ? "" : ",";

    // Opening bracket chunk
    chunks.push({
      types: ["code"],
      content: `${indent}[`,
      section: { level, path: [...path, "opening"] },
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
      section: { level, path: [...path, "closing"] },
    });
  }

  private processObject(
    obj: Record<string, JsonValue>,
    path: string[],
    level: number,
    indentLevel: number,
    chunks: ContentChunk[],
    isLastItem: boolean,
  ): void {
    const indent = this.getIndent(indentLevel);
    const comma = isLastItem ? "" : ",";
    const entries = Object.entries(obj);

    // Opening brace chunk
    chunks.push({
      types: ["code"],
      content: `${indent}{`,
      section: { level, path: [...path, "opening"] },
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
      section: { level, path: [...path, "closing"] },
    });
  }

  private processProperty(
    key: string,
    value: JsonValue,
    path: string[],
    level: number,
    indentLevel: number,
    chunks: ContentChunk[],
    isLastProperty: boolean,
  ): void {
    const indent = this.getIndent(indentLevel);

    if (typeof value === "object" && value !== null) {
      // For complex values (objects/arrays), create a property opening chunk
      chunks.push({
        types: ["code"],
        content: `${indent}"${key}": `,
        section: { level, path: [...path, "key"] },
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
    chunks: ContentChunk[],
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
}
