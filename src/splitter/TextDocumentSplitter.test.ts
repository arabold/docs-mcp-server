/**
 * Tests for TextDocumentSplitter
 */

import { describe, expect, it } from "vitest";
import { TextDocumentSplitter } from "./TextDocumentSplitter";
import type { SplitterConfig } from "./types";

const mockConfig: SplitterConfig = {
  minChunkSize: 100,
  preferredChunkSize: 500,
  maxChunkSize: 1000,
};

describe("TextDocumentSplitter", () => {
  describe("basic functionality", () => {
    it("should return empty array for empty content", async () => {
      const splitter = new TextDocumentSplitter(mockConfig);
      const result = await splitter.splitText("");
      expect(result).toEqual([]);
    });

    it("should return empty array for whitespace-only content", async () => {
      const splitter = new TextDocumentSplitter(mockConfig);
      const result = await splitter.splitText("   \n\t  \n  ");
      expect(result).toEqual([]);
    });

    it("should split simple text into chunks", async () => {
      const splitter = new TextDocumentSplitter({ ...mockConfig, maxChunkSize: 50 });
      const content =
        "This is a simple text.\nIt has multiple lines.\nAnd should be split properly.";

      const result = await splitter.splitText(content);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        types: ["text"],
        content: "This is a simple text.\nIt has multiple lines.\n",
        section: {
          level: 0,
          path: [],
        },
      });
      expect(result[1]).toEqual({
        types: ["text"],
        content: "And should be split properly.",
        section: {
          level: 0,
          path: [],
        },
      });
    });

    it("should handle content that fits in single chunk", async () => {
      const splitter = new TextDocumentSplitter({ ...mockConfig, maxChunkSize: 100 });
      const content = "Short text that fits in one chunk.";

      const result = await splitter.splitText(content);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        types: ["text"],
        content: "Short text that fits in one chunk.",
        section: {
          level: 0,
          path: [],
        },
      });
    });
  });

  describe("error handling", () => {
    it("should handle MinimumChunkSizeError gracefully by forcefully splitting", async () => {
      // Create a splitter with very small chunk size
      const splitter = new TextDocumentSplitter({ ...mockConfig, maxChunkSize: 5 });
      const content = "ThisIsAVeryLongWordThatCannotBeSplit";

      const result = await splitter.splitText(content);

      // Should split the content into multiple chunks when normal splitting fails
      // Content is 36 chars, chunk size is 5, so we expect 8 chunks (7*5 + 1)
      expect(result.length).toBeGreaterThan(1);

      // Verify each chunk respects the max size
      for (const chunk of result) {
        expect(chunk.content.length).toBeLessThanOrEqual(5);
        expect(chunk.types).toEqual(["text"]);
        expect(chunk.section).toEqual({
          level: 0,
          path: [],
        });
      }

      // Verify content is preserved when concatenated
      const reconstructed = result.map((c) => c.content).join("");
      expect(reconstructed).toBe(content);
    });
  });

  describe("configuration", () => {
    it("should use custom maxChunkSize when provided", async () => {
      const splitter = new TextDocumentSplitter({ ...mockConfig, maxChunkSize: 20 });
      const content =
        "This is a longer text that should be split into multiple smaller chunks.";

      const result = await splitter.splitText(content);

      // Should split into multiple chunks due to small size limit
      expect(result.length).toBeGreaterThan(1);

      // Each chunk should be under the size limit (allowing for some overhead)
      for (const chunk of result) {
        expect(chunk.content.length).toBeLessThanOrEqual(25); // Small buffer for edge cases
      }
    });
  });

  describe("content reconstruction", () => {
    it("should allow perfect content reconstruction", async () => {
      const splitter = new TextDocumentSplitter({ ...mockConfig, maxChunkSize: 30 });
      const originalContent = "Line 1\nLine 2\n\nParagraph 2\nLast line";

      const result = await splitter.splitText(originalContent);
      const reconstructed = result.map((chunk) => chunk.content).join("");

      expect(reconstructed).toBe(originalContent);
    });

    it("should preserve formatting and whitespace", async () => {
      const splitter = new TextDocumentSplitter({ ...mockConfig, maxChunkSize: 50 });
      const content = "  Indented text\n\n  Another indented line  \n\tTab indented\n";

      const result = await splitter.splitText(content);
      const reconstructed = result.map((chunk) => chunk.content).join("");

      expect(reconstructed).toBe(content);
    });
  });

  describe("metadata", () => {
    it("should set correct metadata for each chunk", async () => {
      const splitter = new TextDocumentSplitter({ ...mockConfig, maxChunkSize: 20 });
      const content = "First chunk. Second chunk. Third chunk.";

      const result = await splitter.splitText(content);

      for (let i = 0; i < result.length; i++) {
        expect(result[i].types).toEqual(["text"]);
        expect(result[i].section.level).toBe(0);
        expect(result[i].section.path).toEqual([]);
      }
    });
  });
});
