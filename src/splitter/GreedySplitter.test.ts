import { describe, expect, it, vi } from "vitest";
import { GreedySplitter } from "./GreedySplitter";
import { SemanticMarkdownSplitter } from "./SemanticMarkdownSplitter";
import type { Chunk } from "./types";

// Mock SemanticMarkdownSplitter
const createMockSemanticSplitter = (chunks: Chunk[]) => {
  const mockSplitText = vi.fn().mockResolvedValue(chunks);
  const mockSemanticSplitter = {
    splitText: mockSplitText,
  } as unknown as SemanticMarkdownSplitter;
  return mockSemanticSplitter;
};

describe("GreedySplitter", () => {
  it("should handle empty input", async () => {
    const mockSemanticSplitter = createMockSemanticSplitter([]);
    const splitter = new GreedySplitter(mockSemanticSplitter, 15, 200); // Small enough that each chunk is above minimum
    const result = await splitter.splitText("");
    expect(result).toEqual([]);
  });

  it("should return the original chunk if it's within min and max size", async () => {
    const initialChunks: Chunk[] = [
      {
        types: ["text"],
        content: "This is a single chunk.",
        section: { level: 3, path: ["Test"] },
      },
    ];
    const mockSemanticSplitter = createMockSemanticSplitter(initialChunks);
    const splitter = new GreedySplitter(mockSemanticSplitter, 10, 200);
    const result = await splitter.splitText("Some Markdown");
    expect(result).toEqual(initialChunks);
  });

  it("should concatenate chunks until minChunkSize is reached", async () => {
    const initialChunks: Chunk[] = [
      {
        types: ["text"],
        content: "Short text 1.",
        section: { level: 3, path: ["Test"] },
      },
      {
        types: ["text"],
        content: "Short text 2.",
        section: { level: 3, path: ["Test"] },
      },
    ];
    const mockSemanticSplitter = createMockSemanticSplitter(initialChunks);
    const splitter = new GreedySplitter(mockSemanticSplitter, 15, 200); // Small enough that each chunk is above minimum
    const result = await splitter.splitText("Some Markdown");
    expect(result).toEqual([
      {
        types: ["text"],
        content: "Short text 1.\nShort text 2.",
        section: { level: 3, path: ["Test"] },
      },
    ]);
  });

  it("should respect H1/H2 boundaries", async () => {
    const initialChunks: Chunk[] = [
      {
        types: ["text"],
        content: "Text before heading.",
        section: { level: 3, path: ["Test"] },
      },
      {
        types: ["heading"],
        content: "# New Heading",
        section: { level: 1, path: ["New Heading"] },
      },
      {
        types: ["text"],
        content: "Text after heading.",
        section: { level: 1, path: ["New Heading"] },
      },
    ];
    const mockSemanticSplitter = createMockSemanticSplitter(initialChunks);
    const splitter = new GreedySplitter(mockSemanticSplitter, 10, 200);
    const result = await splitter.splitText("Some Markdown");
    expect(result).toEqual([
      {
        types: ["text"],
        content: "Text before heading.",
        section: { level: 3, path: ["Test"] },
      },
      {
        types: ["heading"],
        content: "# New Heading",
        section: { level: 1, path: ["New Heading"] },
      },
      {
        types: ["text"],
        content: "Text after heading.",
        section: { level: 1, path: ["New Heading"] },
      },
    ]);
  });

  it("should not exceed preferredChunkSize", async () => {
    const initialChunks: Chunk[] = [
      {
        types: ["text"],
        content: "This is a long text chunk. ",
        section: { level: 3, path: ["Test"] },
      },
      {
        types: ["text"],
        content: "This chunk will exceed max size.",
        section: { level: 3, path: ["Test"] },
      },
    ];
    const mockSemanticSplitter = createMockSemanticSplitter(initialChunks);
    const splitter = new GreedySplitter(mockSemanticSplitter, 10, 30); // preferredChunkSize = 30
    const result = await splitter.splitText("Some Markdown");
    expect(result).toEqual([
      {
        types: ["text"],
        content: "This is a long text chunk. ",
        section: { level: 3, path: ["Test"] },
      },
      {
        types: ["text"],
        content: "This chunk will exceed max size.",
        section: { level: 3, path: ["Test"] },
      },
    ]);
  });

  it("should preserve section metadata when concatenating chunks with identical sections", async () => {
    const initialChunks: Chunk[] = [
      {
        types: ["text"],
        content: "Short text 1.",
        section: { level: 3, path: ["Test"] },
      },
      {
        types: ["text"],
        content: "Short text 2.",
        section: { level: 3, path: ["Test"] },
      },
    ];
    const mockSemanticSplitter = createMockSemanticSplitter(initialChunks);
    const splitter = new GreedySplitter(mockSemanticSplitter, 10, 200); // Small enough that each chunk is above minimum
    const result = await splitter.splitText("Some Markdown");
    expect(result).toEqual([
      {
        types: ["text"],
        content: "Short text 1.\nShort text 2.",
        section: { level: 3, path: ["Test"] },
      },
    ]);
  });

  it("should merge heading with its content when minChunkSize > 0", async () => {
    const initialChunks: Chunk[] = [
      {
        types: ["heading"],
        content: "# Section 1",
        section: { level: 1, path: ["Section 1"] },
      },
      {
        types: ["text"],
        content: "Content under section 1",
        section: { level: 1, path: ["Section 1"] },
      },
    ];
    const mockSemanticSplitter = createMockSemanticSplitter(initialChunks);
    const splitter = new GreedySplitter(mockSemanticSplitter, 20, 200);
    const result = await splitter.splitText("Some Markdown");
    expect(result).toEqual([
      {
        types: ["heading", "text"],
        content: "# Section 1\nContent under section 1",
        section: { level: 1, path: ["Section 1"] },
      },
    ]);
  });

  it("should keep heading separate when minChunkSize = 0", async () => {
    const initialChunks: Chunk[] = [
      {
        types: ["heading"],
        content: "# Section 1",
        section: { level: 1, path: ["Section 1"] },
      },
      {
        types: ["text"],
        content: "Content under section 1",
        section: { level: 1, path: ["Section 1"] },
      },
    ];
    const mockSemanticSplitter = createMockSemanticSplitter(initialChunks);
    const splitter = new GreedySplitter(mockSemanticSplitter, 0, 200);
    const result = await splitter.splitText("Some Markdown");
    expect(result).toEqual(initialChunks);
  });

  it("should use deeper path when merging parent with child section", async () => {
    const initialChunks: Chunk[] = [
      {
        types: ["text"],
        content: "Parent content",
        section: { level: 1, path: ["Section 1"] },
      },
      {
        types: ["text"],
        content: "Child content",
        section: {
          level: 2,
          path: ["Section 1", "SubSection 1.1"],
        },
      },
    ];
    const mockSemanticSplitter = createMockSemanticSplitter(initialChunks);
    const splitter = new GreedySplitter(mockSemanticSplitter, 20, 200);
    const result = await splitter.splitText("Some Markdown");
    expect(result).toEqual([
      {
        types: ["text"],
        content: "Parent content\nChild content",
        section: {
          level: 1, // Uses parent's (lower) level
          path: ["Section 1", "SubSection 1.1"], // But keeps child's path
        },
      },
    ]);
  });

  it("should use common parent when merging sibling sections", async () => {
    const initialChunks: Chunk[] = [
      {
        types: ["text"],
        content: "First subsection",
        section: {
          level: 2,
          path: ["Section 1", "Sub 1.1"],
        },
      },
      {
        types: ["text"],
        content: "Second subsection",
        section: {
          level: 2,
          path: ["Section 1", "Sub 1.2"],
        },
      },
    ];
    const mockSemanticSplitter = createMockSemanticSplitter(initialChunks);
    const splitter = new GreedySplitter(mockSemanticSplitter, 20, 200);
    const result = await splitter.splitText("Some Markdown");
    expect(result).toEqual([
      {
        types: ["text"],
        content: "First subsection\nSecond subsection",
        section: {
          level: 2, // Keeps original level
          path: ["Section 1"], // Common parent path
        },
      },
    ]);
  });

  it("should use root when merging sections with no common path", async () => {
    const initialChunks: Chunk[] = [
      {
        types: ["text"],
        content: "First section",
        section: {
          level: 1,
          path: ["Section 1"],
        },
      },
      {
        types: ["text"],
        content: "Different section",
        section: {
          level: 1,
          path: ["Section 2"],
        },
      },
    ];
    const mockSemanticSplitter = createMockSemanticSplitter(initialChunks);
    const splitter = new GreedySplitter(mockSemanticSplitter, 20, 200);
    const result = await splitter.splitText("Some Markdown");
    expect(result).toEqual([
      {
        types: ["text"],
        content: "First section\nDifferent section",
        section: {
          level: 1, // Keep original level
          path: [], // Root path
        },
      },
    ]);
  });

  it("should handle deeply nested sections", async () => {
    const initialChunks: Chunk[] = [
      {
        types: ["text"],
        content: "Level 1",
        section: { level: 1, path: ["S1"] },
      },
      {
        types: ["text"],
        content: "Level 2",
        section: { level: 2, path: ["S1", "S1.1"] },
      },
      {
        types: ["text"],
        content: "Level 3",
        section: { level: 3, path: ["S1", "S1.1", "S1.1.1"] },
      },
    ];
    const mockSemanticSplitter = createMockSemanticSplitter(initialChunks);
    const splitter = new GreedySplitter(mockSemanticSplitter, 20, 200);
    const result = await splitter.splitText("Some Markdown");
    expect(result).toEqual([
      {
        types: ["text"],
        content: "Level 1\nLevel 2\nLevel 3",
        section: {
          level: 1, // Lowest level
          path: ["S1", "S1.1", "S1.1.1"], // Deepest path
        },
      },
    ]);
  });

  it("should handle deep sibling sections with common parent", async () => {
    const initialChunks: Chunk[] = [
      // Deep sibling sections under Section 1 -> SubSection 1.1
      {
        types: ["text"],
        content: "Subsection A content",
        section: {
          level: 3,
          path: ["Section 1", "SubSection 1.1", "Deep A"],
        },
      },
      {
        types: ["text"],
        content: "Subsection B content",
        section: {
          level: 3,
          path: ["Section 1", "SubSection 1.1", "Deep B"],
        },
      },
    ];
    const mockSemanticSplitter = createMockSemanticSplitter(initialChunks);
    const splitter = new GreedySplitter(mockSemanticSplitter, 20, 200);
    const result = await splitter.splitText("Some Markdown");
    expect(result).toEqual([
      {
        types: ["text"],
        content: "Subsection A content\nSubsection B content",
        section: {
          level: 3, // Keeps original level
          path: ["Section 1", "SubSection 1.1"], // Common parent path
        },
      },
    ]);
  });

  it("should split on H2 headings after minChunkSize is reached", async () => {
    const markdown = `
# Heading 1
# Heading 1.1

Some body of text

# Heading 1.1.1

Some more text

# Heading 1.2

Some other text
`;

    // Create a *real* SemanticMarkdownSplitter to get the initial chunks
    const realSemanticSplitter = new SemanticMarkdownSplitter(200, 5000);
    const initialChunks = await realSemanticSplitter.splitText(markdown);

    const mockSemanticSplitter = createMockSemanticSplitter(initialChunks);
    const splitter = new GreedySplitter(mockSemanticSplitter, 50, 200);
    const result = await splitter.splitText(markdown);

    expect(result.length).toBe(2);
    expect(result[0].content).toContain("# Heading 1.1.1"); // Check content of first chunk
    expect(result[1].content).toContain("# Heading 1.2"); // Check content of second chunk
  });
});
