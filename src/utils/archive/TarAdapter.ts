import fs from "node:fs";
import { Readable } from "node:stream";
import * as tar from "tar";
import type { ArchiveAdapter, ArchiveEntry } from "./types";

/** An archive's entries read in one pass, and the error that ended the pass early, if any. */
interface ReadEntries {
  entries: Map<string, { index: number; content: Buffer }>;
  error?: Error;
}

/** The entries of the archive last read whole, by file, modification time and size. */
let lastRead:
  | { filePath: string; mtimeMs: number; size: number; read: Promise<ReadEntries> }
  | undefined;

export class TarAdapter implements ArchiveAdapter {
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async *listEntries(): AsyncGenerator<ArchiveEntry> {
    const fileStream = fs.createReadStream(this.filePath);
    const parseStream = new tar.Parser();

    fileStream.pipe(parseStream);

    const entryStream = new Readable({ objectMode: true, read() {} });

    parseStream.on("entry", (entry: tar.ReadEntry) => {
      const isDir = entry.type === "Directory";
      const path = entry.path;
      const size = entry.size;

      entryStream.push({
        path,
        type: isDir ? "directory" : "file",
        size,
      } as ArchiveEntry);

      // Important: resume to skip data so we get next entry
      entry.resume();
    });

    parseStream.on("end", () => entryStream.push(null));
    parseStream.on("error", (err: Error) => entryStream.destroy(err));
    fileStream.on("error", (err: Error) => entryStream.destroy(err));

    try {
      for await (const entry of entryStream) {
        yield entry as ArchiveEntry;
      }
    } finally {
      fileStream.destroy();
    }
  }

  /**
   * Reads an entry from the archive's entries read in one pass. A crawl lists an
   * archive's members together and then reads them one after another, so each
   * member is a lookup rather than a pass over the archive from its start, as
   * `getStream` makes. Of the entries an archive repeats, the first is kept, as
   * `getStream` returns the first match.
   */
  async getContent(path: string): Promise<Buffer> {
    const { mtimeMs, size } = await fs.promises.stat(this.filePath);
    if (
      lastRead?.filePath !== this.filePath ||
      lastRead.mtimeMs !== mtimeMs ||
      lastRead.size !== size
    ) {
      lastRead = { filePath: this.filePath, mtimeMs, size, read: this.readEntries() };
    }
    const { entries, error } = await lastRead.read;
    let first: { index: number; content: Buffer } | undefined;
    for (const candidate of [path, `./${path}`, path.replace(/^\//, "")]) {
      const entry = entries.get(candidate);
      if (entry && (first === undefined || entry.index < first.index)) {
        first = entry;
      }
    }
    if (first !== undefined) {
      return first.content;
    }
    throw error ?? new Error(`File not found in tar: ${path}`);
  }

  /** Reads every entry whole, keeping those read before an error ends the pass. */
  private readEntries(): Promise<ReadEntries> {
    return new Promise((resolve) => {
      const entries: ReadEntries["entries"] = new Map();
      const fileStream = fs.createReadStream(this.filePath);
      const parseStream = new tar.Parser();
      let index = 0;
      parseStream.on("entry", (entry: tar.ReadEntry) => {
        const position = index++;
        const chunks: Buffer[] = [];
        entry.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
        entry.on("end", () => {
          if (!entries.has(entry.path)) {
            entries.set(entry.path, { index: position, content: Buffer.concat(chunks) });
          }
        });
      });
      parseStream.on("end", () => resolve({ entries }));
      parseStream.on("error", (error: Error) => {
        fileStream.destroy();
        resolve({ entries, error });
      });
      fileStream.on("error", (error: Error) => {
        // @ts-expect-error
        if (typeof parseStream.destroy === "function") parseStream.destroy();
        resolve({ entries, error });
      });
      fileStream.pipe(parseStream);
    });
  }

  async getStream(path: string): Promise<Readable> {
    return new Promise((resolve, reject) => {
      const fileStream = fs.createReadStream(this.filePath);
      const parseStream = new tar.Parser();
      let found = false;

      parseStream.on("entry", (entry: tar.ReadEntry) => {
        if (found) {
          entry.resume();
          return;
        }

        // Normalize paths? Tar paths often relative.
        // Check for exact match or ./ match
        if (
          entry.path === path ||
          entry.path === `./${path}` ||
          entry.path === path.replace(/^\//, "")
        ) {
          found = true;
          // We return the entry as a Readable stream
          resolve(entry as unknown as Readable);
        } else {
          entry.resume();
        }
      });

      parseStream.on("end", () => {
        if (!found) reject(new Error(`File not found in tar: ${path}`));
      });

      parseStream.on("error", (err: Error) => {
        fileStream.destroy();
        reject(err);
      });
      fileStream.on("error", (err: Error) => {
        // parseStream.destroy() might not exist on all versions or types,
        // but fileStream is the source.
        // @ts-expect-error
        if (typeof parseStream.destroy === "function") parseStream.destroy();
        reject(err);
      });

      fileStream.pipe(parseStream);
    });
  }

  async close(): Promise<void> {
    return Promise.resolve();
  }
}
