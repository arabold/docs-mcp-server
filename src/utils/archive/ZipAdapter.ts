import { Readable } from "node:stream";
import yauzl from "yauzl";
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
    // Ensure we start fresh
    if (this.zipfile) {
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
