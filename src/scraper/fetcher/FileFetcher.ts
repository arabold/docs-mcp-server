import fs from "node:fs/promises";
import path from "node:path";
import { ScraperError } from "../../utils/errors";
import { logger } from "../../utils/logger";
import type { ContentFetcher, FetchOptions, RawContent } from "./types";

/**
 * Fetches content from local file system.
 */
export class FileFetcher implements ContentFetcher {
  canFetch(source: string): boolean {
    return source.startsWith("file://");
  }

  async fetch(source: string, options?: FetchOptions): Promise<RawContent> {
    const filePath = source.replace(/^file:\/\//, "");
    logger.info(`📄 Fetching file: ${filePath}`);

    try {
      const content = await fs.readFile(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const mimeType = this.getMimeType(ext);

      return {
        content,
        mimeType,
        source,
        encoding: "utf-8", // Assume UTF-8 for text files
      };
    } catch (error: unknown) {
      throw new ScraperError(
        `Failed to read file ${filePath}: ${
          (error as { message?: string }).message ?? "Unknown error"
        }`,
        false,
        error instanceof Error ? error : undefined,
      );
    }
  }

  private getMimeType(ext: string): string {
    switch (ext) {
      case ".html":
      case ".htm":
        return "text/html";
      case ".md":
        return "text/markdown";
      case ".txt":
        return "text/plain";
      case ".json":
        return "application/json";
      default:
        return "application/octet-stream";
    }
  }
}
