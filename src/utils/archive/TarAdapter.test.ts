import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import fc from "fast-check";
import { Header } from "tar";
import { describe, expect, it } from "vitest";
import { TarAdapter } from "./TarAdapter";

interface Entry {
  path: string;
  type: "File" | "Directory";
  content: Uint8Array;
}

/** The bytes of a tar archive holding `entries` in order, repeats included, gzipped or not. */
function archive(entries: Entry[], gzip = true): Buffer {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const content = entry.type === "File" ? Buffer.from(entry.content) : Buffer.alloc(0);
    const header = new Header({
      path: entry.path,
      type: entry.type,
      size: content.length,
      mode: 0o644,
      mtime: new Date(0),
    });
    header.encode();
    blocks.push(header.block as Buffer, content);
    blocks.push(Buffer.alloc((512 - (content.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  const tar = Buffer.concat(blocks);
  return gzip ? zlib.gzipSync(tar) : tar;
}

/** A member as `getStream` reads it, as `getContent` read every member before. */
async function streamed(adapter: TarAdapter, member: string): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of await adapter.getStream(member)) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function outcome(
  read: Promise<Buffer>,
): Promise<{ content?: Buffer; error?: string }> {
  try {
    return { content: await read };
  } catch (error) {
    return { error: String(error) };
  }
}

describe("TarAdapter.getContent", () => {
  it("reads each member as getStream reads it, after each rewrite of the archive", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tar-adapter-"));
    // Few names, so entries repeat a path, with and without "./", as often as not.
    const name = fc.constantFrom("a", "b", "ab", "a/b");
    const prefixed = (prefixes: string[]) =>
      fc.tuple(fc.constantFrom(...prefixes), name).map(([prefix, rest]) => prefix + rest);
    const entry = fc.record({
      path: prefixed(["", "./"]),
      type: fc.constantFrom<Entry["type"]>("File", "Directory"),
      content: fc.uint8Array({ maxLength: 1500 }),
    });
    // Whole archives only: on a gzip stream cut short, getStream can resolve an entry whose data
    // never ends once tar's Parser aborts, so there is no answer to compare with.
    const version = fc.array(entry, { maxLength: 8 });
    let archives = 0;
    try {
      await fc.assert(
        fc.asyncProperty(
          fc.array(version, { minLength: 1, maxLength: 3 }),
          fc.array(prefixed(["", "/", "./"]), { minLength: 1, maxLength: 4 }),
          async (versions, members) => {
            const file = path.join(directory, `${archives++}.tar.gz`);
            let size = -1;
            let seconds = 0;
            // Each version gzipped, then plain, then plain with every byte inverted: the last two
            // are the same size, so only the mtime tells them apart.
            const rewrites = versions.flatMap((entries) => [
              archive(entries),
              archive(entries, false),
              archive(
                entries.map((entry) => ({
                  ...entry,
                  content: entry.content.map((b) => 255 - b),
                })),
                false,
              ),
            ]);
            for (const bytes of rewrites) {
              fs.writeFileSync(file, bytes);
              // A rewrite shows in the file's size or, where the size is the same, its mtime.
              if (bytes.length === size) {
                seconds += 1;
              }
              size = bytes.length;
              fs.utimesSync(file, seconds, seconds);
              const adapter = new TarAdapter(file);
              for (const member of members) {
                expect(await outcome(adapter.getContent(member))).toEqual(
                  await outcome(streamed(adapter, member)),
                );
              }
            }
          },
        ),
      );
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
