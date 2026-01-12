import type { Readable } from "node:stream";

export interface ArchiveEntry {
  path: string;
  type: "file" | "directory";
  size: number;
}

export interface ArchiveAdapter {
  /**
   * List all entries in the archive.
   */
  listEntries(): AsyncGenerator<ArchiveEntry>;

  /**
   * Get the content of a specific file entry as a buffer.
   * @param path The path of the file within the archive.
   */
  getContent(path: string): Promise<Buffer>;

  /**
   * Get the content of a specific file entry as a stream.
   * @param path The path of the file within the archive.
   */
  getStream(path: string): Promise<Readable>;

  /**
   * Close the archive and release resources.
   */
  close(): Promise<void>;
}
