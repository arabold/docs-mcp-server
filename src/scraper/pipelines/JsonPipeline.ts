import { GreedySplitter } from "../../splitter";
import { JsonDocumentSplitter } from "../../splitter/JsonDocumentSplitter";
import {
  SPLITTER_MIN_CHUNK_SIZE,
  SPLITTER_PREFERRED_CHUNK_SIZE,
} from "../../utils/config";
import { MimeTypeUtils } from "../../utils/mimeTypeUtils";
import type { ContentFetcher, RawContent } from "../fetcher/types";
import type { ContentProcessorMiddleware, MiddlewareContext } from "../middleware/types";
import type { ScraperOptions } from "../types";
import { convertToString } from "../utils/buffer";
import { BasePipeline } from "./BasePipeline";
import type { ProcessedContent } from "./types";

/**
 * Pipeline for processing JSON content with semantic splitting and size optimization.
 * Handles JSON files by validating structure and using JsonDocumentSplitter for hierarchical splitting
 * that creates proper ContentChunks with semantic paths, followed by GreedySplitter for universal size optimization.
 */
export class JsonPipeline extends BasePipeline {
  private readonly middleware: ContentProcessorMiddleware[];
  private readonly greedySplitter: GreedySplitter;

  constructor(chunkSize = SPLITTER_PREFERRED_CHUNK_SIZE) {
    super();
    // JSON processing doesn't need complex middleware since we preserve raw structure
    this.middleware = [];

    // Create the two-phase splitting: semantic + size optimization
    const jsonSplitter = new JsonDocumentSplitter({
      preserveFormatting: true,
    });
    this.greedySplitter = new GreedySplitter(
      jsonSplitter,
      SPLITTER_MIN_CHUNK_SIZE,
      chunkSize,
    );
  }

  canProcess(rawContent: RawContent): boolean {
    if (!rawContent.mimeType) return false;
    return MimeTypeUtils.isJson(rawContent.mimeType);
  }

  async process(
    rawContent: RawContent,
    options: ScraperOptions,
    fetcher?: ContentFetcher,
  ): Promise<ProcessedContent> {
    const contentString = convertToString(rawContent.content, rawContent.charset);

    // Validate JSON structure
    let parsedJson: unknown;
    let isValidJson = true;
    try {
      parsedJson = JSON.parse(contentString);
    } catch (_error) {
      isValidJson = false;
    }

    // For invalid JSON, return as-is for fallback text processing
    if (!isValidJson) {
      // Still split invalid JSON content for consistency
      const fallbackChunks = await this.greedySplitter.splitText(contentString);
      return {
        textContent: contentString,
        metadata: {
          isValidJson: false,
        },
        links: [],
        errors: [],
        chunks: fallbackChunks,
      };
    }

    const context: MiddlewareContext = {
      content: contentString,
      source: rawContent.source,
      metadata: {
        ...this.extractMetadata(parsedJson),
        isValidJson,
        jsonStructure: this.analyzeJsonStructure(parsedJson),
      },
      links: [], // JSON files typically don't contain links
      errors: [],
      options,
      fetcher,
    };

    // Execute the middleware stack (minimal for JSON)
    await this.executeMiddlewareStack(this.middleware, context);

    // Split the content using JsonContentSplitter
    const chunks = await this.greedySplitter.splitText(context.content);

    return {
      textContent: context.content,
      metadata: context.metadata,
      links: context.links,
      errors: context.errors,
      chunks,
    };
  }

  /**
   * Extracts metadata from JSON content only when meaningful values exist
   */
  private extractMetadata(parsedJson: unknown): { title?: string; description?: string } {
    const metadata: { title?: string; description?: string } = {};

    if (typeof parsedJson === "object" && parsedJson !== null) {
      const obj = parsedJson as Record<string, unknown>;

      // Look for common title fields - only use if they exist and are strings
      const titleFields = ["title", "name", "displayName", "label"];
      for (const field of titleFields) {
        if (field in obj && typeof obj[field] === "string" && obj[field]) {
          metadata.title = obj[field] as string;
          break;
        }
      }

      // Look for common description fields - only use if they exist and are strings
      const descFields = ["description", "summary", "about", "info"];
      for (const field of descFields) {
        if (field in obj && typeof obj[field] === "string" && obj[field]) {
          metadata.description = obj[field] as string;
          break;
        }
      }
    }

    return metadata;
  }

  /**
   * Analyzes the structure of valid JSON for metadata
   */
  private analyzeJsonStructure(parsedJson: unknown): {
    type: string;
    depth: number;
    itemCount?: number;
    propertyCount?: number;
  } {
    if (Array.isArray(parsedJson)) {
      return {
        type: "array",
        depth: this.calculateDepth(parsedJson),
        itemCount: parsedJson.length,
      };
    } else if (typeof parsedJson === "object" && parsedJson !== null) {
      const obj = parsedJson as Record<string, unknown>;
      return {
        type: "object",
        depth: this.calculateDepth(parsedJson),
        propertyCount: Object.keys(obj).length,
      };
    } else {
      return {
        type: typeof parsedJson,
        depth: 1,
      };
    }
  }

  /**
   * Calculates the maximum nesting depth of a JSON structure
   */
  private calculateDepth(obj: unknown, currentDepth = 1): number {
    if (Array.isArray(obj)) {
      let maxDepth = currentDepth;
      for (const item of obj) {
        if (typeof item === "object" && item !== null) {
          maxDepth = Math.max(maxDepth, this.calculateDepth(item, currentDepth + 1));
        }
      }
      return maxDepth;
    } else if (typeof obj === "object" && obj !== null) {
      let maxDepth = currentDepth;
      for (const value of Object.values(obj)) {
        if (typeof value === "object" && value !== null) {
          maxDepth = Math.max(maxDepth, this.calculateDepth(value, currentDepth + 1));
        }
      }
      return maxDepth;
    }

    return currentDepth;
  }
}
