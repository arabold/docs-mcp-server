import matter from "gray-matter";
import { describe, expect, it } from "vitest";
import { SemanticMarkdownSplitter } from "./SemanticMarkdownSplitter";

describe("SemanticMarkdownSplitter", () => {
  it("should handle empty markdown", async () => {
    const splitter = new SemanticMarkdownSplitter(100, 5000);
    const result = await splitter.splitText("");
    expect(result).toEqual([]);
  });

  it("puts text without headings into one root-level text chunk", async () => {
    const splitter = new SemanticMarkdownSplitter(1000, 2000);
    const cases: Array<[label: string, markdown: string, content: string]> = [
      [
        "plain sentence",
        "This is some text without any headings.",
        "This is some text without any headings.",
      ],
      // JSON should be routed to JsonPipeline; if it reaches this splitter, it is plain text.
      [
        "raw JSON",
        `{"name": "test", "version": "1.0.0"}`,
        `{"name": "test", "version": "1.0.0"}`,
      ],
      [
        "invalid JSON",
        `{
      "name": "test-library",
      "version": "1.0.0"
      // This comment makes it invalid JSON
      "invalid": true
    }`,
        '{ "name": "test-library", "version": "1.0.0" // This comment makes it invalid JSON "invalid": true }',
      ],
      [
        "longer prose",
        "This is not JSON at all, just plain text content that should be preserved.",
        "This is not JSON at all, just plain text content that should be preserved.",
      ],
    ];

    for (const [label, markdown, content] of cases) {
      expect
        .soft(await splitter.splitText(markdown), label)
        .toEqual([{ types: ["text"], content, section: { level: 0, path: [] } }]);
    }
  });

  it("should correctly split on H1-H6 headings", async () => {
    const splitter = new SemanticMarkdownSplitter(100, 5000);
    const markdown = `
# Chapter 1
Some text in chapter 1.

## Section 1.1
More text in section 1.1.

### Subsection 1.1.1
Text in subsection.
This should stay with previous section.

#### H4 Heading
Some text after h4

##### H5 Heading
Some text after h5

###### H6 Heading
Some text after h6

## Section 1.2
Final text.

# Chapter 2
Text in chapter 2.
`;
    const result = await splitter.splitText(markdown);

    expect(result).toEqual([
      {
        types: ["heading"],
        content: "# Chapter 1",
        section: {
          level: 1,
          path: ["Chapter 1"],
        },
      },
      {
        types: ["text"],
        content: "Some text in chapter 1.",
        section: {
          level: 1,
          path: ["Chapter 1"],
        },
      },
      {
        types: ["heading"],
        content: "## Section 1.1",
        section: {
          level: 2,
          path: ["Chapter 1", "Section 1.1"],
        },
      },
      {
        types: ["text"],
        content: "More text in section 1.1.",
        section: {
          level: 2,
          path: ["Chapter 1", "Section 1.1"],
        },
      },
      {
        types: ["heading"],
        content: "### Subsection 1.1.1",
        section: {
          level: 3,
          path: ["Chapter 1", "Section 1.1", "Subsection 1.1.1"],
        },
      },
      {
        types: ["text"],
        content: "Text in subsection. This should stay with previous section.",
        section: {
          level: 3,
          path: ["Chapter 1", "Section 1.1", "Subsection 1.1.1"],
        },
      },
      {
        types: ["heading"],
        content: "#### H4 Heading",
        section: {
          level: 4,
          path: ["Chapter 1", "Section 1.1", "Subsection 1.1.1", "H4 Heading"],
        },
      },
      {
        types: ["text"],
        content: "Some text after h4",
        section: {
          level: 4,
          path: ["Chapter 1", "Section 1.1", "Subsection 1.1.1", "H4 Heading"],
        },
      },
      {
        types: ["heading"],
        content: "##### H5 Heading",
        section: {
          level: 5,
          path: [
            "Chapter 1",
            "Section 1.1",
            "Subsection 1.1.1",
            "H4 Heading",
            "H5 Heading",
          ],
        },
      },
      {
        types: ["text"],
        content: "Some text after h5",
        section: {
          level: 5,
          path: [
            "Chapter 1",
            "Section 1.1",
            "Subsection 1.1.1",
            "H4 Heading",
            "H5 Heading",
          ],
        },
      },
      {
        types: ["heading"],
        content: "###### H6 Heading",
        section: {
          level: 6,
          path: [
            "Chapter 1",
            "Section 1.1",
            "Subsection 1.1.1",
            "H4 Heading",
            "H5 Heading",
            "H6 Heading",
          ],
        },
      },
      {
        types: ["text"],
        content: "Some text after h6",
        section: {
          level: 6,
          path: [
            "Chapter 1",
            "Section 1.1",
            "Subsection 1.1.1",
            "H4 Heading",
            "H5 Heading",
            "H6 Heading",
          ],
        },
      },
      {
        types: ["heading"],
        content: "## Section 1.2",
        section: {
          level: 2,
          path: ["Chapter 1", "Section 1.2"],
        },
      },
      {
        types: ["text"],
        content: "Final text.",
        section: {
          level: 2,
          path: ["Chapter 1", "Section 1.2"],
        },
      },
      {
        types: ["heading"],
        content: "# Chapter 2",
        section: {
          level: 1,
          path: ["Chapter 2"],
        },
      },
      {
        types: ["text"],
        content: "Text in chapter 2.",
        section: {
          level: 1,
          path: ["Chapter 2"],
        },
      },
    ]);
  });

  it("should separate headings, text, code, and tables", async () => {
    const splitter = new SemanticMarkdownSplitter(100, 5000);
    const markdown = `
# Mixed Content Section

This is some text.
More text here.

\`\`\`javascript
// Some code in JavaScript
console.log('Hello');
\`\`\`

| Header 1 | Header 2 |
| -------- | -------- |
| Cell 1   | Cell 2   |
`;
    const result = await splitter.splitText(markdown);

    expect(result).toEqual([
      {
        types: ["heading"],
        content: "# Mixed Content Section",
        section: {
          level: 1,
          path: ["Mixed Content Section"],
        },
      },
      {
        types: ["text"],
        content: "This is some text. More text here.",
        section: {
          level: 1,
          path: ["Mixed Content Section"],
        },
      },
      {
        types: ["code"],
        content: "```javascript\n// Some code in JavaScript\nconsole.log('Hello');\n```",
        section: {
          level: 1,
          path: ["Mixed Content Section"],
        },
      },
      {
        types: ["table"],
        content: "| Header 1 | Header 2 |\n|---|---|\n| Cell 1 | Cell 2 |",
        section: {
          level: 1,
          path: ["Mixed Content Section"],
        },
      },
    ]);
  });

  it("should correctly split long tables while preserving headers", async () => {
    const splitter = new SemanticMarkdownSplitter(10, 100);

    // Create a table with many rows that will exceed chunkSize
    const tableRows = Array.from(
      { length: 20 },
      (_, i) => `| ${i + 1} | This is row ${i + 1} | ${(i + 1) * 100} |`,
    ).join("\n");

    const markdown = `
| ID | Description | Value |
|----|------------|-------|
${tableRows}
`;

    const result = await splitter.splitText(markdown);

    // Verify that we got multiple chunks
    expect(result.length).toBeGreaterThan(1);

    // Verify each chunk
    for (const chunk of result) {
      expect(chunk.types).toEqual(["table"]);
      // Each chunk should start with the header
      expect(chunk.content).toMatch(/^\| ID \| Description \| Value \|/);
      // Each chunk should have the header separator
      expect(chunk.content).toMatch(/\|---|---|---\|/);
      // Each chunk should have at least one data row
      expect(chunk.content.split("\n").length).toBeGreaterThan(2);
      // Each chunk should be valid markdown table format
      expect(chunk.content).toMatch(/^\|.*\|$/gm);
      // Each chunk should be within size limit
      expect(chunk.content.length).toBeLessThanOrEqual(100);
    }
  });

  it("should correctly split long code blocks while preserving language", async () => {
    const splitter = new SemanticMarkdownSplitter(10, 100);

    // Create a long code block that will exceed chunkSize
    const codeLines = Array.from(
      { length: 20 },
      (_, i) =>
        `console.log("This is line ${i + 1} with some extra text to make it longer");`,
    ).join("\n");

    const markdown = `
\`\`\`javascript
${codeLines}
\`\`\`
`;

    const result = await splitter.splitText(markdown);

    // Verify that we got multiple chunks
    expect(result.length).toBeGreaterThan(1);

    // Verify each chunk
    for (const chunk of result) {
      expect(chunk.types).toEqual(["code"]);
      // Each chunk should start with the language identifier
      expect(chunk.content).toMatch(/^```javascript\n/);
      // Each chunk should end with closing backticks
      expect(chunk.content).toMatch(/\n```$/);
      // Each chunk should contain actual code
      expect(chunk.content).toMatch(/console\.log/);
      // Each chunk should be within size limit
      expect(chunk.content.length).toBeLessThanOrEqual(100);
    }
  });

  it("falls back to character splitting for a table or code block that cannot be split semantically", async () => {
    const splitter = new SemanticMarkdownSplitter(20, 20);
    const cases: Array<[label: string, markdown: string]> = [
      [
        "table",
        `
| Header1 | Header2 |
|---------|---------|
| Cell1   | Cell2   |`,
      ],
      ["code block", "```javascript\nconst x = 1;\n```"],
    ];

    for (const [label, markdown] of cases) {
      const result = await splitter.splitText(markdown);
      expect.soft(result.length, `${label}: chunks`).toBeGreaterThan(0);
      for (const chunk of result) {
        expect.soft(chunk.content.length, `${label}: chunk size`).toBeLessThanOrEqual(20);
      }
    }
  });

  it("extracts the raw YAML frontmatter block into its own chunk", async () => {
    // Regression for #503: gray-matter caches parsed results and returns a shallow copy
    // for repeated parses, which drops the non-enumerable `matter` property. The pipeline
    // parses the same content in MarkdownMetadataExtractorMiddleware before it reaches the
    // splitter, so the cache is always warm here.
    const splitter = new SemanticMarkdownSplitter(100, 5000);
    const markdown = `---
# A YAML comment
title:   Spaced Out
tags: [one, two]
---
# Main Content`;

    matter(markdown); // warm gray-matter's cache, as the middleware does

    const result = await splitter.splitText(markdown);

    // The block keeps its delimiters, comments and spacing exactly as written.
    expect(result[0]).toEqual({
      types: ["frontmatter"],
      content: "---\n# A YAML comment\ntitle:   Spaced Out\ntags: [one, two]\n---",
      section: { level: 0, path: [] },
    });
    expect(result[1].types).toEqual(["heading"]);
    expect(result[1].content).toBe("# Main Content");
  });

  it("does not treat a leading block that is not a YAML mapping as frontmatter", async () => {
    const splitter = new SemanticMarkdownSplitter(100, 5000);
    const cases: Array<[label: string, markdown: string, kept: string]> = [
      // A document opening with `---` has its whole body parsed as YAML by gray-matter,
      // which can yield a bare string. Only a mapping is real frontmatter; otherwise the
      // entire page would collapse into a single frontmatter chunk and lose its structure.
      ["leading thematic break", "---\n\n# Hello\n\nBody text.", "Body text."],
      // The half the type check missed. With no closing delimiter gray-matter
      // consumes the whole document as YAML, and a body of `Key: value` prose
      // parses as a mapping — so it looks exactly like real frontmatter and the
      // page collapses into one chunk with no headings. Turndown renders `<hr>`
      // as `---`, so HTML pages reach this too.
      [
        "unclosed leading break with a mapping body",
        "---\n\n## Deprecation notice\n\nReplacement: use the createClient helper instead.",
        "createClient",
      ],
      ["scalar", "---\njust a bare string\n---\n# Main Content", "Main Content"],
      ["list", "---\n- one\n- two\n---\n# Main Content", "Main Content"],
      // gray-matter is permissive, so invalid YAML may still parse; with no data it is not
      // frontmatter, and its text stays in the output.
      ["malformed YAML", "---\ninvalid: : yaml\n---\n# Main Content", "invalid"],
    ];

    for (const [label, markdown, kept] of cases) {
      const result = await splitter.splitText(markdown);
      expect
        .soft(
          result.filter((c) => c.types.includes("frontmatter")),
          `${label}: frontmatter`,
        )
        .toHaveLength(0);
      expect
        .soft(
          result.some((c) => c.types.includes("heading")),
          `${label}: heading`,
        )
        .toBe(true);
      expect
        .soft(result.map((c) => c.content).join("\n"), `${label}: text`)
        .toContain(kept);
    }
  });

  it("should keep the frontmatter chunk within the size limit", async () => {
    // It is prepended after splitting, so nothing else bounds it.
    const splitter = new SemanticMarkdownSplitter(1000, 5000);
    const markdown = `---\ntitle: T\nsummary: ${"word ".repeat(2000)}\n---\n\n# Head\n\nBody.`;

    const result = await splitter.splitText(markdown);

    expect(result.some((c) => c.types.includes("frontmatter"))).toBe(true);
    expect(Math.max(...result.map((c) => c.content.length))).toBeLessThanOrEqual(5000);
  });

  it("should keep an indivisible frontmatter block rather than failing the page", async () => {
    // One unbroken token longer than the limit cannot be divided. That is the
    // behaviour bounding replaced, so it degrades to it instead of throwing.
    const splitter = new SemanticMarkdownSplitter(1000, 5000);
    const markdown = `---\ntoken: ${"x".repeat(10000)}\n---\n\n# Head\n\nBody.`;

    const result = await splitter.splitText(markdown);

    expect(result.some((c) => c.types.includes("frontmatter"))).toBe(true);
    expect(result.some((c) => c.types.includes("heading"))).toBe(true);
  });

  it("should split long lists", async () => {
    const splitter = new SemanticMarkdownSplitter(50, 5000);
    const markdown = `
# Long List

- This is item 1 which is long enough to cause a split hopefully
- This is item 2 which is also long enough
`;
    const result = await splitter.splitText(markdown);

    // Header + List items split
    expect(result.length).toBeGreaterThan(2);
    expect(result[0].types).toEqual(["heading"]);

    // Check list chunks
    const listChunks = result.slice(1);
    expect(listChunks.every((c) => c.types.includes("list"))).toBe(true);
    // Should be split
    expect(listChunks.length).toBeGreaterThan(1);
  });

  it("should handle horizontal rules as separators", async () => {
    const splitter = new SemanticMarkdownSplitter(100, 5000);
    const markdown = `
Paragraph 1.

---

Paragraph 2.
`;
    const result = await splitter.splitText(markdown);

    // Should have 2 text chunks. HR itself is ignored but causes separation.
    // If they were merged, it would be 1 chunk (if small enough).
    // But since they are separate paragraphs/elements, they are likely separate chunks anyway.
    // However, we want to verify they are identified as separate 'text' chunks.
    expect(result).toHaveLength(2);
    expect(result[0].types).toEqual(["text"]);
    expect(result[0].content).toBe("Paragraph 1.");
    expect(result[1].types).toEqual(["text"]);
    expect(result[1].content).toBe("Paragraph 2.");
  });

  it("should handle mixed content types", async () => {
    const splitter = new SemanticMarkdownSplitter(100, 5000);
    const markdown = `
# Mixed

Text paragraph.

- List item 1
- List item 2

> Blockquote
> spanning two lines.

![Image](src)
`;
    const result = await splitter.splitText(markdown);

    expect(result).toHaveLength(5);
    expect(result[0].types).toEqual(["heading"]);
    expect(result[1].types).toEqual(["text"]);
    expect(result[2].types).toEqual(["list"]);
    // Turndown might add extra spaces for alignment
    expect(result[2].content).toMatch(/- +List item 1/);
    expect(result[2].content).toMatch(/- +List item 2/);
    expect(result[3].types).toEqual(["blockquote"]);
    expect(result[3].content).toContain("> Blockquote");
    expect(result[4].types).toEqual(["media"]);
    expect(result[4].content).toContain("![Image]");
  });

  it("balances code fences inside nested containers (issue #418)", async () => {
    const splitter = new SemanticMarkdownSplitter(400, 1200);
    const longCode = (prefix: string, count = 30) =>
      Array.from(
        { length: count },
        (_, i) => `${prefix}${i} = "lorem ipsum dolor sit amet, consectetur";`,
      ).join("\n");
    const fenceCount = (s: string) => (s.match(/```/g) || []).length;

    const cases: Array<[label: string, input: string]> = [
      [
        "list item",
        [
          "# Heading",
          "",
          "Intro prose.",
          "",
          ...[0, 1, 2].map(
            (i) =>
              `- Item ${i} description text that takes some space.\n\n  \`\`\`ts\n  ${longCode(`  const a${i}_`).replace(/\n/g, "\n  ")}\n  \`\`\``,
          ),
          "",
          "Trailing prose.",
        ].join("\n"),
      ],
      [
        "blockquote",
        [
          "# Heading",
          "",
          "Intro.",
          "",
          "> NOTE: this is a callout containing a code sample.",
          ">",
          ["```ts", longCode("const k"), "```"]
            .join("\n")
            .split("\n")
            .map((l) => `> ${l}`)
            .join("\n"),
          "",
          "Trailing prose.",
        ].join("\n"),
      ],
    ];

    for (const [label, input] of cases) {
      const result = await splitter.splitText(input);
      expect.soft(result.length, `${label}: chunks`).toBeGreaterThan(0);
      for (const chunk of result) {
        expect.soft(fenceCount(chunk.content) % 2, `${label}: balanced`).toBe(0);
      }
    }
  });
});

describe("heading anchor annotations", () => {
  /** Returns every section path and heading line the splitter produced. */
  const split = async (markdown: string) => {
    const chunks = await new SemanticMarkdownSplitter(100, 5000).splitText(markdown);
    return {
      paths: chunks.flatMap((c) => c.section.path),
      content: chunks.map((c) => c.content).join("\n"),
    };
  };

  it("drops a trailing anchor annotation and keeps every other heading text", async () => {
    const cases: Array<
      [label: string, markdown: string, path: string, dropped?: string]
    > = [
      // react.dev pins heading ids this way; the annotation is an instruction to
      // the renderer, so indexing it puts noise in both the embedding and the
      // section path a reader sees.
      [
        "MDX anchor comment",
        "## Adding styles {/*adding-styles*/}\n\nUse className.",
        "Adding styles",
        "{/*",
      ],
      [
        "hash-style anchor",
        "## Adding styles {#adding-styles}\n\nBody.",
        "Adding styles",
        "{#adding-styles}",
      ],
      // Only a trailing annotation is an anchor. A heading about JSX or object
      // literals has to survive intact.
      [
        "braces that are part of the heading",
        "## Use {count} in JSX\n\nBody.",
        "Use {count} in JSX",
      ],
      ["no annotation", "## Plain heading\n\nBody.", "Plain heading"],
    ];

    for (const [label, markdown, path, dropped] of cases) {
      const { paths, content } = await split(markdown);
      expect.soft(paths, `${label}: path`).toContain(path);
      expect.soft(content, `${label}: heading`).toContain(`## ${path}`);
      if (dropped) {
        expect.soft(content, `${label}: annotation`).not.toContain(dropped);
      }
    }
  });
});
