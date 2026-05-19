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

  it("preserves the full info string verbatim, including renderer-specific metadata", async () => {
    // Regression: previous /^```(\w+)\n/ regex failed for `js{15-18} twoslash [server.js]`,
    // leaving the opener in place and producing a double-wrapped fence. The
    // fix preserves the entire info string — line-highlight ranges (`{15-18}`),
    // Twoslash hints, filename tabs (`[server.js]`) — so the chunk is a
    // faithful copy of the source rather than a lossy reformat.
    const splitter = new CodeContentSplitter({ chunkSize: 300 });
    const code = ["import fs from 'node:fs'", "createServer()"].join("\n");
    const markdown = `\`\`\`js{15-18} twoslash [server.js]\n${code}\n\`\`\``;
    const chunks = await splitter.split(markdown);
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toBe(markdown); // round-trip identity
    expect((chunks[0].match(/```/g) || []).length).toBe(2);
  });

  it("preserves the info string across every chunk when splitting a long fence", async () => {
    const splitter = new CodeContentSplitter({ chunkSize: 80 });
    const code = Array.from({ length: 8 }, (_, i) => `const x_${i} = ${i};`).join("\n");
    const markdown = `\`\`\`ts twoslash\n${code}\n\`\`\``;
    const chunks = await splitter.split(markdown);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.startsWith("```ts twoslash\n")).toBe(true);
      expect(chunk.endsWith("\n```")).toBe(true);
      expect((chunk.match(/```/g) || []).length).toBe(2);
    }
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
