import { describe, expect, it } from "vitest";
import { MimeTypeUtils } from "./mimeTypeUtils";

describe("MimeTypeUtils", () => {
  describe("isBinary", () => {
    it("should detect binary content with null bytes", () => {
      const binaryContent = "text content\0with null byte";
      expect(MimeTypeUtils.isBinary(binaryContent)).toBe(true);
    });

    it("should detect binary Buffer content", () => {
      const binaryBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0a, 0x1a, 0x0a]); // PNG-like header with null byte
      expect(MimeTypeUtils.isBinary(binaryBuffer)).toBe(true);
    });

    it("should not detect text content as binary", () => {
      const textContent = "This is plain text content without null bytes";
      expect(MimeTypeUtils.isBinary(textContent)).toBe(false);
    });

    it("should not detect text Buffer as binary", () => {
      const textBuffer = Buffer.from("This is text content", "utf8");
      expect(MimeTypeUtils.isBinary(textBuffer)).toBe(false);
    });
  });

  describe("isText", () => {
    it("should accept basic text/* MIME types", () => {
      expect(MimeTypeUtils.isText("text/plain")).toBe(true);
      expect(MimeTypeUtils.isText("text/css")).toBe(true);
      expect(MimeTypeUtils.isText("TEXT/HTML")).toBe(true); // Case insensitive
    });

    it("should exclude structured text formats for specific pipelines", () => {
      expect(MimeTypeUtils.isText("text/markdown")).toBe(false); // Should go to MarkdownPipeline
      expect(MimeTypeUtils.isText("application/json")).toBe(false); // Should go to JsonPipeline
      expect(MimeTypeUtils.isText("text/json")).toBe(false); // Should go to JsonPipeline
    });

    it("should reject application types", () => {
      expect(MimeTypeUtils.isText("application/xml")).toBe(false);
      expect(MimeTypeUtils.isText("application/javascript")).toBe(false);
      expect(MimeTypeUtils.isText("application/octet-stream")).toBe(false);
      expect(MimeTypeUtils.isText("application/pdf")).toBe(false);
    });

    it("should reject image and video types", () => {
      expect(MimeTypeUtils.isText("image/png")).toBe(false);
      expect(MimeTypeUtils.isText("image/jpeg")).toBe(false);
      expect(MimeTypeUtils.isText("video/mp4")).toBe(false);
      expect(MimeTypeUtils.isText("audio/mpeg")).toBe(false);
    });

    it("should reject empty or null MIME types", () => {
      expect(MimeTypeUtils.isText("")).toBe(false);
      expect(MimeTypeUtils.isText(null as any)).toBe(false);
      expect(MimeTypeUtils.isText(undefined as any)).toBe(false);
    });
  });

  describe("isSafeForTextProcessing", () => {
    it("should accept all text/* MIME types", () => {
      expect(MimeTypeUtils.isSafeForTextProcessing("text/plain")).toBe(true);
      expect(MimeTypeUtils.isSafeForTextProcessing("text/markdown")).toBe(true);
      expect(MimeTypeUtils.isSafeForTextProcessing("text/css")).toBe(true);
      expect(MimeTypeUtils.isSafeForTextProcessing("TEXT/HTML")).toBe(true); // Case insensitive
    });

    it("should accept safe application types", () => {
      expect(MimeTypeUtils.isSafeForTextProcessing("application/xml")).toBe(true);
      expect(MimeTypeUtils.isSafeForTextProcessing("application/javascript")).toBe(true);
      expect(MimeTypeUtils.isSafeForTextProcessing("application/x-javascript")).toBe(
        true,
      );
      expect(MimeTypeUtils.isSafeForTextProcessing("application/x-sh")).toBe(true);
      expect(MimeTypeUtils.isSafeForTextProcessing("application/x-yaml")).toBe(true);
      expect(MimeTypeUtils.isSafeForTextProcessing("application/yaml")).toBe(true);
      expect(MimeTypeUtils.isSafeForTextProcessing("application/json")).toBe(true);
    });

    it("should reject unsafe application types", () => {
      expect(MimeTypeUtils.isSafeForTextProcessing("application/octet-stream")).toBe(
        false,
      );
      expect(MimeTypeUtils.isSafeForTextProcessing("application/pdf")).toBe(false);
      expect(MimeTypeUtils.isSafeForTextProcessing("application/zip")).toBe(false);
    });

    it("should reject image and video types", () => {
      expect(MimeTypeUtils.isSafeForTextProcessing("image/png")).toBe(false);
      expect(MimeTypeUtils.isSafeForTextProcessing("image/jpeg")).toBe(false);
      expect(MimeTypeUtils.isSafeForTextProcessing("video/mp4")).toBe(false);
      expect(MimeTypeUtils.isSafeForTextProcessing("audio/mpeg")).toBe(false);
    });

    it("should reject empty or null MIME types", () => {
      expect(MimeTypeUtils.isSafeForTextProcessing("")).toBe(false);
      expect(MimeTypeUtils.isSafeForTextProcessing(null as any)).toBe(false);
      expect(MimeTypeUtils.isSafeForTextProcessing(undefined as any)).toBe(false);
    });
  });

  describe("existing methods", () => {
    it("should correctly identify HTML", () => {
      expect(MimeTypeUtils.isHtml("text/html")).toBe(true);
      expect(MimeTypeUtils.isHtml("application/xhtml+xml")).toBe(true);
      expect(MimeTypeUtils.isHtml("text/plain")).toBe(false);
    });

    it("should correctly identify Markdown", () => {
      expect(MimeTypeUtils.isMarkdown("text/markdown")).toBe(true);
      expect(MimeTypeUtils.isMarkdown("text/x-markdown")).toBe(true);
      expect(MimeTypeUtils.isMarkdown("text/plain")).toBe(false);
    });

    it("should correctly identify text types", () => {
      expect(MimeTypeUtils.isText("text/plain")).toBe(true);
      expect(MimeTypeUtils.isText("text/html")).toBe(true);
      expect(MimeTypeUtils.isText("application/json")).toBe(false); // JSON should go to JsonPipeline
    });

    it("should correctly identify JSON", () => {
      expect(MimeTypeUtils.isJson("application/json")).toBe(true);
      expect(MimeTypeUtils.isJson("text/json")).toBe(true);
      expect(MimeTypeUtils.isJson("text/x-json")).toBe(true);
      expect(MimeTypeUtils.isJson("text/plain")).toBe(false);
    });

    it("should correctly identify source code", () => {
      expect(MimeTypeUtils.isSourceCode("text/x-typescript")).toBe(true);
      expect(MimeTypeUtils.isSourceCode("text/x-python")).toBe(true);
      expect(MimeTypeUtils.isSourceCode("text/plain")).toBe(false);
    });
  });
});
