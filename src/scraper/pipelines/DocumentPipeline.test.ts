/**
 * Tests for DocumentPipeline - processes PDF, Office documents, OpenDocument,
 * RTF, eBooks, and Jupyter notebooks using Xberg.
 */

import fs from "node:fs";
import path from "node:path";
import { extract } from "@xberg-io/xberg";
import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../../utils/config";
import { FetchStatus, type RawContent } from "../fetcher/types";
import type { ScraperOptions } from "../types";
import { ScrapeMode } from "../types";
import { DocumentPipeline } from "./DocumentPipeline";

vi.mock("@xberg-io/xberg", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import("@xberg-io/xberg");
  return {
    ...actual,
    extract: vi.fn(actual.extract),
  };
});

/** Wraps a single extracted document in Xberg's `ExtractionResult` envelope. */
function envelope(
  document: Record<string, unknown>,
): Awaited<ReturnType<typeof extract>> {
  return {
    results: [document],
    errors: [],
    summary: { inputs: 1, results: 1, errors: 0 },
  } as unknown as Awaited<ReturnType<typeof extract>>;
}

const appConfig = loadConfig();
const pipeline = new DocumentPipeline(appConfig);
const fixturesDir = path.resolve(__dirname, "../../../test/fixtures");

const baseOptions: ScraperOptions = {
  url: "file:///test",
  library: "test-library",
  version: "1.0.0",
  maxPages: 100,
  maxDepth: 3,
  scrapeMode: ScrapeMode.Auto,
};

function loadFixture(filename: string): Buffer {
  return fs.readFileSync(path.join(fixturesDir, filename));
}

function createRawContent(
  filename: string,
  mimeType: string,
  content: Buffer,
): RawContent {
  return {
    content,
    mimeType,
    source: `file://${path.join(fixturesDir, filename)}`,
    status: FetchStatus.SUCCESS,
  };
}

describe("DocumentPipeline", () => {
  describe("process", () => {
    it("should extract mixed DOCX content with tables and prose", async () => {
      const content = loadFixture("mixed-content.docx");
      const rawContent = createRawContent(
        "mixed-content.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        content,
      );

      const result = await pipeline.process(rawContent, baseOptions);

      expect(result.errors).toHaveLength(0);
      expect(result.contentType).toBe("text/markdown");
      expect(result.textContent).toContain("Mixed content sample");
      expect(result.textContent).toContain("Paragraph before table.");
      expect(result.textContent).toContain("Paragraph after table.");
      expect(result.textContent).toContain("| Header A | Header B |");
    });

    it("should process a PPTX file and extract its slide text", async () => {
      const content = loadFixture("sample.pptx");
      const rawContent = createRawContent(
        "sample.pptx",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        content,
      );

      const result = await pipeline.process(rawContent, baseOptions);

      expect(result.errors).toHaveLength(0);
      expect(result.contentType).toBe("text/markdown");
      expect(result.textContent).toContain("Presentation Title Text");
    });

    it("should process a Jupyter Notebook and extract content", async () => {
      const content = loadFixture("sample.ipynb");
      const rawContent = createRawContent(
        "sample.ipynb",
        "application/x-ipynb+json",
        content,
      );

      const result = await pipeline.process(rawContent, baseOptions);

      expect(result.errors).toHaveLength(0);
      expect(result.textContent).toBeTruthy();
      expect(result.textContent).toContain("Sample Jupyter Notebook");
      expect(result.contentType).toBe("text/markdown");
      expect(result.chunks).toBeDefined();
    });

    it("should reject documents exceeding size limit", async () => {
      // Create a small config with 100 byte limit
      const smallConfig = {
        ...appConfig,
        scraper: { ...appConfig.scraper, document: { maxSize: 100 } },
      };
      const smallPipeline = new DocumentPipeline(smallConfig);

      const content = loadFixture("sample.pdf");
      const rawContent = createRawContent("sample.pdf", "application/pdf", content);

      const result = await smallPipeline.process(rawContent, baseOptions);

      expect(result.errors).toHaveLength(1);
      expect(result.errors?.[0]?.message).toContain("exceeds maximum size");
      expect(result.textContent).toBeNull();
      expect(result.chunks).toHaveLength(0);
    });

    it("should pick the extractor from the served MIME type, not the URL", async () => {
      const content = loadFixture("sample.pdf");
      const sources = [
        "file:///no-extension",
        "https://example.com/documents/file.pdf/59569026-c221-12db-de3f-98becb9a67af?t=1767868182094",
      ];

      for (const source of sources) {
        const result = await pipeline.process(
          { content, mimeType: "application/pdf", source, status: FetchStatus.SUCCESS },
          baseOptions,
        );

        expect.soft(result.errors, source).toHaveLength(0);
        expect.soft(result.textContent, source).toContain("Avian Carriers");
        expect.soft(result.contentType, source).toBe("text/markdown");
      }
    });

    it("should use result.content for a PDF without tables, titled by its file name", async () => {
      // PDF extraction typically has no tables[], so content is used directly.
      const content = loadFixture("sample.pdf");
      const rawContent = createRawContent("sample.pdf", "application/pdf", content);

      const result = await pipeline.process(rawContent, baseOptions);

      expect(result.errors).toHaveLength(0);
      expect(result.textContent).toContain("Avian Carriers");
      expect(result.contentType).toBe("text/markdown");
      // sample.pdf carries no title metadata.
      expect(result.title).toBe("sample.pdf");
      expect(result.links).toEqual([]);
    });

    it("should include sheet names and table separators for XLSX", async () => {
      const content = loadFixture("sample.xlsx");
      const rawContent = createRawContent(
        "sample.xlsx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        content,
      );

      const result = await pipeline.process(rawContent, baseOptions);

      expect(result.errors).toHaveLength(0);
      expect(result.textContent).toBeTruthy();
      // Xberg renders each sheet as a Markdown heading followed by its table,
      // so `content` already carries the sheet name — the pipeline no longer
      // reconstructs headings from separate sheet-name metadata.
      expect(result.textContent).toContain("## Sheet1");
      expect(result.textContent).toContain("| --- | --- |");
    });

    it("should resolve application/octet-stream from the URL's document extension", async () => {
      const cases: Array<{
        label: string;
        source: string;
        content: Buffer;
        expected: { text: string; title: string } | { error: string };
      }> = [
        {
          label: "PDF extension",
          source: "https://cdn.example.com/files/report.pdf",
          content: loadFixture("sample.pdf"),
          expected: { text: "Avian Carriers", title: "report.pdf" },
        },
        {
          label: "DOCX extension before a query",
          source: "https://s3.amazonaws.com/bucket/report.docx?X-Amz-Signature=abc123",
          content: loadFixture("sample.docx"),
          expected: {
            text: "Demonstration of DOCX support in calibre",
            title: "DOCX Demo",
          },
        },
        {
          label: "no document extension",
          source: "https://example.com/api/download/12345",
          content: Buffer.from("not a real document"),
          expected: { error: "Could not determine document type" },
        },
      ];

      for (const { label, source, content, expected } of cases) {
        const result = await pipeline.process(
          {
            content,
            mimeType: "application/octet-stream",
            source,
            status: FetchStatus.SUCCESS,
          },
          baseOptions,
        );

        if ("error" in expected) {
          expect
            .soft(
              result.errors?.map((error) => error.message),
              label,
            )
            .toEqual([expect.stringContaining(expected.error)]);
          expect.soft(result.textContent, label).toBeNull();
        } else {
          expect.soft(result.errors, label).toHaveLength(0);
          expect.soft(result.textContent, label).toContain(expected.text);
          expect.soft(result.title, label).toBe(expected.title);
        }
      }
    });

    it("should log the underlying cause chain when extraction throws", async () => {
      // Regression guard for issue #394: when the native extraction binding
      // failed to load (glibc mismatch in Docker), the original log line
      // only said "Failed to convert document: Error" with no clue about the
      // actual underlying problem (`GLIBC_2.38 not found`). This test pins
      // the behavior that the wrapped Error.cause chain reaches the log.
      const { logger } = await import("../../utils/logger");
      const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});

      const wrapped = new Error("Failed to load Xberg native bindings", {
        cause: new Error(
          "/lib/aarch64-linux-gnu/libc.so.6: version `GLIBC_2.38' not found",
        ),
      });
      vi.mocked(extract).mockRejectedValueOnce(wrapped);

      const rawContent = createRawContent(
        "sample.pdf",
        "application/pdf",
        Buffer.from("%PDF-1.4 fake"),
      );

      const result = await pipeline.process(rawContent, baseOptions);

      expect(result.errors).toHaveLength(1);
      expect(result.errors?.[0]?.message).toContain("Failed to convert document");
      expect(errorSpy).toHaveBeenCalledTimes(1);
      const logged = errorSpy.mock.calls[0][0];
      expect(logged).toContain("Failed to convert document");
      expect(logged).toContain("Failed to load Xberg native bindings");
      expect(logged).toContain("GLIBC_2.38");
      expect(logged).toContain("application/pdf");

      errorSpy.mockRestore();
    });

    it("should truncate very long error messages to keep binary out of logs", async () => {
      const { logger } = await import("../../utils/logger");
      const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});

      // Simulate an Xberg error whose message embeds a huge blob (could be
      // binary from the malformed input document). The log must not contain
      // the full blob.
      const huge = "X".repeat(50_000);
      vi.mocked(extract).mockRejectedValueOnce(new Error(huge));

      const rawContent = createRawContent(
        "sample.pdf",
        "application/pdf",
        Buffer.from("%PDF-1.4 fake"),
      );
      await pipeline.process(rawContent, baseOptions);

      const logged = errorSpy.mock.calls[0][0] as string;
      // The log line wraps the message; it should be far smaller than the
      // raw 50k blob (allow some envelope for prefix/suffix/mime type/url).
      expect(logged.length).toBeLessThan(2_000);

      errorSpy.mockRestore();
    });

    it("should surface per-input errors when the envelope carries no result", async () => {
      // Xberg's `extract` returns an envelope: a failure can arrive as an empty
      // `results` array plus a populated `errors` array instead of a rejection.
      const { logger } = await import("../../utils/logger");
      const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});

      vi.mocked(extract).mockResolvedValueOnce({
        results: [],
        errors: [
          {
            index: 0,
            code: 42,
            errorType: "parsing_error",
            source: "sample.pdf",
            message: "pdf_oxide: failed to load bytes",
          },
        ],
        summary: { inputs: 1, results: 0, errors: 1 },
      } as unknown as Awaited<ReturnType<typeof extract>>);

      const rawContent = createRawContent(
        "sample.pdf",
        "application/pdf",
        Buffer.from("%PDF-1.4 fake"),
      );

      const result = await pipeline.process(rawContent, baseOptions);

      expect(result.errors).toHaveLength(1);
      expect(result.errors?.[0]?.message).toContain("Failed to convert document");
      expect(result.textContent).toBeNull();
      expect(result.chunks).toHaveLength(0);
      expect(errorSpy.mock.calls[0][0]).toContain("pdf_oxide: failed to load bytes");

      errorSpy.mockRestore();
    });

    it("should fall back to table markdown when content is empty", async () => {
      vi.mocked(extract).mockResolvedValueOnce(
        envelope({
          content: "   ",
          tables: [
            { markdown: "| A | B |\n| --- | --- |\n| 1 | 2 |" },
            { markdown: "| C | D |\n| --- | --- |\n| 3 | 4 |" },
          ],
          metadata: {},
        }),
      );

      const rawContent = createRawContent(
        "sample.xlsx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        Buffer.from("fake xlsx"),
      );

      const result = await pipeline.process(rawContent, baseOptions);

      expect(result.errors).toHaveLength(0);
      expect(result.textContent).toContain("| A | B |");
      expect(result.textContent).toContain("| C | D |");
      expect(result.contentType).toBe("text/markdown");
    });
  });
});
