import { describe, expect, it } from "vitest";
import { hasOpenFenceAtEnd } from "./fenceState";
import { TextContentSplitter } from "./TextContentSplitter";
import type { ContentSplitterOptions } from "./types";

const fenceCount = (s: string) => (s.match(/```/g) || []).length;
/** Counts the lines that open or close a backtick or tilde fence. */
const fenceLineCount = (s: string) => (s.match(/^(?:```|~~~)/gm) || []).length;

describe("TextContentSplitter", () => {
  const options = {
    chunkSize: 100,
  } satisfies ContentSplitterOptions;
  const splitter = new TextContentSplitter(options);

  it("should split on paragraph boundaries when possible", async () => {
    const text = `First paragraph with some content.

Second paragraph that continues the text.

Third paragraph to complete the example.`;

    const chunks = await splitter.split(text);

    expect(chunks.length).toBe(3);
    // Chunks now preserve paragraph separators for perfect reconstruction
    expect(chunks[0]).toBe("First paragraph with some content.\n\n");
    expect(chunks[1]).toBe("Second paragraph that continues the text.\n\n");
    expect(chunks[2]).toBe("Third paragraph to complete the example.");

    // Verify perfect reconstruction
    expect(chunks.join("")).toBe(text);
  });

  it("should fall back to line breaks when paragraphs too large", async () => {
    // Create a paragraph larger than preferredChunkSize
    const longParagraph = Array(5)
      .fill("This is a very long line of text that should be split.")
      .join(" ");

    const text = `${longParagraph}
Line two of the text.
Line three continues here.
And line four finishes it.`;

    const chunks = await splitter.split(text);

    // Should split into multiple chunks at line boundaries
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(options.chunkSize);
    }
  });

  it("should merge small chunks when possible", async () => {
    const text =
      "Short line 1.\nShort line 2.\nShort line 3.\n\nAnother short one.\nAnd another.";

    const chunks = await splitter.split(text);

    // Small consecutive lines should be merged
    expect(chunks.length).toBeLessThan(6); // Less than total number of lines
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(options.chunkSize);
    }
  });

  it("should handle empty content gracefully", async () => {
    const emptyChunks = await splitter.split("");
    expect(emptyChunks.length).toBe(1);
    expect(emptyChunks[0]).toBe("");

    // Whitespace should be preserved now
    const whitespaceChunks = await splitter.split("   \n  \n  ");
    expect(whitespaceChunks.length).toBe(1);
    expect(whitespaceChunks[0]).toBe("   \n  \n  ");
  });

  it("keeps formatting and whitespace, so the chunks join back to the input", async () => {
    const cases: Array<[label: string, text: string]> = [
      [
        "indentation",
        `  function example() {
    // This has indentation
    const value = "test";
    
    return value;
  }`,
      ],
      [
        "blank lines",
        `Line 1

Line 3 with blank line above


Line 6 with multiple blank lines above`,
      ],
    ];

    for (const [label, text] of cases) {
      expect.soft((await splitter.split(text)).join(""), label).toBe(text);
    }
  });

  it("should split words as last resort", async () => {
    const splitter = new TextContentSplitter({
      chunkSize: 20, // Very small for testing word splitting
    });

    const text =
      "This is a very long sentence that needs to be split into smaller chunks";

    const chunks = await splitter.split(text);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(20);
    }
  });

  describe("fence balance", () => {
    it("keeps every fenced code block intact and the chunks lossless", async () => {
      const cases: Array<[label: string, chunkSize: number, text: string]> = [
        [
          // The fence contains a blank line, so a naive paragraph split would cut inside it.
          "fence straddling a paragraph boundary",
          70,
          [
            "Intro paragraph that takes up some space here in the document.",
            "",
            "```ts",
            "const x = 1;",
            "",
            "const y = 2;",
            "```",
            "",
            "Trailing paragraph that follows the example code block.",
          ].join("\n"),
        ],
        [
          // Only the second fence has a blank line inside, so the split has to track
          // it after the first fence has closed.
          "several fences separated by prose",
          60,
          [
            "Para A.",
            "",
            "```ts",
            "a();",
            "```",
            "",
            "Para B that takes a bit of space to write out fully.",
            "",
            "```python",
            "def f():",
            "",
            "    return 1",
            "```",
            "",
            "Para C trailing the example.",
          ].join("\n"),
        ],
        [
          "tilde fence with a blank line inside",
          60,
          [
            "Intro.",
            "",
            "~~~",
            "line 1",
            "",
            "line 2 with a blank line inside the fence",
            "~~~",
            "",
            "Trailing.",
          ].join("\n"),
        ],
      ];

      for (const [label, chunkSize, text] of cases) {
        const chunks = await new TextContentSplitter({ chunkSize }).split(text);
        for (const c of chunks) {
          expect.soft(fenceLineCount(c) % 2, `${label}: balanced`).toBe(0);
          expect.soft(hasOpenFenceAtEnd(c), `${label}: no open fence`).toBe(false);
        }
        expect.soft(chunks.join(""), `${label}: lossless`).toBe(text);
      }
    });

    it("cuts a fenced block larger than chunkSize into re-wrapped chunks within the limit", async () => {
      const lines = Array.from(
        { length: 20 },
        (_, i) => `  const value_${i} = "some moderately long content";`,
      );
      const cases: Array<[label: string, text: string, rewrap: RegExp]> = [
        [
          "backtick fence between paragraphs",
          ["Intro line.", "", "```ts title=a.ts", ...lines, "```", "", "Trailing."].join(
            "\n",
          ),
          /```\n```ts title=a\.ts\n/g,
        ],
        [
          // Two large blocks back to back must not be chained into one chunk.
          "two adjacent fences",
          ["```ts", ...lines, "```", "Between.", "~~~", ...lines, "~~~"].join("\n"),
          /```\n```ts\n|~~~\n~~~\n/g,
        ],
        [
          "fence inside a blockquote",
          ["> ```sh", ...lines.map((line) => `> ${line}`), "> ```"].join("\n"),
          /> ```\n> ```sh\n/g,
        ],
        [
          "code line longer than chunkSize",
          ["```txt", `${"word ".repeat(60)}end`, "```"].join("\n"),
          /\n```\n```txt\n/g,
        ],
      ];

      for (const [label, text, rewrap] of cases) {
        const chunks = await new TextContentSplitter({ chunkSize: 120 }).split(text);

        expect.soft(chunks.length, `${label}: split`).toBeGreaterThan(1);
        for (const c of chunks) {
          expect.soft(c.length, `${label}: within the limit`).toBeLessThanOrEqual(120);
          expect.soft(fenceCount(c) % 2, `${label}: balanced`).toBe(0);
          expect.soft(hasOpenFenceAtEnd(c), `${label}: no open fence`).toBe(false);
        }
        // Taking the added closer and opener out gives back the input.
        expect.soft(chunks.join("").replace(rewrap, ""), `${label}: lossless`).toBe(text);
      }
    });

    it("keeps a fenced block whole up to maxChunkSize while holding prose to chunkSize", async () => {
      const splitter = new TextContentSplitter({ chunkSize: 100, maxChunkSize: 300 });
      const code = Array.from({ length: 8 }, (_, i) => `x${i} = "value number ${i}";`);
      const block = ["```py", ...code, "```"].join("\n");
      const text = [`${"word ".repeat(40)}end`, "", block, "", "Trailing."].join("\n");

      const chunks = await splitter.split(text);

      expect(block.length).toBeGreaterThan(100);
      expect(chunks.some((c) => c.includes(block))).toBe(true);
      for (const c of chunks.filter((c) => !c.includes("```"))) {
        expect.soft(c.length).toBeLessThanOrEqual(100);
      }
      expect(chunks.join("")).toBe(text);
    });

    it("keeps a document with an unclosed fence within chunkSize", async () => {
      const body = Array.from({ length: 30 }, (_, i) => `line ${i} of an unclosed block`);
      const text = ["Intro.", "", "```", ...body].join("\n");

      const chunks = await new TextContentSplitter({ chunkSize: 100 }).split(text);

      for (const c of chunks) {
        expect.soft(c.length).toBeLessThanOrEqual(100);
      }
      // Only the last chunk is left open, as the input is.
      expect(chunks.map((c) => hasOpenFenceAtEnd(c))).toEqual(
        chunks.map((_, i) => i === chunks.length - 1),
      );
    });

    it("splits only the line that is too long and keeps the other lines whole", async () => {
      const text = [
        "Short line one.",
        "Short line two.",
        `${"word ".repeat(40)}end`,
        "Short line three.",
      ].join("\n");

      const chunks = await new TextContentSplitter({ chunkSize: 60 }).split(text);

      expect(chunks.join("")).toBe(text);
      expect(chunks[0]).toBe("Short line one.\nShort line two.\n");
      expect(chunks.at(-1)).toMatch(/Short line three\.$/);
      for (const c of chunks) {
        expect.soft(c.length).toBeLessThanOrEqual(60);
      }
    });
  });
});
