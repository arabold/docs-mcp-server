import { JsonDocumentSplitter } from "../../splitter/JsonDocumentSplitter";
import type { DocumentSplitter } from "../../splitter/types";
import type { AppConfig } from "../../utils/config";
import { MimeTypeUtils } from "../../utils/mimeTypeUtils";
import type { ContentFetcher, RawContent } from "../fetcher/types";
import type { ContentProcessorMiddleware, MiddlewareContext } from "../middleware/types";
import type { ScraperOptions } from "../types";
import { convertToString } from "../utils/buffer";
import { BasePipeline } from "./BasePipeline";
import type { PipelineResult } from "./types";

/**
 * Pipeline for processing JSON content with semantic, hierarchical splitting.
 * Uses JsonDocumentSplitter to produce structurally faithful chunks (preserving {level, path})
 * without greedy size-based merging. Greedy merging is intentionally omitted to avoid collapsing
 * distinct structural nodes that are required for precise hierarchical reassembly.
 */
export class JsonPipeline extends BasePipeline {
  private readonly middleware: ContentProcessorMiddleware[];
  private readonly splitter: DocumentSplitter;

  constructor(config: AppConfig) {
    super();
    this.middleware = [];
    // Structure-preserving splitter only (no greedy size merging)
    this.splitter = new JsonDocumentSplitter(config.splitter, {
      preserveFormatting: true,
    });
  }

  canProcess(mimeType: string): boolean {
    if (!mimeType) return false;
    return MimeTypeUtils.isJson(mimeType);
  }

  async process(
    rawContent: RawContent,
    options: ScraperOptions,
    fetcher?: ContentFetcher,
  ): Promise<PipelineResult> {
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
      const fallbackChunks = await this.splitter.splitText(contentString);
      return {
        textContent: contentString,
        // metadata: {
        //   isValidJson: false,
        // },
        links: [],
        errors: [],
        chunks: fallbackChunks,
      };
    }

    const metadata = this.extractMetadata(parsedJson);
    const context: MiddlewareContext = {
      content: contentString,
      source: rawContent.source,
      title: metadata.title,
      contentType: rawContent.mimeType || "application/json",
      // metadata: {
      //   ...this.extractMetadata(parsedJson),
      //   isValidJson,
      //   jsonStructure: this.analyzeJsonStructure(parsedJson),
      // },
      links: [], // JSON files typically don't contain links
      errors: [],
      options,
      fetcher,
    };

    // Execute the middleware stack (minimal for JSON)
    await this.executeMiddlewareStack(this.middleware, context);

    // Split the content using JsonContentSplitter
    const chunks = await this.splitter.splitText(context.content);

    return {
      title: context.title,
      contentType: context.contentType,
      textContent: context.content,
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
