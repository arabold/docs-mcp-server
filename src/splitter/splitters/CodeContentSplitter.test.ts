import { describe, expect, it } from "vitest";
import { CodeContentSplitter } from "./CodeContentSplitter";

describe("CodeContentSplitter", () => {
  it("returns a fence that fits unchanged", async () => {
    const splitter = new CodeContentSplitter({ chunkSize: 100 });
    const cases: Array<[label: string, markdown: string]> = [
      [
        "with a language",
        '```typescript\nfunction test() {\n  console.log("Hello");\n}\n```',
      ],
      ["without a language", "```\nconst x = 1;\nconst y = 2;\n```"],
      ["empty body", "```python\n\n```"],
      // Regression: previous /^```(\w+)\n/ regex failed for `js{15-18} twoslash [server.js]`,
      // leaving the opener in place and producing a double-wrapped fence. The
      // fix preserves the entire info string — line-highlight ranges (`{15-18}`),
      // Twoslash hints, filename tabs (`[server.js]`) — so the chunk is a
      // faithful copy of the source rather than a lossy reformat.
      [
        "full info string",
        "```js{15-18} twoslash [server.js]\nimport fs from 'node:fs'\ncreateServer()\n```",
      ],
    ];

    for (const [label, markdown] of cases) {
      expect.soft(await splitter.split(markdown), label).toEqual([markdown]);
    }
  });

  it("splits a long fence by lines and repeats the info string on every chunk", async () => {
    const splitter = new CodeContentSplitter({ chunkSize: 80 });
    const code = [
      "function test() {",
      "  if (condition) {",
      "    for (let i = 0; i < 10; i++) {",
      "      console.log(i);",
      "    }",
      "  }",
      "}",
    ].join("\n");
    const markdown = `\`\`\`ts twoslash\n${code}\n\`\`\``;

    const chunks = await splitter.split(markdown);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(80);
      expect(chunk.startsWith("```ts twoslash\n")).toBe(true);
      expect(chunk.endsWith("\n```")).toBe(true);
      expect((chunk.match(/```/g) || []).length).toBe(2);
    }
    // The bodies, in order, are the original lines with their indentation.
    expect(chunks.flatMap((chunk) => chunk.split("\n").slice(1, -1))).toEqual(
      code.split("\n"),
    );
  });
});
