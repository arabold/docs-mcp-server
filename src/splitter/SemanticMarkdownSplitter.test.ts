import { describe, expect, it, vi } from "vitest";
import { SemanticMarkdownSplitter } from "./SemanticMarkdownSplitter";

vi.mock("../utils/logger");

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

  it("should split large JSON code blocks into valid JSON chunks", async () => {
    const splitter = new SemanticMarkdownSplitter(10, 50); // small chunk size for test
    const jsonArray = Array.from({ length: 10 }, (_, i) => ({ id: i, value: `val${i}` }));
    const markdown = ["```json", JSON.stringify(jsonArray), "```"].join("\n");
    const result = await splitter.splitText(markdown);
    // All chunks should be code, valid JSON, and within size
    expect(result.length).toBeGreaterThan(1);
    for (const chunk of result) {
      expect(chunk.types).toEqual(["code"]);
      expect(chunk.content).toMatch(/^```json\n[\s\S]*\n```$/);
      // Extract JSON body
      const body = chunk.content.replace(/^```json\n/, "").replace(/\n```$/, "");
      expect(() => JSON.parse(body)).not.toThrow();
      expect(chunk.content.length).toBeLessThanOrEqual(50);
    }
  });

  it("should fall back to normal code splitting for non-JSON code blocks", async () => {
    const splitter = new SemanticMarkdownSplitter(10, 50);
    const codeLines = Array.from({ length: 10 }, (_, i) => `console.log(${i});`).join(
      "\n",
    );
    const markdown = ["```js", codeLines, "```"].join("\n");
    const result = await splitter.splitText(markdown);
    expect(result.length).toBeGreaterThan(1);
    for (const chunk of result) {
      expect(chunk.types).toEqual(["code"]);
      expect(chunk.content).toMatch(/^```js\n[\s\S]*\n```$/);
      expect(chunk.content.length).toBeLessThanOrEqual(50);
    }
  });
});
