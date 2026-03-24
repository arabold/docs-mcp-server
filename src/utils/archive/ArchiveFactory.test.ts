import path from "node:path";
import { describe, expect, it } from "vitest";
import { getArchiveAdapter } from "./ArchiveFactory";
import { TarAdapter } from "./TarAdapter";
import { ZipAdapter } from "./ZipAdapter";

const FIXTURES_DIR = path.resolve(__dirname, "../../../test/fixtures");

describe("getArchiveAdapter", () => {
  describe("recognized archive extensions", () => {
    it("should return ZipAdapter for .zip files", async () => {
      const adapter = await getArchiveAdapter(path.join(FIXTURES_DIR, "archive.zip"));
      expect(adapter).toBeInstanceOf(ZipAdapter);
      await adapter?.close();
    });

    it("should return TarAdapter for .tar files", async () => {
      const adapter = await getArchiveAdapter("/tmp/test.tar");
      expect(adapter).toBeInstanceOf(TarAdapter);
    });

    it("should return TarAdapter for .gz files", async () => {
      const adapter = await getArchiveAdapter("/tmp/test.gz");
      expect(adapter).toBeInstanceOf(TarAdapter);
    });

    it("should return TarAdapter for .tgz files", async () => {
      const adapter = await getArchiveAdapter("/tmp/test.tgz");
      expect(adapter).toBeInstanceOf(TarAdapter);
    });
  });

  describe("ZIP-based document formats must not be treated as archives", () => {
    it.each([
      ".docx",
      ".xlsx",
      ".pptx",
      ".epub",
      ".odt",
      ".ods",
      ".odp",
    ])("should return null for %s files", async (ext) => {
      const adapter = await getArchiveAdapter(path.join(FIXTURES_DIR, `sample${ext}`));
      expect(adapter).toBeNull();
    });

    it("should return null for real .docx fixture (ZIP-based)", async () => {
      // Verify with a real .docx file that starts with PK magic bytes
      const adapter = await getArchiveAdapter(path.join(FIXTURES_DIR, "sample.docx"));
      expect(adapter).toBeNull();
    });

    it("should return null for real .xlsx fixture (ZIP-based)", async () => {
      const adapter = await getArchiveAdapter(path.join(FIXTURES_DIR, "sample.xlsx"));
      expect(adapter).toBeNull();
    });

    it("should return null for real .pptx fixture (ZIP-based)", async () => {
      const adapter = await getArchiveAdapter(path.join(FIXTURES_DIR, "sample.pptx"));
      expect(adapter).toBeNull();
    });
  });

  describe("extensionless and unknown files", () => {
    it("should return null for files without an extension", async () => {
      const adapter = await getArchiveAdapter("/tmp/somefile");
      expect(adapter).toBeNull();
    });

    it("should return null for unrecognized extensions", async () => {
      const adapter = await getArchiveAdapter("/tmp/test.bin");
      expect(adapter).toBeNull();
    });
  });
});
