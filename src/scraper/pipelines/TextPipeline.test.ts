import { describe, expect, it } from "vitest";
import { FetchStatus, type RawContent } from "../fetcher/types";
import type { ScraperOptions } from "../types";
import { ScrapeMode } from "../types";
import { TextPipeline } from "./TextPipeline";

describe("TextPipeline", () => {
  const pipeline = new TextPipeline();
  const baseOptions: ScraperOptions = {
    url: "http://example.com",
    library: "test-lib",
    version: "1.0.0",
    maxDepth: 1,
    maxPages: 10,
    scrapeMode: ScrapeMode.Auto,
  };

  describe("canProcess", () => {
    it("should accept text content types", () => {
      expect(pipeline.canProcess("text/plain")).toBe(true);
      expect(pipeline.canProcess("text/markdown")).toBe(true);
      expect(pipeline.canProcess("text/css")).toBe(true);
    });

    it("should accept safe application types", () => {
      expect(pipeline.canProcess("application/xml")).toBe(true);
      expect(pipeline.canProcess("application/javascript")).toBe(true);
      expect(pipeline.canProcess("application/yaml")).toBe(true);
    });

    it("should reject binary content", () => {
      const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG header
      expect(pipeline.canProcess("image/png", pngBuffer)).toBe(false);

      const binaryContent = Buffer.from("text with null byte\0here");
      expect(pipeline.canProcess("application/octet-stream", binaryContent)).toBe(false);
    });

    it("should reject unknown application types", () => {
      expect(pipeline.canProcess("application/unknown")).toBe(false);
      expect(pipeline.canProcess("video/mp4")).toBe(false);
    });

    it("should reject content without mime type", () => {
      expect(pipeline.canProcess("")).toBe(false);
      expect(pipeline.canProcess(undefined as any)).toBe(false);
    });
  });

  describe("process", () => {
    it("should process plain text content", async () => {
      const textContent: RawContent = {
        content: "This is a simple text document with some content.",
        mimeType: "text/plain",
        source: "test.txt",
        status: FetchStatus.SUCCESS,
      };

      const result = await pipeline.process(textContent, baseOptions);

      expect(result.textContent).toBe(textContent.content);
      // expect(result.contentType).toBe("text/plain");
      // expect(result.metadata.isGenericText).toBe(true);
      expect(result.links).toEqual([]);
      expect(result.errors).toEqual([]);
      expect(result.chunks).toBeDefined();
      expect(Array.isArray(result.chunks)).toBe(true);
    });

    it("should handle unknown content types", async () => {
      const unknownContent: RawContent = {
        content: "Some unknown format content",
        mimeType: "application/unknown",
        source: "test.unknown",
        status: FetchStatus.SUCCESS,
      };

      const result = await pipeline.process(unknownContent, baseOptions);

      expect(result.textContent).toBe(unknownContent.content);
      // expect(result.contentType).toBe("application/unknown");
      // expect(result.metadata.isGenericText).toBe(true);
    });

    it("should handle content without specific mime type", async () => {
      const genericContent: RawContent = {
        content: "Generic content",
        mimeType: "text/plain",
        source: "test",
        status: FetchStatus.SUCCESS,
      };

      const result = await pipeline.process(genericContent, baseOptions);

      expect(result.textContent).toBe(genericContent.content);
      // expect(result.contentType).toBe("text/plain");
      // expect(result.metadata.isGenericText).toBe(true);
    });

    it("should handle Buffer content", async () => {
      const bufferContent: RawContent = {
        content: Buffer.from("Buffer content", "utf-8"),
        mimeType: "text/plain",
        charset: "utf-8",
        source: "test.txt",
        status: FetchStatus.SUCCESS,
      };

      const result = await pipeline.process(bufferContent, baseOptions);

      expect(result.textContent).toBe("Buffer content");
      // expect(result.contentType).toBe("text/plain");
    });
  });
});
