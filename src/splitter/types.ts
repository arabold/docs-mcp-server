/**
 * Types of content within a document section
 */
export type SectionContentType = "text" | "code" | "table" | "heading" | "structural";

/**
 * Final output chunk after processing and size-based splitting
 */
export interface Chunk {
  types: SectionContentType[];
  content: string;
  section: {
    level: number;
    path: string[];
  };
}

/**
 * Configuration for document splitting
 */
export interface SplitterConfig {
  minChunkSize: number;
  preferredChunkSize: number;
  maxChunkSize: number;
  json?: {
    maxNestingDepth: number;
    maxChunks: number;
  };
  treeSitterSizeLimit?: number;
}

/**
 * Interface for a splitter that processes markdown content into chunks
 */
export interface DocumentSplitter {
  splitText(markdown: string, contentType?: string): Promise<Chunk[]>;
}
