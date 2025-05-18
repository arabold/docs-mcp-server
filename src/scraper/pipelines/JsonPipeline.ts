import { JsonContentSplitter } from "../../splitter/splitters/JsonContentSplitter";
import type { RawContent } from "../fetcher/types";
import type { ContentFetcher } from "../fetcher/types";
import type { ScraperOptions } from "../types";
import { BasePipeline } from "./BasePipeline";
import type { ProcessedContent } from "./types";

/**
 * Pipeline for processing JSON content using the JsonContentSplitter.
 */
export class JsonPipeline extends BasePipeline {
  canProcess(raw: RawContent): boolean {
    return (
      typeof raw.mimeType === "string" &&
      (raw.mimeType === "application/json" ||
        raw.mimeType === "application/ld+json" ||
        raw.mimeType.endsWith("+json") ||
        raw.mimeType === "text/json" ||
        raw.mimeType === "application/json5")
    );
  }

  async process(
    raw: RawContent,
    _options: ScraperOptions,
    _fetcher: ContentFetcher,
  ): Promise<ProcessedContent> {
    const content =
      typeof raw.content === "string" ? raw.content : raw.content.toString("utf-8");
    const splitter = new JsonContentSplitter({ chunkSize: 5000 }); // Use a reasonable default chunk size
    const chunks = await splitter.split(content);
    return {
      textContent: chunks.join("\n"),
      metadata: { title: raw.source },
      links: [], // JSON doesn't typically have links
      errors: [],
    };
  }
}
