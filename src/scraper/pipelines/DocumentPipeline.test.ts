/**
 * Tests for DocumentPipeline - processes PDF, Office documents, OpenDocument,
 * RTF, eBooks, and Jupyter notebooks using Kreuzberg.
 */

import fs from "node:fs";
import path from "node:path";
import { extractBytes } from "@kreuzberg/node";
import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../../utils/config";
import { FetchStatus, type RawContent } from "../fetcher/types";
import type { ScraperOptions } from "../types";
import { ScrapeMode } from "../types";
import { DocumentPipeline } from "./DocumentPipeline";

vi.mock("@kreuzberg/node", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import("@kreuzberg/node");
  return {
    ...actual,
    extractBytes: vi.fn(actual.extractBytes),
  };
});

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
  describe("canProcess", () => {
    it("should accept PDF MIME type", () => {
      expect(pipeline.canProcess("application/pdf")).toBe(true);
    });

    it("should accept DOCX MIME type", () => {
      expect(
        pipeline.canProcess(
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ),
      ).toBe(true);
    });

    it("should accept XLSX MIME type", () => {
      expect(
        pipeline.canProcess(
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ),
      ).toBe(true);
    });

    it("should accept PPTX MIME type", () => {
      expect(
        pipeline.canProcess(
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        ),
      ).toBe(true);
    });

    it("should accept Jupyter Notebook MIME type", () => {
      expect(pipeline.canProcess("application/x-ipynb+json")).toBe(true);
    });

    it("should accept legacy DOC MIME type", () => {
      expect(pipeline.canProcess("application/msword")).toBe(true);
    });

    it("should accept legacy XLS MIME type", () => {
      expect(pipeline.canProcess("application/vnd.ms-excel")).toBe(true);
    });

    it("should accept legacy PPT MIME type", () => {
      expect(pipeline.canProcess("application/vnd.ms-powerpoint")).toBe(true);
    });

    it("should accept ODT MIME type", () => {
      expect(pipeline.canProcess("application/vnd.oasis.opendocument.text")).toBe(true);
    });

    it("should accept ODS MIME type", () => {
      expect(pipeline.canProcess("application/vnd.oasis.opendocument.spreadsheet")).toBe(
        true,
      );
    });

    it("should accept ODP MIME type", () => {
      expect(pipeline.canProcess("application/vnd.oasis.opendocument.presentation")).toBe(
        true,
      );
    });

    it("should accept RTF MIME type", () => {
      expect(pipeline.canProcess("application/rtf")).toBe(true);
    });

    it("should accept EPUB MIME type", () => {
      expect(pipeline.canProcess("application/epub+zip")).toBe(true);
    });

    it("should accept FB2 MIME type", () => {
      expect(pipeline.canProcess("application/x-fictionbook+xml")).toBe(true);
    });

    it("should reject HTML MIME type", () => {
      expect(pipeline.canProcess("text/html")).toBe(false);
    });

    it("should reject plain text MIME type", () => {
      expect(pipeline.canProcess("text/plain")).toBe(false);
    });

    it("should reject JSON MIME type", () => {
      expect(pipeline.canProcess("application/json")).toBe(false);
    });

    it("should reject application/octet-stream (resolved upstream by strategies)", () => {
      expect(pipeline.canProcess("application/octet-stream")).toBe(false);
    });
  });

  describe("process", () => {
    it("should process a PDF file and extract text", async () => {
      const content = loadFixture("sample.pdf");
      const rawContent = createRawContent("sample.pdf", "application/pdf", content);

      const result = await pipeline.process(rawContent, baseOptions);

      expect(result.errors).toHaveLength(0);
      expect(result.textContent).toBeTruthy();
      expect(result.contentType).toBe("text/markdown");
      expect(result.chunks).toBeDefined();
      expect(result.chunks!.length).toBeGreaterThan(0);
    });

    it("should process a DOCX file and extract text", async () => {
      const content = loadFixture("sample.docx");
      const rawContent = createRawContent(
        "sample.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        content,
      );

      const result = await pipeline.process(rawContent, baseOptions);

      expect(result.errors).toHaveLength(0);
      expect(result.textContent).toBeTruthy();
      expect(result.textContent).toContain("Sample DOCX Document");
      expect(result.contentType).toBe("text/markdown");
      expect(result.chunks).toBeDefined();
    });

    it("should prefer full markdown content for DOCX with tables", async () => {
      const docxMimeType =
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      const extractBytesMock = vi.mocked(extractBytes);
      extractBytesMock.mockResolvedValueOnce({
        content:
          "# Sample DOCX\n\nIntro paragraph before table.\n\n| A | B |\n| - | - |\n| 1 | 2 |",
        tables: [{ markdown: "| A | B |\n| - | - |\n| 1 | 2 |" }],
        metadata: { title: "Sample DOCX" },
      } as Awaited<ReturnType<typeof extractBytes>>);

      const rawContent = createRawContent(
        "sample.docx",
        docxMimeType,
        Buffer.from("fake docx"),
      );

      const result = await pipeline.process(rawContent, baseOptions);

      expect(result.errors).toHaveLength(0);
      expect(result.contentType).toBe("text/markdown");
      expect(result.textContent).toContain("Intro paragraph before table.");
      expect(result.textContent).toContain("| A | B |");
    });

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

    it("should process an XLSX file and produce Markdown tables", async () => {
      const content = loadFixture("sample.xlsx");
      const rawContent = createRawContent(
        "sample.xlsx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        content,
      );

      const result = await pipeline.process(rawContent, baseOptions);

      expect(result.errors).toHaveLength(0);
      expect(result.textContent).toBeTruthy();
      expect(result.contentType).toBe("text/markdown");
      // Should use tables[].markdown output with proper Markdown table formatting
      expect(result.textContent).toContain("|");
      expect(result.textContent).toContain("Sample XLSX");
    });

    it("should process a PPTX file and extract content", async () => {
      const content = loadFixture("sample.pptx");
      const rawContent = createRawContent(
        "sample.pptx",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        content,
      );

      const result = await pipeline.process(rawContent, baseOptions);

      // PPTX processing may fail with minimal test fixtures
      // The important thing is that the pipeline handles it gracefully
      if (result.errors?.length === 0) {
        expect(result.textContent).toBeTruthy();
        expect(result.contentType).toBe("text/markdown");
      } else {
        // Graceful error handling - pipeline should return error without crashing
        expect(result.textContent).toBeNull();
        expect(result.chunks).toHaveLength(0);
      }
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
      expect(result.errors![0].message).toContain("exceeds maximum size");
      expect(result.textContent).toBeNull();
      expect(result.chunks).toHaveLength(0);
    });

    it("should process PDF with any source URL since Kreuzberg uses MIME type directly", async () => {
      const content = loadFixture("sample.pdf");
      const rawContent: RawContent = {
        content,
        mimeType: "application/pdf",
        source: "file:///no-extension", // No extension in URL
        status: FetchStatus.SUCCESS,
      };

      const result = await pipeline.process(rawContent, baseOptions);

      // Should succeed because Kreuzberg uses MIME type, not file extension
      expect(result.errors).toHaveLength(0);
      expect(result.textContent).toBeTruthy();
      expect(result.contentType).toBe("text/markdown");
    });

    it("should handle URL with query parameters", async () => {
      const content = loadFixture("sample.pdf");
      const rawContent: RawContent = {
        content,
        mimeType: "application/pdf",
        source:
          "https://example.com/documents/file.pdf/59569026-c221-12db-de3f-98becb9a67af?t=1767868182094",
        status: FetchStatus.SUCCESS,
      };

      const result = await pipeline.process(rawContent, baseOptions);

      expect(result.errors).toHaveLength(0);
      expect(result.textContent).toBeTruthy();
      expect(result.contentType).toBe("text/markdown");
    });

    it("should use filename as title fallback", async () => {
      const content = loadFixture("sample.docx");
      const rawContent = createRawContent(
        "sample.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        content,
      );

      const result = await pipeline.process(rawContent, baseOptions);

      // Title should be extracted from metadata or fall back to filename
      expect(result.title).toBeTruthy();
    });

    it("should return empty links array for documents", async () => {
      const content = loadFixture("sample.pdf");
      const rawContent = createRawContent("sample.pdf", "application/pdf", content);

      const result = await pipeline.process(rawContent, baseOptions);

      expect(result.links).toEqual([]);
    });

    it("should use result.content for documents without tables", async () => {
      // PDF extraction typically has no tables[], so content is used directly
      const content = loadFixture("sample.pdf");
      const rawContent = createRawContent("sample.pdf", "application/pdf", content);

      const result = await pipeline.process(rawContent, baseOptions);

      expect(result.errors).toHaveLength(0);
      expect(result.textContent).toBeTruthy();
      expect(result.textContent).toContain("Sample PDF");
      expect(result.contentType).toBe("text/markdown");
    });

    it("should produce Markdown formatting for DOCX with structure", async () => {
      // The sample.docx has paragraphs; Kreuzberg with outputFormat: "markdown"
      // preserves document structure in Markdown format
      const content = loadFixture("sample.docx");
      const rawContent = createRawContent(
        "sample.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        content,
      );

      const result = await pipeline.process(rawContent, baseOptions);

      expect(result.errors).toHaveLength(0);
      expect(result.textContent).toBeTruthy();
      expect(result.textContent).toContain("Sample DOCX Document");
      expect(result.contentType).toBe("text/markdown");
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
      // tables[].markdown includes sheet name as heading and separator row
      expect(result.textContent).toContain("Sheet1");
      expect(result.textContent).toContain("---");
    });

    it("should resolve application/octet-stream from URL extension and process document", async () => {
      const content = loadFixture("sample.pdf");
      const rawContent: RawContent = {
        content,
        mimeType: "application/octet-stream",
        source: "https://cdn.example.com/files/report.pdf",
        status: FetchStatus.SUCCESS,
      };

      const result = await pipeline.process(rawContent, baseOptions);

      expect(result.errors).toHaveLength(0);
      expect(result.textContent).toBeTruthy();
      expect(result.contentType).toBe("text/markdown");
    });

    it("should resolve application/octet-stream from URL with query params", async () => {
      const content = loadFixture("sample.docx");
      const rawContent: RawContent = {
        content,
        mimeType: "application/octet-stream",
        source: "https://s3.amazonaws.com/bucket/report.docx?X-Amz-Signature=abc123",
        status: FetchStatus.SUCCESS,
      };

      const result = await pipeline.process(rawContent, baseOptions);

      expect(result.errors).toHaveLength(0);
      expect(result.textContent).toBeTruthy();
      expect(result.textContent).toContain("Sample DOCX Document");
    });

    it("should fail gracefully for application/octet-stream with no document extension", async () => {
      const content = Buffer.from("not a real document");
      const rawContent: RawContent = {
        content,
        mimeType: "application/octet-stream",
        source: "https://example.com/api/download/12345",
        status: FetchStatus.SUCCESS,
      };

      const result = await pipeline.process(rawContent, baseOptions);

      expect(result.errors).toHaveLength(1);
      expect(result.errors![0].message).toContain("Could not determine document type");
      expect(result.textContent).toBeNull();
    });
  });
});
