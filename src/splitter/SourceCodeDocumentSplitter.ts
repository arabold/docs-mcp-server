/**
 * SourceCodeDocumentSplitter - Hierarchical source code splitting with boundary detection
 *
 * Creates hierarchical, concatenable chunks from TypeScript and JavaScript source code files.
 * Uses boundary detection to identify structural elements (classes, functions, methods) and
 * delegates content processing to TextDocumentSplitter for method bodies and loose code.
 *
 * Architecture:
 * 1. Detect structural boundaries using regex patterns
 * 2. Split source code at these boundaries (line-based to preserve formatting)
 * 3. Delegate content processing to TextDocumentSplitter for method bodies
 * 4. Create hierarchical chunks with proper paths for reassembly
 *
 * Follows the concatenable pattern established by JsonDocumentSplitter.
 */

import { TextDocumentSplitter } from "./TextDocumentSplitter";
import type { ContentChunk, DocumentSplitter } from "./types";

/**
 * Represents a detected structural boundary in source code
 */
interface Boundary {
  type:
    | "class"
    | "namespace"
    | "function"
    | "method"
    | "constructor"
    | "interface"
    | "type";
  name: string;
  startLine: number;
  endLine: number;
  indentLevel: number;
  modifiers: string[]; // export, async, abstract, etc.
  openingBrace: number; // line number of opening brace
  closingBrace: number; // line number of closing brace
}

/**
 * Represents a section of code between boundaries
 */
interface Section {
  type: "structural" | "content";
  content: string;
  boundary?: Boundary;
  startLine: number;
  endLine: number;
  indentLevel: number;
}

/**
 * Configuration options for source code document splitting
 */
export interface SourceCodeDocumentSplitterOptions {
  /** Maximum size for individual chunks before delegating to TextSplitter */
  maxChunkSize?: number;
  /** Whether to preserve original formatting and indentation */
  preserveFormatting?: boolean;
  /** Languages to support (currently: typescript, javascript) */
  supportedLanguages?: string[];
}

/**
 * Source code document splitter for TypeScript and JavaScript files.
 * Creates hierarchical, concatenable chunks that preserve code structure
 * while enabling effective semantic search.
 */
export class SourceCodeDocumentSplitter implements DocumentSplitter {
  private readonly textSplitter: TextDocumentSplitter;
  private readonly options: Required<SourceCodeDocumentSplitterOptions>;

  // Regex patterns for detecting structural boundaries
  private readonly boundaryPatterns = {
    class: /^(\s*)(export\s+)?(abstract\s+)?class\s+(\w+)/,
    namespace: /^(\s*)(export\s+)?namespace\s+(\w+)/,
    function: /^(\s*)(export\s+)?(async\s+)?function\s+(\w+)/,
    method:
      /^(\s*)(async\s+)?(?:(private|public|protected)\s+)?(static\s+)?(async\s+)?(\w+)\s*\([^)]*\)\s*[:{]/,
    constructor: /^(\s*)constructor\s*\([^)]*\)\s*{/,
    interface: /^(\s*)(export\s+)?interface\s+(\w+)/,
    type: /^(\s*)(export\s+)?type\s+(\w+)\s*=/,
  };

  constructor(options: SourceCodeDocumentSplitterOptions = {}) {
    this.options = {
      maxChunkSize: options.maxChunkSize ?? 2000,
      preserveFormatting: options.preserveFormatting ?? true,
      supportedLanguages: options.supportedLanguages ?? ["typescript", "javascript"],
    };

    // Create TextDocumentSplitter for content delegation
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

    // Check if this is a supported language
    if (!this.isSupportedLanguage(contentType)) {
      // Fall back to TextDocumentSplitter for unsupported languages
      return this.textSplitter.splitText(content, contentType);
    }

    try {
      // Phase 1: Detect boundaries
      const boundaries = this.detectBoundaries(content);

      // Phase 2: Split content at boundaries
      const sections = this.splitAtBoundaries(content, boundaries);

      // Phase 3: Process each section
      const allChunks: ContentChunk[] = [];
      const rootPath = this.createRootPath(contentType);

      for (const section of sections) {
        const chunks = await this.processSection(section, rootPath);
        allChunks.push(...chunks);
      }

      return allChunks;
    } catch (error) {
      // Graceful fallback to TextDocumentSplitter on any parsing error
      console.warn(
        "SourceCodeDocumentSplitter failed, falling back to TextDocumentSplitter:",
        error,
      );
      return this.textSplitter.splitText(content, contentType);
    }
  }

  /**
   * Check if the content type is supported by this splitter
   */
  private isSupportedLanguage(contentType?: string): boolean {
    if (!contentType) return false;

    const supportedMimeTypes = [
      "text/typescript",
      "application/typescript",
      "text/javascript",
      "application/javascript",
    ];

    return supportedMimeTypes.includes(contentType.toLowerCase());
  }

  /**
   * Create root path based on content type
   */
  private createRootPath(contentType?: string): string[] {
    if (contentType?.includes("typescript")) {
      return ["typescript-file"];
    } else if (contentType?.includes("javascript")) {
      return ["javascript-file"];
    }
    return ["source-file"];
  }

  /**
   * Detect top-level structural boundaries in the source code
   * Only detects boundaries that are not inside other structures
   */
  private detectBoundaries(content: string): Boundary[] {
    const lines = content.split("\n");
    const boundaries: Boundary[] = [];
    const processedLines = new Set<number>();

    for (let i = 0; i < lines.length; i++) {
      if (processedLines.has(i)) continue;

      const line = lines[i];

      // Check each boundary pattern (excluding methods for now - they'll be handled inside classes)
      for (const [type, pattern] of Object.entries(this.boundaryPatterns)) {
        if (type === "method" || type === "constructor") continue; // Skip methods at top level, handle them inside classes

        const match = line.match(pattern);
        if (match) {
          // console.log(`Detected ${type} boundary at line ${i}: "${line.trim()}"`);
          const boundary = this.createBoundary(type as Boundary["type"], match, i, lines);
          if (boundary) {
            // console.log(`Created boundary: ${boundary.name} (lines ${boundary.startLine}-${boundary.endLine})`);
            boundaries.push(boundary);
            // Mark all lines of this boundary as processed
            for (let j = boundary.startLine; j <= boundary.endLine; j++) {
              processedLines.add(j);
            }
            break; // Found a match, don't check other patterns for this line
          }
        }
      }
    }

    // console.log(`Total boundaries detected: ${boundaries.length}`);
    return boundaries;
  }

  /**
   * Create a boundary object from regex match
   */
  private createBoundary(
    type: Boundary["type"],
    match: RegExpMatchArray,
    lineIndex: number,
    lines: string[],
  ): Boundary | null {
    const indent = match[1] || "";
    const indentLevel = Math.floor(indent.length / 2); // Assuming 2-space indentation

    // Extract name based on boundary type
    let name: string;
    const modifiers: string[] = [];

    switch (type) {
      case "class":
        name = match[4] || "";
        if (match[2]) modifiers.push("export");
        if (match[3]) modifiers.push("abstract");
        break;
      case "namespace":
        name = match[3] || "";
        if (match[2]) modifiers.push("export");
        break;
      case "interface":
        name = match[3] || "";
        if (match[2]) modifiers.push("export");
        break;
      case "function":
        name = match[4] || "";
        if (match[2]) modifiers.push("export");
        if (match[3]) modifiers.push("async");
        break;
      case "method":
        // Handle methods with various modifiers
        // Match groups: [full, indent, async?, visibility?, static?, async2?, name]
        name = match[6] || ""; // method name is in the 6th group
        if (match[2]) modifiers.push("async");
        if (match[3]) modifiers.push(match[3]); // visibility
        if (match[4]) modifiers.push("static");
        if (match[5]) modifiers.push("async");
        break;
      case "constructor":
        name = "constructor";
        break;
      case "type":
        name = match[3] || "";
        if (match[2]) modifiers.push("export");
        break;
      default:
        // console.log(`Unknown boundary type: ${type}`);
        return null;
    }

    if (!name) {
      // console.log(`No name found for ${type} boundary at line ${lineIndex}`);
      return null;
    }

    // Find matching braces
    const braceInfo = this.findMatchingBraces(lineIndex, lines);
    if (!braceInfo) {
      // console.log(`No matching braces found for ${type} ${name} at line ${lineIndex}`);
      return null;
    }

    // console.log(`Successfully created ${type} boundary: ${name} (${braceInfo.openingLine}-${braceInfo.closingLine})`);

    return {
      type,
      name,
      startLine: lineIndex,
      endLine: braceInfo.closingLine,
      indentLevel,
      modifiers,
      openingBrace: braceInfo.openingLine,
      closingBrace: braceInfo.closingLine,
    };
  }

  /**
   * Find matching opening and closing braces for a boundary
   */
  private findMatchingBraces(
    startLine: number,
    lines: string[],
  ): { openingLine: number; closingLine: number } | null {
    let openingLine = -1;
    let braceCount = 0;
    let inString = false;
    let inComment = false;
    let stringChar = "";

    // Find opening brace
    for (let i = startLine; i < lines.length; i++) {
      const line = lines[i];

      for (let j = 0; j < line.length; j++) {
        const char = line[j];
        const nextChar = line[j + 1];

        // Handle string literals
        if (!inComment && (char === '"' || char === "'" || char === "`")) {
          if (!inString) {
            inString = true;
            stringChar = char;
          } else if (char === stringChar && line[j - 1] !== "\\") {
            inString = false;
            stringChar = "";
          }
          continue;
        }

        // Handle comments
        if (!inString) {
          if (char === "/" && nextChar === "/") {
            inComment = true;
            break; // Rest of line is comment
          }
          if (char === "/" && nextChar === "*") {
            // TODO: Handle multi-line comments properly
          }
        }

        if (!inString && !inComment) {
          if (char === "{") {
            if (braceCount === 0) {
              openingLine = i;
            }
            braceCount++;
          } else if (char === "}") {
            braceCount--;
            if (braceCount === 0) {
              return { openingLine, closingLine: i };
            }
          }
        }
      }

      inComment = false; // Reset comment state at end of line
    }

    return null; // No matching braces found
  }

  /**
   * Split content into sections at detected boundaries
   */
  private splitAtBoundaries(content: string, boundaries: Boundary[]): Section[] {
    const lines = content.split("\n");
    const sections: Section[] = [];
    let lastLineProcessed = -1;

    for (const boundary of boundaries) {
      // Add content section before this boundary
      if (boundary.startLine > lastLineProcessed + 1) {
        const contentLines = lines.slice(lastLineProcessed + 1, boundary.startLine);
        const contentText = contentLines.join("\n").trim();

        if (contentText) {
          sections.push({
            type: "content",
            content: contentText,
            startLine: lastLineProcessed + 1,
            endLine: boundary.startLine - 1,
            indentLevel: this.calculateIndentLevel(contentText),
          });
        }
      }

      // Add structural section for this boundary
      const structuralLines = lines.slice(boundary.startLine, boundary.endLine + 1);
      sections.push({
        type: "structural",
        content: structuralLines.join("\n"),
        boundary,
        startLine: boundary.startLine,
        endLine: boundary.endLine,
        indentLevel: boundary.indentLevel,
      });

      lastLineProcessed = boundary.endLine;
    }

    // Add remaining content after last boundary
    if (lastLineProcessed + 1 < lines.length) {
      const remainingLines = lines.slice(lastLineProcessed + 1);
      const remainingText = remainingLines.join("\n").trim();

      if (remainingText) {
        sections.push({
          type: "content",
          content: remainingText,
          startLine: lastLineProcessed + 1,
          endLine: lines.length - 1,
          indentLevel: this.calculateIndentLevel(remainingText),
        });
      }
    }

    return sections;
  }

  /**
   * Calculate indent level from content
   */
  private calculateIndentLevel(content: string): number {
    const lines = content.split("\n").filter((line) => line.trim());
    if (lines.length === 0) return 0;

    const firstLine = lines[0];
    const leadingSpaces = firstLine.match(/^(\s*)/)?.[1] || "";
    return Math.floor(leadingSpaces.length / 2);
  }

  /**
   * Process a section and return appropriate chunks
   */
  private async processSection(
    section: Section,
    rootPath: string[],
  ): Promise<ContentChunk[]> {
    if (section.type === "structural") {
      return this.processStructuralSection(section, rootPath);
    } else {
      return this.processContentSection(section, rootPath);
    }
  }

  /**
   * Process a structural section (class, function, etc.)
   */
  private async processStructuralSection(
    section: Section,
    rootPath: string[],
  ): Promise<ContentChunk[]> {
    const boundary = section.boundary;
    if (!boundary) {
      throw new Error("Structural section must have a boundary");
    }
    const lines = section.content.split("\n");
    const chunks: ContentChunk[] = [];

    // Create path for this structural element
    const currentPath = [...rootPath, boundary.name];

    // Create opening chunk (declaration line + opening brace)
    const openingLines = lines.slice(0, boundary.openingBrace - boundary.startLine + 1);
    chunks.push({
      types: ["code"],
      content: openingLines.join("\n"),
      section: {
        level: currentPath.length,
        path: [...currentPath],
      },
    });

    // Process content between braces
    const contentStartLine = boundary.openingBrace - boundary.startLine + 1;
    const contentEndLine = boundary.closingBrace - boundary.startLine;

    if (contentStartLine < contentEndLine) {
      const innerContent = lines
        .slice(contentStartLine, contentEndLine)
        .join("\n")
        .trim();

      if (innerContent) {
        // For classes and namespaces, look for methods and nested structures
        if (boundary.type === "class" || boundary.type === "namespace") {
          const nestedChunks = await this.processNestedContent(innerContent, currentPath);
          chunks.push(...nestedChunks);
        } else {
          // For functions and other structures, treat as content
          chunks.push({
            types: ["code"],
            content: innerContent,
            section: {
              level: currentPath.length + 1,
              path: [...currentPath, "content"],
            },
          });
        }
      }
    }

    // Create closing chunk
    const closingLine = lines[boundary.closingBrace - boundary.startLine];
    chunks.push({
      types: ["code"],
      content: closingLine,
      section: {
        level: currentPath.length,
        path: [...currentPath],
      },
    });

    return chunks;
  }

  /**
   * Process nested content within classes and namespaces
   */
  private async processNestedContent(
    content: string,
    parentPath: string[],
  ): Promise<ContentChunk[]> {
    const lines = content.split("\n");
    const chunks: ContentChunk[] = [];
    const processedLines = new Set<number>();

    // Look for methods and constructors within the content
    for (let i = 0; i < lines.length; i++) {
      if (processedLines.has(i)) continue;

      const line = lines[i];

      // Check for constructor
      const constructorMatch = line.match(this.boundaryPatterns.constructor);
      if (constructorMatch) {
        const methodEndLine = this.findMethodEnd(i, lines);
        if (methodEndLine !== -1) {
          const methodLines = lines.slice(i, methodEndLine + 1);
          const methodContent = methodLines.join("\n");

          chunks.push({
            types: ["code"],
            content: methodContent,
            section: {
              level: parentPath.length + 1,
              path: [...parentPath, "constructor"],
            },
          });

          // Mark lines as processed
          for (let j = i; j <= methodEndLine; j++) {
            processedLines.add(j);
          }
          continue;
        }
      }

      // Check for regular methods
      const methodMatch = line.match(this.boundaryPatterns.method);
      if (methodMatch) {
        const methodName = methodMatch[6] || ""; // method name is in the 6th group
        if (methodName) {
          const methodEndLine = this.findMethodEnd(i, lines);
          if (methodEndLine !== -1) {
            const methodLines = lines.slice(i, methodEndLine + 1);
            const methodContent = methodLines.join("\n");

            chunks.push({
              types: ["code"],
              content: methodContent,
              section: {
                level: parentPath.length + 1,
                path: [...parentPath, methodName],
              },
            });

            // Mark lines as processed
            for (let j = i; j <= methodEndLine; j++) {
              processedLines.add(j);
            }
          }
        }
      }
    }

    // Process remaining content (properties, loose code, etc.)
    const remainingLines: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (!processedLines.has(i)) {
        remainingLines.push(lines[i]);
      }
    }

    if (remainingLines.length > 0) {
      const remainingContent = remainingLines.join("\n").trim();
      if (remainingContent) {
        // For simple content, create a single chunk rather than delegating to TextSplitter
        chunks.push({
          types: ["code"],
          content: remainingContent,
          section: {
            level: parentPath.length + 1,
            path: [...parentPath, "properties"],
          },
        });
      }
    }

    return chunks;
  }

  /**
   * Find the end line of a method by matching braces
   */
  private findMethodEnd(startLine: number, lines: string[]): number {
    let braceCount = 0;
    let foundOpeningBrace = false;

    for (let i = startLine; i < lines.length; i++) {
      const line = lines[i];

      for (const char of line) {
        if (char === "{") {
          braceCount++;
          foundOpeningBrace = true;
        } else if (char === "}") {
          braceCount--;
          if (foundOpeningBrace && braceCount === 0) {
            return i;
          }
        }
      }
    }

    return -1; // No matching brace found
  }

  /**
   * Process a content section (delegate to TextSplitter)
   */
  private async processContentSection(
    section: Section,
    rootPath: string[],
  ): Promise<ContentChunk[]> {
    const chunks = await this.textSplitter.splitText(section.content);

    // All file-level content chunks use the same root path
    // Multiple chunks with the same path are handled gracefully by the system
    return chunks.map((chunk) => ({
      ...chunk,
      section: {
        level: rootPath.length,
        path: rootPath,
      },
    }));
  }
}
