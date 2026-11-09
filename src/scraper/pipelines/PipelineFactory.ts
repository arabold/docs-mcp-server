/**
 * PipelineFactory - Centralized factory for creating content processing pipelines.
 *
 * This factory ensures consistency across scraper strategies by providing standardized
 * pipeline configurations. It eliminates code duplication and makes it easy to maintain
 * and extend pipeline configurations globally.
 */

import type { AppConfig } from "../../utils/config";
import type { ManagedBrowser } from "../fetcher/ManagedBrowser";
import { DocumentPipeline } from "./DocumentPipeline";
import { HtmlPipeline } from "./HtmlPipeline";
import { JsonPipeline } from "./JsonPipeline";
import { MarkdownPipeline } from "./MarkdownPipeline";
import { SourceCodePipeline } from "./SourceCodePipeline";
import { TextPipeline } from "./TextPipeline";
import type { ContentPipeline } from "./types";

/**
 * Factory class for creating content processing pipelines.
 * Provides standardized pipeline configurations used across different scraper strategies.
 */
// biome-ignore lint/complexity/noStaticOnlyClass: Factory pattern with static methods is appropriate here
export class PipelineFactory {
  /**
   * Creates the standard set of content pipelines used by all scraper strategies.
   * Includes HTML, Markdown, JSON, source code, document, and text processing capabilities.
   * Each pipeline now handles both preprocessing and content-specific splitting.
   * TextPipeline is placed last as the universal fallback for unknown content types.
   *
   * @param appConfig - Application configuration.
   * @param managedBrowser - The browser the HTML pipeline renders with; pass
   * one to share it with the browser fetcher.
   * @returns Array of content pipelines in processing order
   */
  public static createStandardPipelines(
    appConfig: AppConfig,
    managedBrowser?: ManagedBrowser,
  ): ContentPipeline[] {
    return [
      new JsonPipeline(appConfig),
      new SourceCodePipeline(appConfig),
      new DocumentPipeline(appConfig), // PDF, Office docs, OpenDocument, RTF, eBooks, Jupyter notebooks
      new HtmlPipeline(appConfig, managedBrowser),
      new MarkdownPipeline(appConfig),
      new TextPipeline(appConfig), // Universal fallback - must be last
    ];
  }
}
