import { describe, expect, it } from "vitest";
import { FenceTracker, hasOpenFenceAtEnd, parseFenceOpener } from "./fenceState";

const fence = (lang: string, body: string) => `\`\`\`${lang}\n${body}\n\`\`\``;

describe("fenceState", () => {
  it("hasOpenFenceAtEnd reports text that ends inside an unclosed fence", () => {
    const cases: Array<[label: string, text: string, open: boolean]> = [
      ["no fences", "plain prose", false],
      ["balanced", `text\n${fence("ts", "x")}\nmore`, false],
      ["ends right after the closer", `${fence("", "x")}\n`, false],
      ["ends on the opener line", "intro\n```ts", true],
      ["ends inside an unclosed fence", "text\n```ts\nconst x", true],
      [
        "a tilde line does not close a backtick fence",
        "```ts\ncode\n~~~\nstill open\n",
        true,
      ],
      ["a shorter closer does not close a longer opener", "````md\ninside\n```\n", true],
      ["a longer closer closes", "```\ncode\n````\n", false],
      ["text after the fence is not a closer", "```\ncode\n``` not a closer\n", true],
      ["3-space indent", "prose\n   ```ts\n   code\n", true],
      // Turndown emits 4-space indented fences inside list-item bodies.
      ["4-space indent, closed", "prose\n    ```ts\n    code\n    ```\nafter", false],
      ["tilde fence in a blockquote", "> ~~~\n> code\n", true],
      ["the second of several fences is open", "a\n```\nA\n```\nb\n```\nB", true],
    ];

    for (const [label, text, open] of cases) {
      expect.soft(hasOpenFenceAtEnd(text), label).toBe(open);
    }
  });

  it("FenceTracker follows fence state across the pieces fed to it", () => {
    const cases: Array<[label: string, pieces: string[], open: boolean[]]> = [
      [
        "one line per piece",
        ["text\n", "```ts\n", "const x = 1;\n", "```\n", "after"],
        [false, true, true, false, false],
      ],
      [
        "paragraph pieces",
        ["Intro.\n\n", "```py\ndef f():\n\n", "    return 1\n```\n\n", "End."],
        [false, true, false, false],
      ],
      [
        "pieces ending mid-line",
        ["```", "ts\ncode\n``", "`\nafter"],
        [true, true, false],
      ],
    ];

    for (const [label, pieces, open] of cases) {
      const tracker = new FenceTracker();
      const seen = pieces.map((piece) => {
        tracker.feed(piece);
        return tracker.isOpen();
      });
      expect.soft(seen, label).toEqual(open);
    }
  });

  it("parseFenceOpener reads the prefix, character and length of an opener", () => {
    expect(parseFenceOpener("  > ````ts title=a.ts")).toEqual({
      prefix: "  > ",
      delimiter: "`",
      length: 4,
    });
    expect(parseFenceOpener("~~~")).toEqual({ prefix: "", delimiter: "~", length: 3 });
    expect(parseFenceOpener("`` not a fence")).toBeNull();
  });
});
