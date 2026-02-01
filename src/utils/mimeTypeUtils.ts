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
   * Checks if a MIME type represents PDF content.
   */
  public static isPdf(mimeType: string): boolean {
    return mimeType === "application/pdf";
  }

  /**
   * Checks if a MIME type represents an Office document (DOCX, XLSX, PPTX).
   */
  public static isOfficeDocument(mimeType: string): boolean {
    return (
      mimeType ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      mimeType ===
        "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    );
  }

  /**
   * Checks if a MIME type represents a Jupyter Notebook.
   */
  public static isJupyterNotebook(mimeType: string): boolean {
    return mimeType === "application/x-ipynb+json";
  }

  /**
   * Checks if a MIME type represents a document that can be processed
   * by the DocumentPipeline (PDF, Office docs, Jupyter notebooks).
   */
  public static isSupportedDocument(mimeType: string): boolean {
    return (
      MimeTypeUtils.isPdf(mimeType) ||
      MimeTypeUtils.isOfficeDocument(mimeType) ||
      MimeTypeUtils.isJupyterNotebook(mimeType)
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

    // Handle common source code extensions that mime package gets wrong or doesn't know.
    // See openspec/changes/refactor-mime-type-detection/design.md for full documentation.
    const customMimeTypes: Record<string, string> = {
      // JavaScript/TypeScript family
      ts: "text/x-typescript",
      tsx: "text/x-tsx",
      mts: "text/x-typescript", // TypeScript ES modules
      cts: "text/x-typescript", // TypeScript CommonJS modules
      js: "text/javascript",
      jsx: "text/x-jsx",
      cjs: "text/javascript", // CommonJS modules
      mjs: "text/javascript", // ES modules

      // Python family
      py: "text/x-python",
      pyw: "text/x-python",
      pyi: "text/x-python",
      pyx: "text/x-cython", // Cython
      pxd: "text/x-cython", // Cython

      // Systems languages
      go: "text/x-go",
      rs: "text/x-rust",
      c: "text/x-csrc",
      h: "text/x-chdr",
      cpp: "text/x-c++src",
      cxx: "text/x-c++src",
      cc: "text/x-c++src",
      hpp: "text/x-c++hdr",
      hxx: "text/x-c++hdr",
      zig: "text/x-zig",
      nim: "text/x-nim",
      v: "text/x-v",
      cr: "text/x-crystal",

      // JVM languages
      kt: "text/x-kotlin",
      kts: "text/x-kotlin", // Kotlin script
      scala: "text/x-scala",
      groovy: "text/x-groovy",
      gradle: "text/x-gradle",

      // Apple/Mobile
      swift: "text/x-swift",
      dart: "text/x-dart",

      // Scripting languages
      rb: "text/x-ruby",
      rake: "text/x-ruby", // Rakefile
      php: "text/x-php",
      lua: "text/x-lua",
      pl: "text/x-perl",
      pm: "text/x-perl",
      r: "text/x-r", // Also handles .R since extension is lowercased

      // Functional languages
      hs: "text/x-haskell",
      lhs: "text/x-haskell", // Literate Haskell
      elm: "text/x-elm",
      erl: "text/x-erlang",
      ex: "text/x-elixir",
      exs: "text/x-elixir",
      clj: "text/x-clojure",
      cljs: "text/x-clojure",
      cljc: "text/x-clojure",
      jl: "text/x-julia",

      // .NET
      cs: "text/x-csharp",

      // Web3/Smart contracts
      sol: "text/x-solidity",
      move: "text/x-move",
      cairo: "text/x-cairo",

      // Modern web frameworks
      vue: "text/x-vue",
      svelte: "text/x-svelte",
      astro: "text/x-astro",

      // Shell scripting
      sh: "text/x-shellscript",
      bash: "text/x-shellscript",
      zsh: "text/x-shellscript",
      fish: "text/x-shellscript",
      ps1: "text/x-powershell",

      // Documentation formats
      rst: "text/x-rst", // reStructuredText
      adoc: "text/x-asciidoc",
      asciidoc: "text/x-asciidoc",
      textile: "text/x-textile",
      org: "text/x-org", // Org-mode
      pod: "text/x-pod", // Perl documentation
      rdoc: "text/x-rdoc", // Ruby documentation
      wiki: "text/x-wiki",
      rmd: "text/x-rmarkdown", // R Markdown

      // Configuration files
      toml: "text/x-toml",
      ini: "text/x-ini",
      cfg: "text/x-ini",
      conf: "text/x-conf",
      properties: "text/x-properties",
      env: "text/x-dotenv",

      // Build systems
      dockerfile: "text/x-dockerfile",
      containerfile: "text/x-dockerfile",
      makefile: "text/x-makefile",
      cmake: "text/x-cmake",
      bazel: "text/x-bazel",
      bzl: "text/x-bazel",
      buck: "text/x-buck",

      // Infrastructure as Code
      tf: "text/x-terraform",
      tfvars: "text/x-terraform",
      hcl: "text/x-hcl",

      // Data/Query languages
      sql: "text/x-sql",
      graphql: "text/x-graphql",
      gql: "text/x-graphql",

      // Schema/API definitions
      proto: "text/x-proto",
      prisma: "text/x-prisma",
      thrift: "text/x-thrift",
      avro: "text/x-avro",

      // TeX/LaTeX
      tex: "text/x-tex",
      latex: "text/x-latex",
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

    // Map problematic MIME types to correct ones.
    // These are defense-in-depth for external MIME types (e.g., HTTP Content-Type headers).
    // Extensions are checked first in customMimeTypes, so these mostly apply to external sources.
    const mimeTypeNormalization: Record<string, string> = {
      "application/node": "text/javascript", // .cjs files
      "video/mp2t": "text/x-typescript", // .ts/.mts files (MPEG-2 transport stream conflict)
      "application/rls-services+xml": "text/x-rust", // .rs files
      "application/vnd.lotus-organizer": "text/x-org", // .org files (Lotus Organizer conflict)
      "application/vnd.dart": "text/x-dart", // .dart files
      "application/x-perl": "text/x-perl", // .pl/.pm files
      "application/x-tex": "text/x-tex", // .tex files
      "application/x-latex": "text/x-latex", // .latex files
      "application/toml": "text/x-toml", // .toml files
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
      // JavaScript/TypeScript
      "text/x-typescript": "typescript",
      "text/typescript": "typescript",
      "application/typescript": "typescript",
      "text/x-tsx": "tsx",
      "text/javascript": "javascript",
      "application/javascript": "javascript",
      "application/x-javascript": "javascript",
      "text/x-jsx": "jsx",

      // Python
      "text/x-python": "python",
      "text/x-cython": "cython",

      // Systems languages
      "text/x-c": "c",
      "text/x-csrc": "c",
      "text/x-chdr": "c",
      "text/x-c++": "cpp",
      "text/x-c++src": "cpp",
      "text/x-c++hdr": "cpp",
      "text/x-go": "go",
      "text/x-rust": "rust",
      "text/x-zig": "zig",
      "text/x-nim": "nim",
      "text/x-v": "v",
      "text/x-crystal": "crystal",

      // JVM languages
      "text/x-java": "java",
      "text/x-kotlin": "kotlin",
      "text/x-scala": "scala",
      "text/x-groovy": "groovy",
      "text/x-gradle": "groovy",

      // Apple/Mobile
      "text/x-swift": "swift",
      "text/x-dart": "dart",

      // .NET
      "text/x-csharp": "csharp",

      // Scripting languages
      "text/x-ruby": "ruby",
      "text/x-php": "php",
      "text/x-lua": "lua",
      "text/x-perl": "perl",
      "text/x-r": "r",

      // Functional languages
      "text/x-haskell": "haskell",
      "text/x-elm": "elm",
      "text/x-erlang": "erlang",
      "text/x-elixir": "elixir",
      "text/x-clojure": "clojure",
      "text/x-julia": "julia",

      // Web3/Smart contracts
      "text/x-solidity": "solidity",
      "text/x-move": "move",
      "text/x-cairo": "cairo",

      // Modern web frameworks
      "text/x-vue": "vue",
      "text/x-svelte": "svelte",
      "text/x-astro": "astro",

      // Shell
      "text/x-sh": "bash",
      "text/x-shellscript": "bash",
      "application/x-sh": "bash",
      "text/x-powershell": "powershell",

      // Documentation formats
      "text/x-rst": "rst",
      "text/x-asciidoc": "asciidoc",
      "text/x-textile": "textile",
      "text/x-org": "org",
      "text/x-pod": "pod",
      "text/x-rdoc": "rdoc",
      "text/x-wiki": "wiki",
      "text/x-rmarkdown": "rmarkdown",

      // Configuration files
      "text/x-toml": "toml",
      "text/x-ini": "ini",
      "text/x-conf": "conf",
      "text/x-properties": "properties",
      "text/x-dotenv": "dotenv",

      // Build systems
      "text/x-dockerfile": "dockerfile",
      "text/x-makefile": "makefile",
      "text/x-cmake": "cmake",
      "text/x-bazel": "bazel",
      "text/x-buck": "buck",

      // Infrastructure as Code
      "text/x-terraform": "hcl",
      "text/x-hcl": "hcl",

      // Data formats
      "text/x-yaml": "yaml",
      "application/x-yaml": "yaml",
      "application/yaml": "yaml",
      "text/x-json": "json",
      "application/json": "json",
      "text/x-xml": "xml",
      "text/xml": "xml",
      "application/xml": "xml",
      "text/x-sql": "sql",
      "text/x-graphql": "graphql",

      // Schema/API definitions
      "text/x-proto": "protobuf",
      "text/x-prisma": "prisma",
      "text/x-thrift": "thrift",
      "text/x-avro": "avro",

      // TeX/LaTeX
      "text/x-tex": "tex",
      "text/x-latex": "latex",
    };

    return mimeToLanguage[mimeType] || "";
  }
}
