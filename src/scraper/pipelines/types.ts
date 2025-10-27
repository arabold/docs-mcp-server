import type { Chunk } from "../../splitter/types";
import type { ContentFetcher, RawContent } from "../fetcher/types";
import type { ScraperOptions } from "../types";

/**
 * Represents the successfully processed content from a pipeline.
 */
export interface PipelineResult {
  /** The title of the page or document, extracted during processing */
  title?: string | null;
  /** The final processed content, typically as a string (e.g., Markdown). */
  textContent?: string | null;
  /** Extracted links from the content. */
  links?: string[];
  /** Any non-critical errors encountered during processing. */
  errors?: Error[];
  /** Pre-split chunks from pipeline processing */
  chunks?: Chunk[];
}

/**
 * Interface for a content processing pipeline.
 * Each pipeline is specialized for a certain type of content (e.g., HTML, Markdown, JSON, source code).
 * Pipelines now handle both content processing and splitting using appropriate splitters.
 */
export interface ContentPipeline {
  /**
   * Determines if this pipeline can process content with the given MIME type.
   * @param mimeType The MIME type of the content.
   * @param content Optional content (string or Buffer) for binary detection (used by TextPipeline).
   * @returns True if the pipeline can process the content, false otherwise.
   */
  canProcess(mimeType: string, content?: string | Buffer): boolean;

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
  ): Promise<PipelineResult>;

  /**
   * Cleanup resources used by this pipeline (e.g., browser instances, database connections).
   * Should be called when the pipeline is no longer needed.
   */
  close(): Promise<void>;
}
