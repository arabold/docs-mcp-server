import mime from "mime";

/**
 * Represents a parsed Content-Type header.
 */
export interface ParsedContentType {
  mimeType: string;
  charset?: string;
}

/**
 * Enhanced MIME type detection and utility functions.
 * Combines standard MIME type operations with enhanced source code detection.
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
   * This includes basic text/* types but excludes structured formats like JSON, XML, etc.
   */
  public static isText(mimeType: string): boolean {
    if (!mimeType) {
      return false;
    }

    const normalizedMimeType = mimeType.toLowerCase();

    // Accept basic text/* types, but exclude structured formats that have specific pipelines
    if (normalizedMimeType.startsWith("text/")) {
      // Exclude structured text formats that should go to specific pipelines
      if (
        MimeTypeUtils.isJson(normalizedMimeType) ||
        MimeTypeUtils.isMarkdown(normalizedMimeType)
      ) {
        return false;
      }
      return true;
    }

    return false;
  }

  /**
   * Checks if a MIME type represents content that is safe for text processing.
   * This includes all text/* types and specific application types that are text-based.
   * Used by TextPipeline as a fallback for content that other pipelines don't handle.
   */
  public static isSafeForTextProcessing(mimeType: string): boolean {
    if (!mimeType) {
      return false;
    }

    const normalizedMimeType = mimeType.toLowerCase();

    // Accept all text/* types
    if (normalizedMimeType.startsWith("text/")) {
      return true;
    }

    // Accept JSON content (when not handled by JsonPipeline)
    if (MimeTypeUtils.isJson(normalizedMimeType)) {
      return true;
    }

    // Accept source code types (when not handled by SourceCodePipeline)
    if (MimeTypeUtils.isSourceCode(normalizedMimeType)) {
      return true;
    }

    return false;
  }

  /**
   * Checks if a MIME type represents JSON content.
   */
  public static isJson(mimeType: string): boolean {
    return (
      mimeType === "application/json" ||
      mimeType === "text/json" ||
      mimeType === "text/x-json"
    );
  }

  /**
   * Checks if a MIME type represents source code that should be wrapped in code blocks.
   */
  public static isSourceCode(mimeType: string): boolean {
    return MimeTypeUtils.extractLanguageFromMimeType(mimeType) !== "";
  }

  /**
   * Checks if content appears to be binary based on the presence of null bytes.
   * This is a reliable heuristic since text files should not contain null bytes.
   * @param content The content to check (string or Buffer)
   * @returns true if the content appears to be binary
   */
  public static isBinary(content: string | Buffer): boolean {
    if (typeof content === "string") {
      return content.includes("\0");
    }

    // For Buffer, check for null bytes directly
    return content.includes(0);
  }

  /**
   * Detects MIME type from file path, with special handling for common source code extensions
   * that the mime package doesn't handle well or gets wrong.
   *
   * @param filePath - The file path to detect MIME type for
   * @returns The detected MIME type or null if unknown
   */
  public static detectMimeTypeFromPath(filePath: string): string | null {
    const extension = filePath.toLowerCase().split(".").pop();

    // Handle common source code extensions that mime package gets wrong or doesn't know
    const customMimeTypes: Record<string, string> = {
      ts: "text/x-typescript",
      tsx: "text/x-tsx",
      js: "text/javascript",
      jsx: "text/x-jsx",
      cjs: "text/javascript", // CommonJS modules
      mjs: "text/javascript", // ES modules
      py: "text/x-python",
      pyw: "text/x-python",
      pyi: "text/x-python",
      go: "text/x-go",
      rs: "text/x-rust",
      kt: "text/x-kotlin",
      scala: "text/x-scala",
      swift: "text/x-swift",
      rb: "text/x-ruby",
      php: "text/x-php",
      cs: "text/x-csharp",
      cpp: "text/x-c++src",
      cxx: "text/x-c++src",
      cc: "text/x-c++src",
      hpp: "text/x-c++hdr",
      hxx: "text/x-c++hdr",
      h: "text/x-chdr",
      c: "text/x-csrc",
      sh: "text/x-shellscript",
      bash: "text/x-shellscript",
      zsh: "text/x-shellscript",
      fish: "text/x-shellscript",
      ps1: "text/x-powershell",
      sql: "text/x-sql",
      graphql: "text/x-graphql",
      gql: "text/x-graphql",
      proto: "text/x-proto",
      dockerfile: "text/x-dockerfile",
    };

    if (extension && customMimeTypes[extension]) {
      return customMimeTypes[extension];
    }

    // Fall back to the mime package for other types
    const detectedType = mime.getType(filePath);

    // Normalize problematic MIME types that the mime package gets wrong
    return MimeTypeUtils.normalizeMimeType(detectedType);
  }

  /**
   * Normalizes MIME types that are incorrectly detected by the mime package.
   * This handles cases like 'application/node' for .cjs files.
   *
   * @param mimeType - The MIME type to normalize
   * @returns The normalized MIME type
   */
  public static normalizeMimeType(mimeType: string | null): string | null {
    if (!mimeType) {
      return null;
    }

    // Map problematic MIME types to correct ones
    const mimeTypeNormalization: Record<string, string> = {
      "application/node": "text/javascript", // .cjs files are detected as this
    };

    return mimeTypeNormalization[mimeType] || mimeType;
  }

  /**
   * Extracts the programming language identifier from a MIME type for code block formatting.
   *
   * @param mimeType - The MIME type to extract language from
   * @returns The language identifier (e.g., "typescript", "python") or empty string if unknown
   */
  public static extractLanguageFromMimeType(mimeType: string): string {
    const mimeToLanguage: Record<string, string> = {
      "text/x-typescript": "typescript",
      "text/typescript": "typescript",
      "application/typescript": "typescript",
      "text/x-tsx": "tsx",
      "text/javascript": "javascript",
      "application/javascript": "javascript",
      "application/x-javascript": "javascript",
      "text/x-jsx": "jsx",
      "text/x-python": "python",
      "text/x-java": "java",
      "text/x-c": "c",
      "text/x-csrc": "c",
      "text/x-chdr": "c",
      "text/x-c++": "cpp",
      "text/x-c++src": "cpp",
      "text/x-c++hdr": "cpp",
      "text/x-csharp": "csharp",
      "text/x-go": "go",
      "text/x-rust": "rust",
      "text/x-php": "php",
      "text/x-ruby": "ruby",
      "text/x-swift": "swift",
      "text/x-kotlin": "kotlin",
      "text/x-scala": "scala",
      "text/x-yaml": "yaml",
      "application/x-yaml": "yaml",
      "application/yaml": "yaml",
      "text/x-json": "json",
      "application/json": "json",
      "text/x-xml": "xml",
      "text/xml": "xml",
      "application/xml": "xml",
      "text/x-sql": "sql",
      "text/x-sh": "bash",
      "text/x-shellscript": "bash",
      "application/x-sh": "bash",
      "text/x-powershell": "powershell",
      "text/x-graphql": "graphql",
      "text/x-proto": "protobuf",
      "text/x-dockerfile": "dockerfile",
    };

    return mimeToLanguage[mimeType] || "";
  }
}
