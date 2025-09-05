/**
 * BaseLanguageParser - Abstract base class for TreeSitter language parsers
 *
 * This class provides the foundation for language-specific TreeSitter parsers.
 * It handles the common parsing logic and defines the interface that concrete
 * language parsers must implement for structural node identification and
 * hierarchical code organization.
 */

import type { ContentChunk } from "../../types";
import type {
  LanguageDefinition,
  StructuralNode,
  StructuralNodeType,
  TreeSitterSplitterOptions,
} from "../types";

export abstract class BaseLanguageParser {
  protected options: TreeSitterSplitterOptions;

  constructor(options: Partial<TreeSitterSplitterOptions> = {}) {
    this.options = {
      maxChunkSize: options.maxChunkSize ?? 2000,
      preserveStructure: options.preserveStructure ?? true,
      includeDocumentation: options.includeDocumentation ?? true,
      includeModifiers: options.includeModifiers ?? true,
    };
  }

  /**
   * Get the language definition for this parser
   */
  abstract getLanguageDefinition(): LanguageDefinition;

  /**
   * Get TreeSitter language object for parsing
   */
  abstract getTreeSitterLanguage(): any;

  /**
   * Get the TreeSitter node types that represent structural elements
   * (e.g., function_definition, class_definition)
   */
  abstract getStructuralNodeTypes(): string[];

  /**
   * Extract the name/identifier from a structural node
   */
  abstract extractNodeName(node: any): string;

  /**
   * Extract modifiers from a structural node (e.g., public, static, async)
   */
  abstract extractNodeModifiers(node: any): string[];

  /**
   * Classify a TreeSitter node into a StructuralNodeType
   */
  abstract classifyStructuralNode(node: any): StructuralNodeType;

  /**
   * Extract documentation/comments associated with a structural node
   */
  abstract extractDocumentation(node: any, sourceCode: string): string | undefined;

  /**
   * Parse source code and extract structural nodes
   */
  async parseSourceCode(sourceCode: string): Promise<StructuralNode[]> {
    try {
      const TreeSitter = await this.getTreeSitterParser();
      const parser = new TreeSitter();
      parser.setLanguage(this.getTreeSitterLanguage());

      const tree = parser.parse(sourceCode);
      return this.extractStructuralNodes(tree.rootNode, sourceCode);
    } catch (error) {
      console.warn("TreeSitter parsing failed:", error);
      return [];
    }
  }

  /**
   * Split source code into content chunks using structural analysis
   */
  async splitText(content: string, contentType?: string): Promise<ContentChunk[]> {
    const structuralNodes = await this.parseSourceCode(content);
    return this.createChunksFromStructuralNodes(structuralNodes, content);
  }

  /**
   * Get TreeSitter Parser class (lazy-loaded)
   */
  private async getTreeSitterParser(): Promise<any> {
    // Use direct require instead of dynamic import for CommonJS compatibility
    const TreeSitter = require("tree-sitter");
    return TreeSitter;
  }

  /**
   * Recursively extract structural nodes from the AST
   */
  private extractStructuralNodes(node: any, sourceCode: string): StructuralNode[] {
    const structuralNodes: StructuralNode[] = [];
    const structuralNodeTypes = this.getStructuralNodeTypes();

    // Check if current node is structural
    if (structuralNodeTypes.includes(node.type)) {
      const structuralNode = this.createStructuralNode(node, sourceCode);
      if (structuralNode) {
        // Process child nodes and add them to this structural node
        for (const child of node.children) {
          const childNodes = this.extractStructuralNodes(child, sourceCode);
          structuralNode.children.push(...childNodes);
        }
        structuralNodes.push(structuralNode);
      }
    } else {
      // Recursively process child nodes if current node is not structural
      for (const child of node.children) {
        const childNodes = this.extractStructuralNodes(child, sourceCode);
        structuralNodes.push(...childNodes);
      }
    }

    return structuralNodes;
  }

  /**
   * Create a StructuralNode from a TreeSitter node
   */
  private createStructuralNode(node: any, sourceCode: string): StructuralNode | null {
    try {
      const name = this.extractNodeName(node);
      if (!name) {
        return null;
      }

      const modifiers = this.extractNodeModifiers(node);
      const documentation = this.options.includeDocumentation 
        ? this.extractDocumentation(node, sourceCode) 
        : undefined;

      return {
        type: this.classifyStructuralNode(node),
        name,
        modifiers: this.options.includeModifiers ? modifiers : [],
        startPosition: {
          row: node.startPosition.row,
          column: node.startPosition.column,
        },
        endPosition: {
          row: node.endPosition.row,
          column: node.endPosition.column,
        },
        documentation,
        children: [],
        node,
      };
    } catch (error) {
      // Skip nodes that can't be processed
      return null;
    }
  }

  /**
   * Create content chunks from structural nodes with hierarchical paths
   */
  private createChunksFromStructuralNodes(
    structuralNodes: StructuralNode[],
    sourceCode: string
  ): ContentChunk[] {
    const chunks: ContentChunk[] = [];
    const lines = sourceCode.split("\n");

    for (const node of structuralNodes) {
      this.createChunksFromNode(node, lines, [], chunks);
    }

    return chunks;
  }

  /**
   * Recursively create chunks from a structural node and its children
   */
  private createChunksFromNode(
    node: StructuralNode,
    lines: string[],
    parentPath: string[],
    chunks: ContentChunk[]
  ): void {
    const currentPath = [...parentPath, node.name];
    
    // Extract the content for this node
    const nodeContent = this.extractNodeContent(node, lines);
    
    // Create chunk if content is meaningful
    if (nodeContent.trim()) {
      let finalContent = nodeContent;
      
      // Prepend documentation if available
      if (node.documentation && this.options.includeDocumentation) {
        finalContent = `${node.documentation}\n\n${nodeContent}`;
      }

      chunks.push({
        types: ["code"],
        content: finalContent.trim(),
        section: {
          level: currentPath.length,
          path: currentPath,
        },
      });
    }

    // Process child nodes
    for (const child of node.children) {
      this.createChunksFromNode(child, lines, currentPath, chunks);
    }
  }

  /**
   * Extract source code content for a structural node
   */
  private extractNodeContent(node: StructuralNode, lines: string[]): string {
    const startRow = node.startPosition.row;
    const endRow = node.endPosition.row;
    
    // Extract lines for this node
    const nodeLines = lines.slice(startRow, endRow + 1);
    
    if (nodeLines.length === 0) {
      return "";
    }
    
    // Handle single line case
    if (startRow === endRow) {
      const line = lines[startRow] || "";
      const startCol = node.startPosition.column;
      const endCol = node.endPosition.column;
      return line.substring(startCol, endCol);
    }
    
    // Handle multi-line case
    let result = nodeLines.join("\n");
    
    // For multi-line, we typically want the whole lines
    // The TreeSitter positions are usually accurate for whole constructs
    return result;
  }
}