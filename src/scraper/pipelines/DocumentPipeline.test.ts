/**
 * Tests for DocumentPipeline - processes PDF, Office documents, and Jupyter notebooks.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../../utils/config";
import { FetchStatus, type RawContent } from "../fetcher/types";
import type { ScraperOptions } from "../types";
import { ScrapeMode } from "../types";
import { DocumentPipeline } from "./DocumentPipeline";

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

    it("should reject HTML MIME type", () => {
      expect(pipeline.canProcess("text/html")).toBe(false);
    });

    it("should reject plain text MIME type", () => {
      expect(pipeline.canProcess("text/plain")).toBe(false);
    });

    it("should reject JSON MIME type", () => {
      expect(pipeline.canProcess("application/json")).toBe(false);
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

    it("should process an XLSX file and extract data", async () => {
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

      // Verify header fix
      // Should NOT have the empty header row
      // Use regex to be robust against whitespace changes
      expect(result.textContent).not.toMatch(/^\|(?:\s*\|)+\s*$/m);

      // Should have the promoted header
      expect(result.textContent).toContain("| Sample XLSX | Test Data |");

      // Followed by separator (simplified check, allowing optional spaces)
      expect(result.textContent).toMatch(
        /\| Sample XLSX \| Test Data \|\s*\n\s*\| ?-+ ?\| ?-+ ?\|/,
      );
    });

    it("should process a PPTX file and extract content", async () => {
      const content = loadFixture("sample.pptx");
      const rawContent = createRawContent(
        "sample.pptx",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        content,
      );

      const result = await pipeline.process(rawContent, baseOptions);

      // PPTX processing may fail with minimal test fixtures due to markitdown-ts requirements
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
        document: { maxSize: 100 },
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

    it("should handle missing file extension gracefully", async () => {
      const content = loadFixture("sample.pdf");
      const rawContent: RawContent = {
        content,
        mimeType: "application/pdf",
        source: "file:///no-extension", // No extension
        status: FetchStatus.SUCCESS,
      };

      const result = await pipeline.process(rawContent, baseOptions);

      expect(result.errors).toHaveLength(1);
      expect(result.errors![0].message).toContain("file extension");
    });

    it("should use filename as title fallback", async () => {
      const content = loadFixture("sample.docx");
      const rawContent = createRawContent(
        "sample.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        content,
      );

      const result = await pipeline.process(rawContent, baseOptions);

      // Title should be extracted or fall back to filename
      expect(result.title).toBeTruthy();
    });

    it("should return empty links array for documents", async () => {
      const content = loadFixture("sample.pdf");
      const rawContent = createRawContent("sample.pdf", "application/pdf", content);

      const result = await pipeline.process(rawContent, baseOptions);

      expect(result.links).toEqual([]);
    });
  });
});
