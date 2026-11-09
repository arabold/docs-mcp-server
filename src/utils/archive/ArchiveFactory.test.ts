import path from "node:path";
import { describe, expect, it } from "vitest";
import { getArchiveAdapter } from "./ArchiveFactory";
import { TarAdapter } from "./TarAdapter";
import { ZipAdapter } from "./ZipAdapter";

const FIXTURES_DIR = path.resolve(__dirname, "../../../test/fixtures");

describe("getArchiveAdapter", () => {
  it("picks the adapter by file extension", async () => {
    const cases: Array<
      [filePath: string, adapter: typeof ZipAdapter | typeof TarAdapter]
    > = [
      [path.join(FIXTURES_DIR, "archive.zip"), ZipAdapter],
      ["/tmp/test.tar", TarAdapter],
      ["/tmp/test.gz", TarAdapter],
      ["/tmp/test.tgz", TarAdapter],
    ];

    for (const [filePath, adapterClass] of cases) {
      const adapter = await getArchiveAdapter(filePath);
      expect.soft(adapter, filePath).toBeInstanceOf(adapterClass);
      await adapter?.close();
    }
  });

  it("returns null for files that are not archives", async () => {
    const filePaths = [
      // DOCX, XLSX, PPTX, EPUB and ODF files are ZIP archives inside, but they
      // must reach DocumentPipeline instead of being unpacked.
      ...[".docx", ".xlsx", ".pptx", ".epub", ".odt", ".ods", ".odp"].map((ext) =>
        path.join(FIXTURES_DIR, `sample${ext}`),
      ),
      "/tmp/somefile",
      "/tmp/test.bin",
    ];

    for (const filePath of filePaths) {
      expect.soft(await getArchiveAdapter(filePath), filePath).toBeNull();
    }
  });
});
