import crypto from "node:crypto";
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
    // Remove the file:// protocol prefix and handle both file:// and file:/// formats
    let filePath = source.replace(/^file:\/\/\/?/, "");

    // Decode percent-encoded characters
    filePath = decodeURIComponent(filePath);

    // Ensure absolute path on Unix-like systems (if not already absolute)
    if (!filePath.startsWith("/") && process.platform !== "win32") {
      filePath = `/${filePath}`;
    }

    try {
      const [content, stats] = await Promise.all([
        fs.readFile(filePath),
        fs.stat(filePath),
      ]);

      // Use enhanced MIME type detection that properly handles source code files
      const detectedMimeType = MimeTypeUtils.detectMimeTypeFromPath(filePath);
      const mimeType = detectedMimeType || "application/octet-stream";

      // Generate pseudo-ETag from last modified time
      const etag = crypto
        .createHash("md5")
        .update(stats.mtime.toISOString())
        .digest("hex");

      return {
        content,
        mimeType,
        source,
        etag,
        lastModified: stats.mtime.toISOString(),
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
