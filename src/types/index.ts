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
