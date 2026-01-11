import { Readable } from "node:stream";
import yauzl from "yauzl";
import { logger } from "../logger";
import type { ArchiveAdapter, ArchiveEntry } from "./types";

export class ZipAdapter implements ArchiveAdapter {
  private zipfile: yauzl.ZipFile | null = null;
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  private async getZipFile(): Promise<yauzl.ZipFile> {
    if (this.zipfile) return this.zipfile;

    return new Promise((resolve, reject) => {
      yauzl.open(this.filePath, { lazyEntries: true }, (err, zipfile) => {
        if (err) return reject(err);
        if (!zipfile) return reject(new Error("Failed to open zip file"));
        this.zipfile = zipfile;
        resolve(zipfile);
      });
    });
  }

  async *listEntries(): AsyncGenerator<ArchiveEntry> {
    const zipfile = await this.getZipFile();
    // We need to restart reading from the beginning if we've read before
    // But yauzl is sequential. If we are already open, we might be in a weird state
    // if not carefully managed. Ideally we read all entries once and cache, or
    // we re-open. For simplicity/safety, let's assume valid usage or handle state.
    // Actually, yauzl allows reading entries. Let's do standard event loop.

    // If zipfile is already open and partly read, we can't easily reset without reopening.
    // For this implementation, let's just ensure we start fresh if needed, or rely on
    // single-pass usage patterns. To be safe, let's close and reopen if we need to list again?
    // Or just cache entries? Caching is safer for repeated access.

    // Let's implement a scan.
    await new Promise<void>((resolve, reject) => {
      if (!this.zipfile) {
        // Should be opened by getZipFile, but let's ensure we are at start
        this.getZipFile()
          .then(() => resolve())
          .catch(reject);
      } else {
        // If already open, we might be in middle of reading.
        // yauzl doesn't support seeking back easily without reopening.
        // For now, let's assume we scan once.
        resolve();
      }
    });

    if (!this.zipfile) throw new Error("Zip file not open");

    // We'll queue entries found
    const entries: ArchiveEntry[] = [];
    let entriesResolved = false;
    let error: Error | null = null;

    // We can't easily yield from inside the event listener directly in a simple loop
    // so we buffer them or use a queue.
    // Given the "stream" nature, let's wrap the event emitter in an async generator.

    // Reset cursor not possible easily. We assume listEntries is called once or we reopen.
    // Better: Cache entries on first read?
    // Let's reopen for listing to be safe.
    if (this.zipfile.isOpen) {
      this.zipfile.close();
      this.zipfile = null;
    }
    const z = await this.getZipFile();

    const entryStream = new Readable({
      objectMode: true,
      read() {
        z.readEntry();
      },
    });

    z.on("entry", (entry: yauzl.Entry) => {
      const isDir = entry.fileName.endsWith("/");
      entryStream.push({
        path: entry.fileName,
        type: isDir ? "directory" : "file",
        size: entry.uncompressedSize,
      } as ArchiveEntry);
    });

    z.on("end", () => {
      entryStream.push(null);
    });

    z.on("error", (err) => {
      entryStream.destroy(err);
    });

    for await (const entry of entryStream) {
      yield entry as ArchiveEntry;
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
    // For random access in yauzl, we need to iterate entries until we find match?
    // Or use internal index? yauzl keeps central directory.
    // But standard usage is iterate.
    // Wait, yauzl optimized usage is readEntry().
    // If we want random access, we should probably read all entries once, store their
    // offset/index, or just iterate until found.
    // Iterating for every file read is slow for large zips.
    // But `yauzl` isn't "random access" by filename directly.
    // We have to scan.
    // Optimization: When listing entries, map filename -> entry object.

    // Let's implement a cache of entries on first load.
    if (!this.entriesCache) {
      await this.loadEntries();
    }

    const entry = this.entriesCache?.get(path);
    if (!entry) {
      throw new Error(`File not found in zip: ${path}`);
    }

    const z = await this.getZipFile();
    return new Promise((resolve, reject) => {
      z.openReadStream(entry, (err, readStream) => {
        if (err) return reject(err);
        if (!readStream) return reject(new Error("Failed to create read stream"));
        resolve(readStream);
      });
    });
  }

  private entriesCache: Map<string, yauzl.Entry> | null = null;

  private async loadEntries(): Promise<void> {
    if (this.entriesCache) return;
    this.entriesCache = new Map();

    // Ensure clean state
    if (this.zipfile) {
      this.zipfile.close();
      this.zipfile = null;
    }
    const z = await this.getZipFile();

    return new Promise((resolve, reject) => {
      z.on("entry", (entry: yauzl.Entry) => {
        this.entriesCache?.set(entry.fileName, entry);
        z.readEntry();
      });
      z.on("end", () => resolve());
      z.on("error", (err) => reject(err));
      z.readEntry();
    });
  }

  async close(): Promise<void> {
    if (this.zipfile) {
      this.zipfile.close();
      this.zipfile = null;
    }
    this.entriesCache = null;
  }
}
