import crypto from "node:crypto";
import fs from "node:fs/promises";
import { ScraperError } from "../../utils/errors";
import { MimeTypeUtils } from "../../utils/mimeTypeUtils";
import {
  type ContentFetcher,
  type FetchOptions,
  FetchStatus,
  type RawContent,
} from "./types";

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
   * Supports conditional fetching via ETag comparison for efficient refresh operations.
   */
  async fetch(source: string, options?: FetchOptions): Promise<RawContent> {
    // Remove the file:// protocol prefix and handle both file:// and file:/// formats
    let filePath = source.replace(/^file:\/\/\/?/, "");

    // Decode percent-encoded characters
    filePath = decodeURIComponent(filePath);

    // Ensure absolute path on Unix-like systems (if not already absolute)
    if (!filePath.startsWith("/") && process.platform !== "win32") {
      filePath = `/${filePath}`;
    }

    try {
      const stats = await fs.stat(filePath);

      // Generate current ETag from last modified time
      const currentEtag = crypto
        .createHash("md5")
        .update(stats.mtime.toISOString())
        .digest("hex");

      // Check if file has been modified (ETag comparison)
      if (options?.etag && options.etag === currentEtag) {
        // File hasn't changed - return NOT_MODIFIED status
        return {
          content: Buffer.from(""),
          mimeType: "text/plain",
          source,
          etag: currentEtag,
          lastModified: stats.mtime.toISOString(),
          status: FetchStatus.NOT_MODIFIED,
        };
      }

      // File is new or has been modified - read the content
      const content = await fs.readFile(filePath);

      // Use enhanced MIME type detection that properly handles source code files
      const detectedMimeType = MimeTypeUtils.detectMimeTypeFromPath(filePath);
      const mimeType = detectedMimeType || "application/octet-stream";

      return {
        content,
        mimeType,
        source,
        etag: currentEtag,
        lastModified: stats.mtime.toISOString(),
        status: FetchStatus.SUCCESS,
        // Don't assume charset for text files - let the pipeline detect it
      };
    } catch (error: unknown) {
      // Check for file not found error
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return {
          content: Buffer.from(""),
          mimeType: "text/plain",
          source,
          status: FetchStatus.NOT_FOUND,
        };
      }
      // For all other errors, throw a ScraperError
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
