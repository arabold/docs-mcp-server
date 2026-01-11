import { describe, expect, it } from "vitest";
import { SemanticMarkdownSplitter } from "./SemanticMarkdownSplitter";

describe("SemanticMarkdownSplitter", () => {
  it("should handle empty markdown", async () => {
    const splitter = new SemanticMarkdownSplitter(100, 5000);
    const result = await splitter.splitText("");
    expect(result).toEqual([]);
  });

  it("should handle markdown with no headings", async () => {
    const splitter = new SemanticMarkdownSplitter(100, 5000);
    const markdown = "This is some text without any headings.";
    const result = await splitter.splitText(markdown);

    expect(result).toEqual([
      {
        types: ["text"],
        content: "This is some text without any headings.",
        section: {
          level: 0,
          path: [],
        },
      },
    ]);
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

  it("should handle tables that cannot be split semantically by using character-based splitting", async () => {
    const splitter = new SemanticMarkdownSplitter(20, 20);
    const markdown = `
| Header1 | Header2 |
|---------|---------|
| Cell1   | Cell2   |`;

    // Should not throw an error anymore
    const result = await splitter.splitText(markdown);

    // Verify we got chunks back
    expect(result.length).toBeGreaterThan(0);

    // Each chunk should be under the max size
    expect(result.every((chunk) => chunk.content.length <= 20)).toBe(true);
  });

  it("should handle code blocks that cannot be split semantically by using character-based splitting", async () => {
    const splitter = new SemanticMarkdownSplitter(20, 20);
    const markdown = "```javascript\nconst x = 1;\n```";

    // Should not throw an error anymore
    const result = await splitter.splitText(markdown);

    // Verify we got chunks back
    expect(result.length).toBeGreaterThan(0);

    // Each chunk should be under the max size
    expect(result.every((chunk) => chunk.content.length <= 20)).toBe(true);
  });

  it("should handle JSON code blocks in markdown properly", async () => {
    const markdown = `
# API Documentation

Here's an example API response:

\`\`\`json
{
  "name": "test-library",
  "version": "1.0.0",
  "dependencies": {
    "react": "^18.0.0",
    "lodash": "^4.17.21"
  }
}
\`\`\`

This JSON shows the package structure.
`;

    const splitter = new SemanticMarkdownSplitter(1000, 2000);
    const chunks = await splitter.splitText(markdown);

    expect(chunks).toHaveLength(4);

    // Should have heading chunk
    expect(chunks[0]).toEqual({
      types: ["heading"],
      content: "# API Documentation",
      section: {
        level: 1,
        path: ["API Documentation"],
      },
    });

    // Should have text chunk
    expect(chunks[1]).toEqual({
      types: ["text"],
      content: "Here's an example API response:",
      section: {
        level: 1,
        path: ["API Documentation"],
      },
    });

    // Should have JSON code block chunk with preserved formatting
    expect(chunks[2].types).toEqual(["code"]);
    expect(chunks[2].content).toMatch(/^```json\n/);
    expect(chunks[2].content).toMatch(/\n```$/);
    expect(chunks[2].content).toContain("test-library");
    expect(chunks[2].content).toContain("react");
    expect(chunks[2].section).toEqual({
      level: 1,
      path: ["API Documentation"],
    });

    // Should have final text chunk
    expect(chunks[3]).toEqual({
      types: ["text"],
      content: "This JSON shows the package structure.",
      section: {
        level: 1,
        path: ["API Documentation"],
      },
    });
  });

  it("should handle raw JSON as plain text in edge cases", async () => {
    // This simulates the edge case where JSON content somehow gets processed as markdown
    // In practice, this should be rare because JSON should be routed to JsonPipeline
    const rawJson = `{"name": "test", "version": "1.0.0"}`;

    const splitter = new SemanticMarkdownSplitter(1000, 2000);
    const chunks = await splitter.splitText(rawJson);

    // Should treat as plain text content
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toContain("test");
    expect(chunks[0].content).toContain("1.0.0");
    expect(chunks[0].section.path).toEqual([]);
    expect(chunks[0].types).toEqual(["text"]);
  });

  it("should handle invalid JSON as plain text", async () => {
    const invalidJson = `{
      "name": "test-library",
      "version": "1.0.0"
      // This comment makes it invalid JSON
      "invalid": true
    }`;

    const splitter = new SemanticMarkdownSplitter(1000, 2000);
    const chunks = await splitter.splitText(invalidJson);

    // Should treat as plain text content without structural splitting
    expect(chunks).toHaveLength(1);
    expect(chunks[0].section.path).toEqual([]);
  });

  it("should preserve content for non-JSON text", async () => {
    const textContent = `This is not JSON at all, just plain text content that should be preserved.`;

    const splitter = new SemanticMarkdownSplitter(1000, 2000);
    const chunks = await splitter.splitText(textContent);

    // Should preserve the content as-is in a single chunk
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toContain(textContent);
    expect(chunks[0].section.path).toEqual([]);
  });

  it("should extract YAML frontmatter into a separate chunk", async () => {
    const splitter = new SemanticMarkdownSplitter(100, 5000);
    const markdown = `---
title: My Doc
tags: [one, two]
---
# Main Content`;

    const result = await splitter.splitText(markdown);

    expect(result.length).toBeGreaterThan(1);
    expect(result[0].types).toEqual(["frontmatter"]);
    expect(result[0].content).toContain("title: My Doc");
    expect(result[0].content).toContain("tags: [one, two]");
    // Should include delimiters
    expect(result[0].content).toMatch(/^---\n[\s\S]*\n---$/);

    expect(result[1].types).toEqual(["heading"]);
    expect(result[1].content).toBe("# Main Content");
  });

  it("should ignore malformed frontmatter and treat it as text", async () => {
    const splitter = new SemanticMarkdownSplitter(100, 5000);
    // Malformed because no closing delimiter or invalid yaml structure that gray-matter rejects?
    // gray-matter is very permissive. It requires --- on the first line.
    // If we have --- but invalid yaml inside, gray-matter might still extract it but data might be empty?
    // If data is empty, we skip frontmatter chunk creation.
    const markdown = `---
invalid: : yaml
---
# Main Content`;

    const result = await splitter.splitText(markdown);

    // Invalid frontmatter must not be treated as a frontmatter chunk.
    const frontmatterChunks = result.filter((c) => c.types.includes("frontmatter"));
    expect(frontmatterChunks).toHaveLength(0);

    // The invalid frontmatter content should still be preserved in the output.
    const combinedContent = result.map((c) => c.content).join("\n");
    expect(combinedContent).toContain("invalid");
  });
});
