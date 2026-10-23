import { describe, expect, it } from "vitest";
import { GreedySplitter } from "./GreedySplitter";
import { SemanticMarkdownSplitter } from "./SemanticMarkdownSplitter";
import type { Chunk, DocumentSplitter } from "./types";

/** A base splitter that hands GreedySplitter a fixed list of chunks. */
const createMockSemanticSplitter = (chunks: Chunk[]): DocumentSplitter => ({
  splitText: async () => chunks,
});

describe("GreedySplitter", () => {
  it("should handle empty input", async () => {
    const mockSemanticSplitter = createMockSemanticSplitter([]);
    const splitter = new GreedySplitter(mockSemanticSplitter, 15, 200, 5000);
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
    const splitter = new GreedySplitter(mockSemanticSplitter, 10, 200, 5000);
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
    const splitter = new GreedySplitter(mockSemanticSplitter, 15, 200, 5000);
    const result = await splitter.splitText("Some Markdown");
    expect(result).toEqual([
      {
        types: ["text"],
        content: "Short text 1.\nShort text 2.",
        section: { level: 3, path: ["Test"] },
      },
    ]);
  });

  it("should respect H1/H2 boundaries when current chunk reaches preferred size", async () => {
    const initialChunks: Chunk[] = [
      {
        types: ["text"],
        content:
          "This is a very long text before the heading that exceeds the preferred chunk size and should therefore not be merged with the following content because we want to respect major section boundaries.",
        section: { level: 3, path: ["Test"] },
      },
      {
        types: ["heading"],
        content: "# New Heading",
        section: { level: 1, path: ["New Heading"] },
      },
      {
        types: ["text"],
        content: "This is text after the heading.",
        section: { level: 1, path: ["New Heading"] },
      },
    ];
    const mockSemanticSplitter = createMockSemanticSplitter(initialChunks);
    const splitter = new GreedySplitter(mockSemanticSplitter, 50, 200, 5000);
    const result = await splitter.splitText("Some Markdown");
    expect(result).toEqual([
      {
        types: ["text"],
        content:
          "This is a very long text before the heading that exceeds the preferred chunk size and should therefore not be merged with the following content because we want to respect major section boundaries.",
        section: { level: 3, path: ["Test"] },
      },
      {
        types: ["heading", "text"],
        content: "# New Heading\nThis is text after the heading.",
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
    const splitter = new GreedySplitter(mockSemanticSplitter, 10, 30, 5000);
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

  it("merges a heading with its content, whether minChunkSize is above zero or zero", async () => {
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

    // With minChunkSize = 0, chunks still get merged if they're under preferredChunkSize
    for (const minChunkSize of [20, 0]) {
      const splitter = new GreedySplitter(
        createMockSemanticSplitter(initialChunks),
        minChunkSize,
        200,
        5000,
      );
      expect
        .soft(await splitter.splitText("Some Markdown"), `min ${minChunkSize}`)
        .toEqual([
          {
            types: ["heading", "text"],
            content: "# Section 1\nContent under section 1",
            section: { level: 1, path: ["Section 1"] },
          },
        ]);
    }
  });

  it("gives merged chunks the lowest level and the path the merged sections share", async () => {
    const cases: Array<
      [
        label: string,
        input: Array<[content: string, section: Chunk["section"]]>,
        expected: Chunk["section"],
      ]
    > = [
      [
        // Uses the parent's (lower) level but keeps the child's path
        "parent with child: deeper path",
        [
          ["Parent content", { level: 1, path: ["Section 1"] }],
          ["Child content", { level: 2, path: ["Section 1", "SubSection 1.1"] }],
        ],
        { level: 1, path: ["Section 1", "SubSection 1.1"] },
      ],
      [
        "siblings: common parent path",
        [
          ["First subsection", { level: 2, path: ["Section 1", "Sub 1.1"] }],
          ["Second subsection", { level: 2, path: ["Section 1", "Sub 1.2"] }],
        ],
        { level: 2, path: ["Section 1"] },
      ],
      [
        "no common path: root",
        [
          ["First section", { level: 1, path: ["Section 1"] }],
          ["Different section", { level: 1, path: ["Section 2"] }],
        ],
        { level: 1, path: [] },
      ],
      [
        "deep nesting: lowest level, deepest path",
        [
          ["Level 1", { level: 1, path: ["S1"] }],
          ["Level 2", { level: 2, path: ["S1", "S1.1"] }],
          ["Level 3", { level: 3, path: ["S1", "S1.1", "S1.1.1"] }],
        ],
        { level: 1, path: ["S1", "S1.1", "S1.1.1"] },
      ],
      [
        "deep siblings: common parent path",
        [
          [
            "Subsection A content",
            { level: 3, path: ["Section 1", "SubSection 1.1", "Deep A"] },
          ],
          [
            "Subsection B content",
            { level: 3, path: ["Section 1", "SubSection 1.1", "Deep B"] },
          ],
        ],
        { level: 3, path: ["Section 1", "SubSection 1.1"] },
      ],
    ];

    for (const [label, input, section] of cases) {
      const initialChunks = input.map(
        ([content, section]): Chunk => ({ types: ["text"], content, section }),
      );
      const splitter = new GreedySplitter(
        createMockSemanticSplitter(initialChunks),
        20,
        200,
        5000,
      );
      expect.soft(await splitter.splitText("Some Markdown"), label).toEqual([
        {
          types: ["text"],
          content: input.map(([content]) => content).join("\n"),
          section,
        },
      ]);
    }
  });

  it("starts a new chunk at an H1 once the current chunk reaches minChunkSize", async () => {
    const markdown = `
# Heading 1

Some body of text that is long enough to exceed the preferred chunk size when combined with other content.

## Heading 1.1

Some more text that should be in the first chunk.

# Heading 2

Some other text that should start a new chunk because it's a new H1 section.
`;

    const splitter = new GreedySplitter(
      new SemanticMarkdownSplitter(200, 5000),
      50,
      200,
      5000,
    );
    const result = await splitter.splitText(markdown);

    // "# Heading 2" would still fit under preferredChunkSize, but the H1 opens a new chunk.
    // The H2 below Heading 1 belongs to the same section, so it stays in the first chunk.
    expect(result.map((chunk) => chunk.content.split("\n")[0])).toEqual([
      "# Heading 1",
      "# Heading 2",
    ]);
    expect(result[0].content).toContain("## Heading 1.1");
  });
});
