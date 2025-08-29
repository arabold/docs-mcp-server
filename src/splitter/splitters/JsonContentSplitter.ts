import { MinimumChunkSizeError } from "../errors";
import type { ContentSplitter, ContentSplitterOptions } from "./types";

/**
 * Interface representing a JSON path element for hierarchical tracking
 */
interface JsonPathElement {
  key: string;
  type: "object" | "array" | "primitive";
  index?: number; // For array elements
}

/**
 * Splits JSON content while preserving hierarchical structure.
 * Creates parent-child relationships based on JSON object/array nesting.
 * Each object, array, and significant value becomes a separate chunk with
 * proper hierarchical path information.
 */
export class JsonContentSplitter implements ContentSplitter {
  constructor(private options: ContentSplitterOptions) {}

  async split(content: string): Promise<string[]> {
    try {
      // Parse the JSON to validate and analyze structure
      const jsonData = JSON.parse(content);
      return await this.splitRecursively(jsonData, []);
    } catch (_error) {
      // If JSON is invalid, treat as single chunk
      if (content.length > this.options.chunkSize) {
        throw new MinimumChunkSizeError(content.length, this.options.chunkSize);
      }
      return [content];
    }
  }

  /**
   * Creates a chunk for an array item (simple values only)
   */
  private async splitRecursively(
    jsonData: unknown,
    currentPath: JsonPathElement[],
  ): Promise<string[]> {
    const chunks: string[] = [];

    if (Array.isArray(jsonData)) {
      // For arrays: opening bracket, items, closing bracket
      const pathComment =
        currentPath.length > 0 ? `// Path: ${this.formatPath(currentPath)}\n` : "";
      chunks.push(`${pathComment}[`);

      for (let i = 0; i < jsonData.length; i++) {
        const itemPath = [
          ...currentPath,
          { key: `[${i}]`, type: "array" as const, index: i },
        ];

        if (this.isComplexType(jsonData[i])) {
          // Recursively split complex items
          const subChunks = await this.splitRecursively(jsonData[i], itemPath);
          chunks.push(...subChunks);
        } else {
          // Simple items get their own chunk with path comment
          const itemChunk = this.createItemChunk(jsonData[i], itemPath);
          chunks.push(itemChunk);
        }

        // Add comma separator if not the last item
        if (i < jsonData.length - 1) {
          chunks.push(",");
        }
      }

      chunks.push("]");
    } else if (typeof jsonData === "object" && jsonData !== null) {
      // For objects: opening brace, properties, closing brace
      const pathComment =
        currentPath.length > 0 ? `// Path: ${this.formatPath(currentPath)}\n` : "";
      chunks.push(`${pathComment}{`);

      const entries = Object.entries(jsonData);
      for (let i = 0; i < entries.length; i++) {
        const [key, value] = entries[i];
        const propertyPath = [...currentPath, { key, type: "object" as const }];

        // Always include the property key
        const keyChunk = `"${key}": `;

        if (this.isComplexType(value)) {
          // For complex values, create a key chunk and then recursively split the value
          chunks.push(`// Path: ${this.formatPath(propertyPath)}\n${keyChunk}`);
          const subChunks = await this.splitRecursively(value, propertyPath);
          chunks.push(...subChunks);
        } else {
          // For simple values, create a complete property chunk
          const propertyChunk = this.createPropertyChunk(key, value, propertyPath);
          chunks.push(propertyChunk);
        }

        // Add comma separator if not the last property
        if (i < entries.length - 1) {
          chunks.push(",");
        }
      }

      chunks.push("}");
    } else {
      // Handle primitives - just return the JSON representation with path comment
      const pathComment =
        currentPath.length > 0 ? `// Path: ${this.formatPath(currentPath)}\n` : "";
      const valueJson = JSON.stringify(jsonData, null, 2);
      chunks.push(`${pathComment}${valueJson}`);
    }

    return chunks;
  }

  /**
   * Creates a chunk for an array item (simple values only)
   */
  private createItemChunk(item: unknown, path: JsonPathElement[]): string {
    const pathComment = `// Path: ${this.formatPath(path)}\n`;
    const itemJson = JSON.stringify(item, null, 2);
    return `${pathComment}${itemJson}`;
  }

  /**
   * Creates a chunk for an object property (simple values only)
   */
  private createPropertyChunk(
    key: string,
    value: unknown,
    path: JsonPathElement[],
  ): string {
    const pathComment = `// Path: ${this.formatPath(path)}\n`;
    const propertyJson = `"${key}": ${JSON.stringify(value, null, 2)}`;
    return `${pathComment}${propertyJson}`;
  }

  /**
   * Formats the path for display in comments
   */
  private formatPath(path: JsonPathElement[]): string {
    if (path.length === 0) return "root";

    return path
      .map((element) => {
        if (element.type === "array") {
          return element.key; // Already formatted as [index]
        } else {
          return element.key;
        }
      })
      .join(".");
  }

  /**
   * Determines if a value is complex (object or array) and needs child processing
   */
  private isComplexType(value: unknown): boolean {
    return (
      (Array.isArray(value) && value.length > 0) ||
      (typeof value === "object" && value !== null && Object.keys(value).length > 0)
    );
  }
}
