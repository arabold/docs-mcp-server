/**
 * Tree-sitter based source code splitter.
 *
 * Provides semantic parsing and chunking of source code using tree-sitter ASTs.
 * Maintains compatibility with existing chunk patterns and hierarchical structure,
 * while providing robust parsing for JavaScript, TypeScript, JSX, and TSX files.
 */

import { SPLITTER_MAX_CHUNK_SIZE } from "../../utils";
import { TextContentSplitter } from "../splitters/TextContentSplitter";
import type { ContentChunk, DocumentSplitter } from "../types";
import { LanguageParserRegistry } from "./LanguageParserRegistry";
import type { CodeBoundary, LanguageParser } from "./parsers/types";

/**
 * Configuration options for tree-sitter source code splitting
 */
export interface TreesitterSourceCodeSplitterOptions {
  /** Maximum size for individual chunks before delegating to TextSplitter */
  maxChunkSize?: number;
}

/**
 * Tree-sitter based source code splitter that provides semantic parsing
 * while maintaining compatibility with existing chunk patterns
 */
export class TreesitterSourceCodeSplitter implements DocumentSplitter {
  private readonly textContentSplitter: TextContentSplitter;
  private readonly registry: LanguageParserRegistry;
  private readonly options: Required<TreesitterSourceCodeSplitterOptions>;

  constructor(options: TreesitterSourceCodeSplitterOptions = {}) {
    this.options = {
      maxChunkSize: options.maxChunkSize ?? SPLITTER_MAX_CHUNK_SIZE,
    };

    // Initialize registry and text content splitter
    this.registry = new LanguageParserRegistry();
    this.textContentSplitter = new TextContentSplitter({
      chunkSize: this.options.maxChunkSize,
    });
  }

  async splitText(content: string, contentType?: string): Promise<ContentChunk[]> {
    if (!content.trim()) {
      return [];
    }

    // Try to get a parser for this content type
    const parser = this.getParserForContent(contentType);
    if (!parser) {
      // Fall back to TextContentSplitter for unsupported languages
      return this.fallbackToTextSplitter(content);
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
        return this.fallbackToTextSplitter(content);
      }

      // Build hierarchical relationships between boundaries
      const hierarchicalBoundaries = this.buildBoundaryHierarchy(boundaries);

      // Direct conversion to chunks (parser is responsible for suppressing unwanted nested boundaries)
      return await this.boundariesToChunks(hierarchicalBoundaries, content, contentType);
    } catch (error) {
      // Graceful fallback to TextContentSplitter on any parsing error
      console.warn(
        "TreesitterSourceCodeSplitter failed, falling back to TextContentSplitter:",
        error,
      );
      return this.fallbackToTextSplitter(content);
    }
  }

  /**
   * Helper method to fall back to TextContentSplitter and convert results to ContentChunk[]
   */
  private async fallbackToTextSplitter(content: string): Promise<ContentChunk[]> {
    const textChunks = await this.textContentSplitter.split(content);
    return textChunks.map((chunk) => ({
      types: ["code"],
      content: chunk,
      section: {
        level: 0,
        path: [],
      },
    }));
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
    if (contentType.includes("javascript") || contentType.includes("typescript")) {
      return this.registry.getParser("typescript");
    }
    if (contentType.includes("jsx") || contentType.includes("tsx")) {
      // Unified TypeScript parser also handles JSX/TSX
      return this.registry.getParser("typescript");
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
   * Helper method to split content using TextContentSplitter only if needed
   * and create ContentChunks with the specified hierarchical path and level
   */
  private async splitContentIntoChunks(
    content: string,
    path: string[],
    level: number,
  ): Promise<ContentChunk[]> {
    // Preserve whitespace-only content if it fits within chunk size (for perfect reconstruction)
    // Only skip if content is completely empty
    if (content.length === 0) {
      return [];
    }

    // Only apply TextContentSplitter if content exceeds max chunk size
    if (content.length <= this.options.maxChunkSize) {
      // Content is small enough, return as single chunk preserving original formatting
      return [
        {
          types: ["code"] as const,
          content,
          section: {
            level,
            path,
          },
        },
      ];
    }

    // Content is too large, use TextContentSplitter to break it down
    const textChunks = await this.textContentSplitter.split(content);

    // Convert text chunks to ContentChunks with semantic context
    return textChunks.map((textChunk) => ({
      types: ["code"] as const,
      content: textChunk,
      section: {
        level,
        path,
      },
    }));
  }

  /**
   * Convert boundaries to chunks.
   * Algorithm:
   *  - Collect line breakpoints: file start, each boundary start, each boundary end+1, file end+1
   *  - Create linear segments between breakpoints (each line appears exactly once)
   *  - Determine containing (innermost) boundary for each segment for path/level
   *  - First segment belonging to a structural boundary => structural chunk; subsequent segments demoted to content
   *  - Universal max size enforcement: any segment > maxChunkSize is further split via TextContentSplitter
   *  - No heuristic de-noising or whitespace merging; reconstruction is guaranteed by preserving order + exact text
   */
  private async boundariesToChunks(
    boundaries: CodeBoundary[],
    content: string,
    _contentType?: string,
  ): Promise<ContentChunk[]> {
    const lines = content.split("\n");
    const totalLines = lines.length;

    if (boundaries.length === 0) {
      // No boundaries found, use TextContentSplitter on entire content
      const subChunks = await this.splitContentIntoChunks(content, [], 0);
      return subChunks;
    }

    // NOTE: Removed previous adjustment that forcibly shifted the first boundary
    // to line 1 when only whitespace preceded it. That logic rewrote startLine
    // and broke documentation merging tests (expected doc start line).
    // We preserve original boundary start lines now.

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

    // Step 3: Create segments between consecutive points (collect first, don't process yet)
    interface TextSegment {
      startLine: number;
      endLine: number;
      content: string;
      containingBoundary?: CodeBoundary;
    }

    const segments: TextSegment[] = [];

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

      // Determine which boundary this segment belongs to (innermost containing boundary)
      const containingBoundary = this.findContainingBoundary(
        startLine,
        endLine,
        boundaries,
      );

      segments.push({
        startLine,
        endLine,
        content: segmentContent,
        containingBoundary,
      });
    }

    // Step 4: Convert segments directly to chunks (whitespace retained verbatim)
    const chunks: ContentChunk[] = [];

    // Ensure only ONE structural chunk is emitted per structural boundary.
    const structuralBoundaryFirstChunk = new Set<CodeBoundary>();

    // Accumulate whitespace-only segments and prepend to next non-whitespace segment
    // to avoid emitting standalone whitespace chunks (tests assert no empty-trim chunks)
    let pendingWhitespace = "";

    for (const segment of segments) {
      if (segment.content.trim() === "") {
        pendingWhitespace += segment.content;
        continue;
      }
      // Assign path and level based on containing boundary
      let path: string[];
      let level: number;

      const boundary = segment.containingBoundary;

      if (boundary) {
        // Use the boundary's hierarchical path and level
        path = boundary.path || [boundary.name || "unnamed"];
        level = boundary.level || path.length;
      } else {
        // No containing boundary, this is global code
        path = [];
        level = 0;
      }

      // Determine initial structural classification
      let isStructural = boundary?.boundaryType === "structural";

      if (isStructural && boundary) {
        if (structuralBoundaryFirstChunk.has(boundary)) {
          // Demote subsequent segments of the same structural boundary
          isStructural = false;
        } else {
          structuralBoundaryFirstChunk.add(boundary);
        }
      }

      // If segment is too large, delegate to TextContentSplitter
      const segmentChunks = await this.splitContentIntoChunks(
        segment.content,
        path,
        level,
      );

      // Overwrite types based on structural vs content classification (always include "code" for backward compatibility)
      for (const c of segmentChunks) {
        // Prepend any accumulated whitespace to the FIRST chunk emitted for this segment
        if (pendingWhitespace) {
          c.content = pendingWhitespace + c.content;
          pendingWhitespace = "";
        }
        c.types = isStructural ? ["code", "structural"] : ["code"];
      }

      chunks.push(...segmentChunks);
    }

    // If file ended with whitespace-only content, append it to last chunk (preserve reconstructability)
    if (pendingWhitespace && chunks.length > 0) {
      chunks[chunks.length - 1].content += pendingWhitespace;
    }

    return chunks;
  }

  /**
   * Build hierarchical relationships between boundaries based on containment
   */
  private buildBoundaryHierarchy(boundaries: CodeBoundary[]): CodeBoundary[] {
    // Create a copy of boundaries to avoid mutating the original
    const hierarchicalBoundaries = boundaries.map((b) => ({ ...b }));

    // Build parent-child relationships
    for (let i = 0; i < hierarchicalBoundaries.length; i++) {
      const boundary = hierarchicalBoundaries[i];
      let parent: CodeBoundary | undefined;
      let smallestRange = Infinity;

      // Find the smallest containing parent
      for (let j = 0; j < hierarchicalBoundaries.length; j++) {
        if (i === j) continue;
        const candidate = hierarchicalBoundaries[j];

        // Check if candidate contains boundary
        if (
          candidate.startLine <= boundary.startLine &&
          candidate.endLine >= boundary.endLine &&
          candidate.startByte <= boundary.startByte &&
          candidate.endByte >= boundary.endByte
        ) {
          const range = candidate.endLine - candidate.startLine;

          // Keep the smallest containing boundary (innermost parent)
          if (range < smallestRange) {
            smallestRange = range;
            parent = candidate;
          }
        }
      }

      if (parent) {
        boundary.parent = parent;
      }

      // Build hierarchical path
      boundary.path = this.buildBoundaryPath(boundary);
      boundary.level = boundary.path.length;
    }

    return hierarchicalBoundaries;
  }

  /**
   * Build hierarchical path for a boundary by walking up the parent chain
   */
  private buildBoundaryPath(boundary: CodeBoundary): string[] {
    const path: string[] = [];
    let current: CodeBoundary | undefined = boundary;

    // Walk up the parent chain
    while (current) {
      if (current.name) {
        path.unshift(current.name); // Add to beginning to build path from root
      }
      current = current.parent;
    }

    return path;
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
