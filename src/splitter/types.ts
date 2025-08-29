/**
 * Types of content within a document section
 */
export type SectionContentType = "text" | "code" | "table" | "heading";

/**
 * Final output chunk after processing and size-based splitting
 */
export interface ContentChunk {
  types: SectionContentType[];
  content: string;
  section: {
    level: number;
    path: string[];
  };
}

/**
 * Interface for a splitter that processes markdown content into chunks
 */
export interface DocumentSplitter {
  splitText(markdown: string, contentType?: string): Promise<ContentChunk[]>;
}
