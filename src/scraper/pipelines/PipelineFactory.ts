/**
 * PipelineFactory - Centralized factory for creating content processing pipelines.
 *
 * This factory ensures consistency across scraper strategies by providing standardized
 * pipeline configurations. It eliminates code duplication and makes it easy to maintain
 * and extend pipeline configurations globally.
 */

import { HtmlPipeline } from "./HtmlPipeline";
import { JsonPipeline } from "./JsonPipeline";
import { MarkdownPipeline } from "./MarkdownPipeline";
import type { ContentPipeline } from "./types";

/**
 * Factory class for creating content processing pipelines.
 * Provides standardized pipeline configurations used across different scraper strategies.
 */
// biome-ignore lint/complexity/noStaticOnlyClass: Factory pattern with static methods is appropriate here
export class PipelineFactory {
  /**
   * Creates the standard set of content pipelines used by all scraper strategies.
   * Includes HTML, Markdown, and JSON processing capabilities.
   *
   * @returns Array of content pipelines in processing order
   */
  public static createStandardPipelines(): ContentPipeline[] {
    return [new HtmlPipeline(), new MarkdownPipeline(), new JsonPipeline()];
  }
}
