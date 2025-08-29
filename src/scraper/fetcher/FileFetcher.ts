import fs from "node:fs/promises";
import { ScraperError } from "../../utils/errors";
import { MimeTypeUtils } from "../../utils/mimeTypeUtils";
import type { ContentFetcher, FetchOptions, RawContent } from "./types";

/**
 * Fetches content from local file system.
 */
export class FileFetcher implements ContentFetcher {
  canFetch(source: string): boolean {
    return source.startsWith("file://");
  }

  /**
   * Fetches the content of a file given a file:// URL, decoding percent-encoded paths as needed.
   * Uses enhanced MIME type detection for better source code file recognition.
   */
  async fetch(source: string, _options?: FetchOptions): Promise<RawContent> {
    // Always decode the file path from file:// URL
    const rawPath = source.replace("file://", "");
    const filePath = decodeURIComponent(rawPath);

    try {
      const content = await fs.readFile(filePath);

      // Use enhanced MIME type detection that properly handles source code files
      const detectedMimeType = MimeTypeUtils.detectMimeTypeFromPath(filePath);
      const mimeType = detectedMimeType || "application/octet-stream";

      return {
        content,
        mimeType,
        source,
        // Don't assume charset for text files - let the pipeline detect it
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
}
