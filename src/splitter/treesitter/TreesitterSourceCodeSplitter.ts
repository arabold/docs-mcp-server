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

      // Convert boundaries to content chunks using two-phase splitting
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
   * Convert boundaries to chunks using two-phase splitting approach
   * Phase 1: Create semantic segments between boundary points
   * Phase 2: Pass each segment through TextContentSplitter for size-based splitting
   * Ensures perfect reassembly - concatenating all chunks recreates original content
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

    // Adjust first boundary if there's only whitespace before it
    if (boundaries.length > 0) {
      const firstBoundary = boundaries[0];
      const firstBoundaryLine = firstBoundary.startLine;

      // Check if content before first boundary is only whitespace
      if (firstBoundaryLine > 1) {
        const linesBeforeFirstBoundary = lines.slice(0, firstBoundaryLine - 1);
        const contentBeforeFirstBoundary = linesBeforeFirstBoundary.join("\n");

        if (/^\s*$/.test(contentBeforeFirstBoundary)) {
          // Only whitespace before first boundary, adjust it to start from line 1
          firstBoundary.startLine = 1;
        }
      }
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

    // Step 4: Merge whitespace-only segments with previous segments
    const mergedSegments = this.mergeWhitespaceSegments(segments);

    // Step 5: Convert merged segments to chunks
    const chunks: ContentChunk[] = [];

    for (const segment of mergedSegments) {
      // Assign path and level based on containing boundary
      let path: string[];
      let level: number;

      if (segment.containingBoundary) {
        // Use the boundary's hierarchical path and level
        path = segment.containingBoundary.path || [
          segment.containingBoundary.name || "unnamed",
        ];
        level = segment.containingBoundary.level || path.length;
      } else {
        // No containing boundary, this is global code
        path = [];
        level = 0;
      }

      // Apply two-phase splitting - use TextContentSplitter on this segment
      const segmentChunks = await this.splitContentIntoChunks(
        segment.content,
        path,
        level,
      );
      chunks.push(...segmentChunks);
    }

    return chunks;
  }

  /**
   * Merges whitespace-only segments with the previous segment to preserve formatting
   */
  private mergeWhitespaceSegments(
    segments: Array<{
      startLine: number;
      endLine: number;
      content: string;
      containingBoundary?: CodeBoundary;
    }>,
  ): Array<{
    startLine: number;
    endLine: number;
    content: string;
    containingBoundary?: CodeBoundary;
  }> {
    if (segments.length === 0) {
      return segments;
    }

    const mergedSegments = [];

    for (let i = 0; i < segments.length; i++) {
      const currentSegment = segments[i];

      // Check if this segment contains only whitespace
      const isWhitespaceOnly = /^\s*$/.test(currentSegment.content);

      if (isWhitespaceOnly && mergedSegments.length > 0) {
        // Merge this whitespace segment with the previous segment
        const previousSegment = mergedSegments[mergedSegments.length - 1];
        previousSegment.content += currentSegment.content;
        previousSegment.endLine = currentSegment.endLine;
        // Keep the previous segment's containingBoundary
      } else {
        // Add as a new segment
        mergedSegments.push({ ...currentSegment });
      }
    }

    return mergedSegments;
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
