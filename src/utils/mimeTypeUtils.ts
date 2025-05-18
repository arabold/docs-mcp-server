/**
 * Represents a parsed Content-Type header.
 */
export interface ParsedContentType {
  mimeType: string;
  charset?: string;
}

/**
 * Utility functions for handling MIME types and charsets.
 */
// biome-ignore lint/complexity/noStaticOnlyClass: helpers are static
export class MimeTypeUtils {
  /**
   * Parses a Content-Type header string into its MIME type and charset.
   * @param contentTypeHeader The Content-Type header string (e.g., "text/html; charset=utf-8").
   * @returns A ParsedContentType object, or a default if parsing fails.
   */
  public static parseContentType(contentTypeHeader?: string | null): ParsedContentType {
    if (!contentTypeHeader) {
      return { mimeType: "application/octet-stream" };
    }
    const parts = contentTypeHeader.split(";").map((part) => part.trim());
    const mimeType = parts[0].toLowerCase();
    let charset: string | undefined;

    for (let i = 1; i < parts.length; i++) {
      const param = parts[i];
      if (param.toLowerCase().startsWith("charset=")) {
        charset = param.substring("charset=".length).toLowerCase();
        break;
      }
    }
    return { mimeType, charset };
  }

  /**
   * Checks if a MIME type represents HTML content.
   */
  public static isHtml(mimeType: string): boolean {
    return mimeType === "text/html" || mimeType === "application/xhtml+xml";
  }

  /**
   * Checks if a MIME type represents Markdown content.
   */
  public static isMarkdown(mimeType: string): boolean {
    return mimeType === "text/markdown" || mimeType === "text/x-markdown";
  }

  /**
   * Checks if a MIME type represents plain text content.
   */
  public static isText(mimeType: string): boolean {
    return mimeType.startsWith("text/");
  }

  /**
   * Checks if a MIME type represents JSON content.
   */
  public static isJson(mimeType: string): boolean {
    return (
      mimeType === "application/json" ||
      mimeType === "application/ld+json" ||
      mimeType.endsWith("+json") ||
      mimeType === "text/json" ||
      mimeType === "application/json5"
    );
  }
}
