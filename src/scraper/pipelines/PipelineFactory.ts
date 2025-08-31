/**
 * PipelineFactory - Centralized factory for creating content processing pipelines.
 *
 * This factory ensures consistency across scraper strategies by providing standardized
 * pipeline configurations. It eliminates code duplication and makes it easy to maintain
 * and extend pipeline configurations globally.
 */

import { SPLITTER_PREFERRED_CHUNK_SIZE } from "../../utils/config";
import { HtmlPipeline } from "./HtmlPipeline";
import { JsonPipeline } from "./JsonPipeline";
import { MarkdownPipeline } from "./MarkdownPipeline";
import { SourceCodePipeline } from "./SourceCodePipeline";
import { TextPipeline } from "./TextPipeline";
import type { ContentPipeline } from "./types";

/**
 * Configuration options for pipeline creation
 */
export interface PipelineConfiguration {
  chunkSizes?: {
    /** Preferred chunk size for most content types */
    preferred?: number;
    /** Maximum chunk size for content that shouldn't be split aggressively */
    max?: number;
  };
}

/**
 * Factory class for creating content processing pipelines.
 * Provides standardized pipeline configurations used across different scraper strategies.
 */
// biome-ignore lint/complexity/noStaticOnlyClass: Factory pattern with static methods is appropriate here
export class PipelineFactory {
  /**
   * Creates the standard set of content pipelines used by all scraper strategies.
   * Includes HTML, Markdown, JSON, source code, and text processing capabilities.
   * Each pipeline now handles both preprocessing and content-specific splitting.
   * TextPipeline is placed last as the universal fallback for unknown content types.
   *
   * @param config - Optional configuration for pipeline chunk sizes
   * @returns Array of content pipelines in processing order
   */
  public static createStandardPipelines(
    config?: PipelineConfiguration,
  ): ContentPipeline[] {
    const preferredChunkSize =
      config?.chunkSizes?.preferred ?? SPLITTER_PREFERRED_CHUNK_SIZE;
    const maxChunkSize = config?.chunkSizes?.max ?? 2000;

    return [
      new HtmlPipeline(preferredChunkSize, maxChunkSize),
      new MarkdownPipeline(preferredChunkSize, maxChunkSize),
      new JsonPipeline(preferredChunkSize),
      new SourceCodePipeline(preferredChunkSize),
      new TextPipeline(preferredChunkSize), // Universal fallback - must be last
    ];
  }
}
