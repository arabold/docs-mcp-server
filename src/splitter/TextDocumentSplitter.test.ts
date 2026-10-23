/**
 * Tests for TextDocumentSplitter
 */

import { describe, expect, it } from "vitest";
import { TextDocumentSplitter } from "./TextDocumentSplitter";
import type { Chunk, SplitterConfig } from "./types";

const mockConfig: SplitterConfig = {
  minChunkSize: 100,
  preferredChunkSize: 500,
  maxChunkSize: 1000,
};

/** A chunk as this splitter emits it: plain text at the document root. */
const textChunk = (content: string): Chunk => ({
  types: ["text"],
  content,
  section: { level: 0, path: [] },
});

describe("TextDocumentSplitter", () => {
  it("returns no chunks for empty or whitespace-only content", async () => {
    const splitter = new TextDocumentSplitter(mockConfig);
    const cases: Array<[label: string, content: string]> = [
      ["empty", ""],
      ["whitespace only", "   \n\t  \n  "],
    ];

    for (const [label, content] of cases) {
      expect.soft(await splitter.splitText(content), label).toEqual([]);
    }
  });

  it("splits text into root-level text chunks no larger than maxChunkSize", async () => {
    const cases: Array<
      [label: string, maxChunkSize: number, content: string, expected: Chunk[]]
    > = [
      [
        "two chunks",
        50,
        "This is a simple text.\nIt has multiple lines.\nAnd should be split properly.",
        [
          textChunk("This is a simple text.\nIt has multiple lines.\n"),
          textChunk("And should be split properly."),
        ],
      ],
      [
        "fits in one chunk",
        100,
        "Short text that fits in one chunk.",
        [textChunk("Short text that fits in one chunk.")],
      ],
    ];

    for (const [label, maxChunkSize, content, expected] of cases) {
      const splitter = new TextDocumentSplitter({ ...mockConfig, maxChunkSize });
      expect.soft(await splitter.splitText(content), label).toEqual(expected);
    }
  });

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

  it("keeps lines, blank lines and indentation, so the chunks join back to the input", async () => {
    const cases: Array<[label: string, maxChunkSize: number, content: string]> = [
      ["lines and paragraphs", 30, "Line 1\nLine 2\n\nParagraph 2\nLast line"],
      [
        "indentation and tabs",
        50,
        "  Indented text\n\n  Another indented line  \n\tTab indented\n",
      ],
    ];

    for (const [label, maxChunkSize, content] of cases) {
      const splitter = new TextDocumentSplitter({ ...mockConfig, maxChunkSize });
      const chunks = await splitter.splitText(content);
      expect.soft(chunks.map((chunk) => chunk.content).join(""), label).toBe(content);
    }
  });
});
