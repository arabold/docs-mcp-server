import fs from "node:fs";
import { Readable } from "node:stream";
import * as tar from "tar";
import type { ArchiveAdapter, ArchiveEntry } from "./types";

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

  async getContent(path: string): Promise<Buffer> {
    const stream = await this.getStream(path);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
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
