/**
 * Common document content type shared across modules
 */
export interface Document {
  content: string;
  metadata: DocumentMetadata;
  contentType?: string; // MIME type of the original content
}

/**
 * Common metadata fields shared across document chunks
 */
export interface DocumentMetadata {
  url: string;
  title: string;
  library: string;
  version: string;
  level?: number; // Optional during scraping
  path?: string[]; // Optional during scraping
}

/**
 * Generic progress callback type
 */
export type ProgressCallback<T> = (progress: T) => void | Promise<void>;

/**
 * Standard progress response format
 */
export interface ProgressResponse {
  content: { type: string; text: string }[];
}
