import type { DocumentStore } from "../DocumentStore";
import type { DbPageChunk } from "../types";

/**
 * Strategy interface for content-type-aware search result assembly.
 *
 * The strategy pattern focuses on selecting the right chunks for different content types
 * rather than complex assembly logic, leveraging splitter concatenation guarantees.
 */
export interface ContentAssemblyStrategy {
  /**
   * Determines if this strategy can handle the given MIME type.
   *
   * @param mimeType The MIME type to check (optional/undefined for unknown types)
   * @returns true if this strategy can handle the content type
   */
  canHandle(mimeType?: string): boolean;

  /**
   * Selects the appropriate chunks for assembly based on content type and structure.
   *
   * @param library The library name
   * @param version The library version
   * @param initialChunks The chunks that matched the search query
   * @param documentStore Document store for querying related chunks
   * @returns Promise resolving to chunks to be assembled
   */
  selectChunks(
    library: string,
    version: string,
    initialChunks: DbPageChunk[],
    documentStore: DocumentStore,
  ): Promise<DbPageChunk[]>;

  /**
   * Assembles the selected chunks into final content.
   *
   * @param chunks The chunks to assemble (already in proper order)
   * @returns The assembled content string
   */
  assembleContent(chunks: DbPageChunk[]): string;
}
