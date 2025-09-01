import type { ContentChunk } from "../../splitter/types";
import type { ContentFetcher, RawContent } from "../fetcher/types";
import type { ScraperOptions } from "../types";

/**
 * Represents the successfully processed content from a pipeline.
 */
export interface ProcessedContent {
  /** The final processed content, typically as a string (e.g., Markdown). */
  textContent: string;
  /** Extracted metadata (e.g., title, description). */
  metadata: Record<string, unknown>;
  /** Extracted links from the content. */
  links: string[];
  /** Any non-critical errors encountered during processing. */
  errors: Error[];
  /** Pre-split chunks from pipeline processing */
  chunks: ContentChunk[];
}

/**
 * Interface for a content processing pipeline.
 * Each pipeline is specialized for a certain type of content (e.g., HTML, Markdown, JSON, source code).
 * Pipelines now handle both content processing and splitting using appropriate splitters.
 */
export interface ContentPipeline {
  /**
   * Determines if this pipeline can process the given raw content.
   * @param rawContent The raw content fetched from a source.
   * @returns True if the pipeline can process the content, false otherwise.
   */
  canProcess(rawContent: RawContent): boolean;

  /**
   * Processes the raw content and optionally splits it into chunks.
   * @param rawContent The raw content to process.
   * @param options Scraper options that might influence processing.
   * @param fetcher An optional ContentFetcher for resolving relative resources.
   * @returns A promise that resolves with the ProcessedContent, including pre-split chunks.
   */
  process(
    rawContent: RawContent,
    options: ScraperOptions,
    fetcher?: ContentFetcher,
  ): Promise<ProcessedContent>;

  /**
   * Closes any resources or connections used by the pipeline.
   */
  close(): Promise<void>;
}
