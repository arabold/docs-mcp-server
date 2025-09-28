/**
 * Common document content type shared across modules
 */
export interface Document {
  content: string;
  metadata: DocumentMetadata;
  contentType?: string; // MIME type of the original content
}

/**
 * Page-level metadata stored in the pages table
 */
export interface PageMetadata {
  url: string;
  title: string;
  etag?: string;
  lastModified?: string;
  contentType?: string;
}

/**
 * Chunk-level metadata stored with each document chunk
 */
export interface ChunkMetadata {
  level?: number; // Hierarchical level in document
  path?: string[]; // Hierarchical path in document
  // Allow for additional chunk-specific metadata
  [key: string]: unknown;
}

/**
 * Common metadata fields shared across document chunks
 * This combines page-level and chunk-level metadata for backward compatibility
 */
export interface DocumentMetadata extends ChunkMetadata {
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
