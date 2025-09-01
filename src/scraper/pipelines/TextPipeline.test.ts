import { describe, expect, it } from "vitest";
import type { RawContent } from "../fetcher/types";
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
      const textCases: RawContent[] = [
        {
          content: "plain text",
          mimeType: "text/plain",
          source: "test.txt",
        },
        {
          content: "markdown content",
          mimeType: "text/markdown",
          source: "test.md",
        },
        {
          content: "CSS content",
          mimeType: "text/css",
          source: "test.css",
        },
      ];

      for (const testCase of textCases) {
        expect(pipeline.canProcess(testCase)).toBe(true);
      }
    });

    it("should accept safe application types", () => {
      const safeCases: RawContent[] = [
        {
          content: '<?xml version="1.0"?><root></root>',
          mimeType: "application/xml",
          source: "test.xml",
        },
        {
          content: "console.log('hello')",
          mimeType: "application/javascript",
          source: "test.js",
        },
        {
          content: "name: value",
          mimeType: "application/yaml",
          source: "test.yaml",
        },
      ];

      for (const testCase of safeCases) {
        expect(pipeline.canProcess(testCase)).toBe(true);
      }
    });

    it("should reject binary content", () => {
      const binaryCases: RawContent[] = [
        {
          content: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), // PNG header
          mimeType: "image/png",
          source: "test.png",
        },
        {
          content: "text with null byte\0here",
          mimeType: "application/octet-stream",
          source: "test.bin",
        },
      ];

      for (const testCase of binaryCases) {
        expect(pipeline.canProcess(testCase)).toBe(false);
      }
    });

    it("should reject unknown application types", () => {
      const unknownCases: RawContent[] = [
        {
          content: "unknown content",
          mimeType: "application/unknown",
          source: "test.unknown",
        },
        {
          content: "video data",
          mimeType: "video/mp4",
          source: "test.mp4",
        },
      ];

      for (const testCase of unknownCases) {
        expect(pipeline.canProcess(testCase)).toBe(false);
      }
    });

    it("should reject content without mime type", () => {
      const noMimeCase: RawContent = {
        content: "content without mime type",
        mimeType: undefined as any,
        source: "test",
      };

      expect(pipeline.canProcess(noMimeCase)).toBe(false);
    });
  });

  describe("process", () => {
    it("should process plain text content", async () => {
      const textContent: RawContent = {
        content: "This is a simple text document with some content.",
        mimeType: "text/plain",
        source: "test.txt",
      };

      const result = await pipeline.process(textContent, baseOptions);

      expect(result.textContent).toBe(textContent.content);
      expect(result.metadata.contentType).toBe("text/plain");
      expect(result.metadata.isGenericText).toBe(true);
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
      };

      const result = await pipeline.process(unknownContent, baseOptions);

      expect(result.textContent).toBe(unknownContent.content);
      expect(result.metadata.contentType).toBe("application/unknown");
      expect(result.metadata.isGenericText).toBe(true);
    });

    it("should handle content without specific mime type", async () => {
      const genericContent: RawContent = {
        content: "Generic content",
        mimeType: "text/plain",
        source: "test",
      };

      const result = await pipeline.process(genericContent, baseOptions);

      expect(result.textContent).toBe(genericContent.content);
      expect(result.metadata.contentType).toBe("text/plain");
      expect(result.metadata.isGenericText).toBe(true);
    });

    it("should handle Buffer content", async () => {
      const bufferContent: RawContent = {
        content: Buffer.from("Buffer content", "utf-8"),
        mimeType: "text/plain",
        charset: "utf-8",
        source: "test.txt",
      };

      const result = await pipeline.process(bufferContent, baseOptions);

      expect(result.textContent).toBe("Buffer content");
      expect(result.metadata.contentType).toBe("text/plain");
    });
  });

  describe("close", () => {
    it("should close without errors", async () => {
      await expect(pipeline.close()).resolves.toBeUndefined();
    });
  });
});
