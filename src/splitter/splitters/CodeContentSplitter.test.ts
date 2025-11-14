import { describe, expect, it } from "vitest";
import { CodeContentSplitter } from "./CodeContentSplitter";
import type { ContentSplitterOptions } from "./types";

describe("CodeContentSplitter", () => {
  const options = {
    chunkSize: 100,
  } satisfies ContentSplitterOptions;
  const splitter = new CodeContentSplitter(options);

  it("should preserve language in code blocks", async () => {
    const code = `function test() {
  console.log("Hello");
}`;
    const markdown = `\`\`\`typescript\n${code}\n\`\`\``;
    const chunks = await splitter.split(markdown);
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toBe(markdown);
  });

  it("should handle code without language", async () => {
    const code = `const x = 1;
const y = 2;`;
    const markdown = `\`\`\`\n${code}\n\`\`\``;
    const chunks = await splitter.split(markdown);
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toBe(markdown);
  });

  it("should split large code blocks by lines", async () => {
    const longLine =
      "console.log('This is a very long line of code that should be split.');";
    const code = Array(10).fill(longLine).join("\n");

    const markdown = `\`\`\`javascript\n${code}\n\`\`\``;
    const chunks = await splitter.split(markdown);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(options.chunkSize);
      expect(chunk.startsWith("```javascript\n")).toBe(true);
      expect(chunk.endsWith("\n```")).toBe(true);
    }
  });

  it("should handle empty code blocks", async () => {
    const markdown = "```python\n\n```";
    const chunks = await splitter.split(markdown);
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toBe(markdown);
  });

  it("should preserve indentation", async () => {
    const code = `function test() {
  if (condition) {
    for (let i = 0; i < 10; i++) {
      console.log(i);
    }
  }
}`;
    const markdown = `\`\`\`typescript\n${code}\n\`\`\``;
    const chunks = await splitter.split(markdown);
    for (const chunk of chunks) {
      // Check if indentation is preserved within the chunk
      const lines = chunk.split("\n");
      for (let i = 1; i < lines.length - 1; i++) {
        // Skip the first (```typescript) and last (```) lines
        if (lines[i].includes("if")) {
          expect(lines[i].startsWith("  "));
        } else if (lines[i].includes("for")) {
          expect(lines[i].startsWith("    "));
        } else if (lines[i].includes("console")) {
          expect(lines[i].startsWith("      "));
        }
      }
    }
  });
});
