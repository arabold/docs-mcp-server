/**
 * TreesitterSourceCodeSplitter - Main splitter implementation using tree-sitter
 *
 * Replaces the regex-based SourceCodeDocumentSplitter with semantic parsing
 * using tree-sitter AST. Maintains compatibility with existing chunk patterns
 * and hierarchical structure while providing robust parsing for JavaScript,
 * TypeScript, JSX, and TSX files.
 */

import { TextDocumentSplitter } from "../TextDocumentSplitter";
import type { ContentChunk, DocumentSplitter } from "../types";
import { LanguageParserRegistry } from "./LanguageParserRegistry";
import type { CodeBoundary, LanguageParser } from "./parsers/types";

/**
 * Configuration options for tree-sitter source code splitting
 */
export interface TreesitterSourceCodeSplitterOptions {
  /** Maximum size for individual chunks before delegating to TextSplitter */
  maxChunkSize?: number;
  /** Whether to preserve original formatting and indentation */
  preserveFormatting?: boolean;
  /** Maximum lines before delegating content to TextSplitter */
  maxLinesBeforeDelegation?: number;
}

/**
 * Tree-sitter based source code splitter that provides semantic parsing
 * while maintaining compatibility with existing chunk patterns
 */
export class TreesitterSourceCodeSplitter implements DocumentSplitter {
  private readonly textSplitter: TextDocumentSplitter;
  private readonly registry: LanguageParserRegistry;
  private readonly options: Required<TreesitterSourceCodeSplitterOptions>;

  constructor(options: TreesitterSourceCodeSplitterOptions = {}) {
    this.options = {
      maxChunkSize: options.maxChunkSize ?? 2000,
      preserveFormatting: options.preserveFormatting ?? true,
      maxLinesBeforeDelegation: options.maxLinesBeforeDelegation ?? 50,
    };

    // Initialize registry and text splitter
    this.registry = new LanguageParserRegistry();
    this.textSplitter = new TextDocumentSplitter({
      maxChunkSize: this.options.maxChunkSize,
      minLinesPerChunk: 3,
      detectLanguage: true,
    });
  }

  async splitText(content: string, contentType?: string): Promise<ContentChunk[]> {
    if (!content.trim()) {
      return [];
    }

    // Try to get a parser for this content type
    const parser = this.getParserForContent(contentType);
    if (!parser) {
      // Fall back to TextDocumentSplitter for unsupported languages
      return this.textSplitter.splitText(content, contentType);
    }

    try {
      // Parse the source code
      const parseResult = parser.parse(content);

      if (parseResult.hasErrors) {
        console.warn(
          `Tree-sitter parsing had errors for ${contentType}, but continuing with partial results`,
        );
      }

      // Extract simplified boundaries for chunking
      const boundaries = parser.extractBoundaries(parseResult.tree, content);

      if (boundaries.length === 0) {
        // No semantic boundaries found, fall back to text splitter
        return this.textSplitter.splitText(content, contentType);
      }

      // Convert boundaries to content chunks
      return this.boundariesToChunks(boundaries, content, contentType);
    } catch (error) {
      // Graceful fallback to TextDocumentSplitter on any parsing error
      console.warn(
        "TreesitterSourceCodeSplitter failed, falling back to TextDocumentSplitter:",
        error,
      );
      return this.textSplitter.splitText(content, contentType);
    }
  }

  /**
   * Get the appropriate parser for the given content type
   */
  private getParserForContent(contentType?: string): LanguageParser | undefined {
    if (!contentType) {
      return undefined;
    }

    // Try to find parser by MIME type first
    let parser = this.registry.getParserByMimeType(contentType);
    if (parser) {
      return parser;
    }

    // Try to extract file extension from content type
    const extensionMatch = contentType.match(/\\.([a-zA-Z]+)$/);
    if (extensionMatch) {
      const extension = `.${extensionMatch[1]}`;
      parser = this.registry.getParserByExtension(extension);
      if (parser) {
        return parser;
      }
    }

    // Check for common patterns in content type
    if (contentType.includes("javascript")) {
      return this.registry.getParser("javascript");
    }
    if (contentType.includes("typescript")) {
      return this.registry.getParser("typescript");
    }
    if (contentType.includes("jsx")) {
      return this.registry.getParser("javascript"); // JSX uses JavaScript parser
    }
    if (contentType.includes("tsx")) {
      return this.registry.getParser("typescript"); // TSX uses TypeScript parser
    }

    return undefined;
  }

  /**
   * Check if the content type is supported
   */
  isSupportedContentType(contentType?: string): boolean {
    return this.getParserForContent(contentType) !== undefined;
  }

  /**
   * Get the list of supported languages
   */
  getSupportedLanguages(): string[] {
    return this.registry.getSupportedLanguages();
  }

  /**
   * Get the list of supported file extensions
   */
  getSupportedExtensions(): string[] {
    return this.registry.getSupportedExtensions();
  }

  /**
   * Get the list of supported MIME types
   */
  getSupportedMimeTypes(): string[] {
    return this.registry.getSupportedMimeTypes();
  }

  /**
   * Convert boundaries to chunks using boundary-point algorithm
   * This creates segments between all boundary points, ensuring complete coverage and no duplication
   * Ensures perfect reassembly - concatenating all chunks recreates original content
   */
  private boundariesToChunks(
    boundaries: CodeBoundary[],
    content: string,
    _contentType?: string,
  ): ContentChunk[] {
    const lines = content.split("\n");
    const totalLines = lines.length;

    if (boundaries.length === 0) {
      // No boundaries found, treat entire file as global code
      return [
        {
          types: ["code"],
          content,
          section: {
            level: 1,
            path: ["global"],
          },
        },
      ];
    }

    // Step 1: Collect all boundary points (start and end+1 for exclusive ranges)
    const boundaryPoints = new Set<number>();
    boundaryPoints.add(1); // Always start from line 1
    boundaryPoints.add(totalLines + 1); // Always end after last line

    for (const boundary of boundaries) {
      boundaryPoints.add(boundary.startLine);
      boundaryPoints.add(boundary.endLine + 1); // +1 for exclusive end
    }

    // Step 2: Sort points to create segments
    const sortedPoints = Array.from(boundaryPoints).sort((a, b) => a - b);

    // Step 3: Create segments between consecutive points
    const chunks: ContentChunk[] = [];

    for (let i = 0; i < sortedPoints.length - 1; i++) {
      const startLine = sortedPoints[i];
      const endLine = sortedPoints[i + 1] - 1; // Convert back to inclusive end

      // Skip empty segments
      if (startLine > endLine || startLine > totalLines) {
        continue;
      }

      // Extract content for this segment
      const segmentLines = lines.slice(startLine - 1, Math.min(endLine, totalLines)); // Convert to 0-indexed and clamp
      let segmentContent = segmentLines.join("\n");

      // Add trailing newline for all segments except the last one (for perfect reconstruction)
      if (endLine < totalLines) {
        segmentContent += "\n";
      }

      if (segmentContent.length === 0) {
        continue; // Skip empty segments
      }

      // Step 4: Determine which boundary this segment belongs to (innermost containing boundary)
      const containingBoundary = this.findContainingBoundary(
        startLine,
        endLine,
        boundaries,
      );

      // Step 5: Assign path and level based on containing boundary
      let path: string[];
      let level: number;

      if (containingBoundary) {
        // Use the boundary's hierarchical path and level
        path = containingBoundary.path || [containingBoundary.name || "unnamed"];
        level = containingBoundary.level || path.length;
      } else {
        // No containing boundary, this is global code
        path = ["global"];
        level = 1;
      }

      chunks.push({
        types: ["code"],
        content: segmentContent,
        section: {
          level,
          path,
        },
      });
    }

    return chunks;
  }

  /**
   * Find the innermost boundary that contains the given line range
   */
  private findContainingBoundary(
    startLine: number,
    endLine: number,
    boundaries: CodeBoundary[],
  ): CodeBoundary | undefined {
    let innermost: CodeBoundary | undefined;
    let smallestRange = Infinity;

    for (const boundary of boundaries) {
      // Check if boundary contains the segment
      if (boundary.startLine <= startLine && boundary.endLine >= endLine) {
        const range = boundary.endLine - boundary.startLine;

        // Keep the smallest containing boundary (innermost)
        if (range < smallestRange) {
          smallestRange = range;
          innermost = boundary;
        }
      }
    }

    return innermost;
  }
}
