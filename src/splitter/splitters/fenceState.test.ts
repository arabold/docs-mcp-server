import { describe, expect, it } from "vitest";
import { hasOpenFenceAtEnd, isOpenAt, nextSafeOffset } from "./fenceState";

const fence = (lang: string, body: string) => `\`\`\`${lang}\n${body}\n\`\`\``;

/** Picks an offset in `text`, so each row can name its position relative to a fence. */
type Offset = (text: string) => number;

describe("fenceState", () => {
  it("isOpenAt reports whether an offset lies inside a fence", () => {
    const plain = "hello\nworld\n";
    const backtick = `before\n${fence("ts", "const x = 1;")}\nafter`;
    const tilde = "before\n~~~\ncode here\n~~~\nafter";
    const indented = "prose\n   ```ts\n   code\n   ```\nafter";
    // Turndown emits 4-space indented fences inside list-item bodies.
    const listy = "prose\n    ```ts\n    code\n    ```\nafter";
    // 4-backtick opener cannot be closed by 3-backtick line.
    const longOpener = "````ts\ninside ```not a closer\n````\nafter";
    const multiple = "a\n```\nA\n```\nb\n```\nB\n```\nc";
    const end: Offset = (t) => t.length;
    const nthFence = (t: string, n: number) => {
      let at = -3;
      for (let i = 0; i <= n; i++) at = t.indexOf("```", at + 3);
      return at;
    };

    const cases: Array<[label: string, text: string, at: Offset, open: boolean]> = [
      ["no fence: start", plain, () => 0, false],
      ["no fence: middle", plain, () => 6, false],
      ["no fence: end", plain, end, false],
      ["backtick: at the opener", backtick, (t) => t.indexOf("```"), false],
      ["backtick: just after the opener", backtick, (t) => t.indexOf("```") + 1, true],
      ["backtick: inside the opener line", backtick, (t) => t.indexOf("```") + 5, true],
      // +4 includes the newline after the closer.
      ["backtick: after the closer", backtick, (t) => t.lastIndexOf("```") + 4, false],
      ["backtick: end", backtick, end, false],
      ["tilde: just after the opener", tilde, (t) => t.indexOf("~~~") + 1, true],
      ["tilde: inside the opener line", tilde, (t) => t.indexOf("~~~") + 5, true],
      ["tilde: end", tilde, end, false],
      // Backtick opener has no closer — entire rest is "inside".
      [
        "backtick opener is not closed by a tilde line",
        "```ts\ncode\n~~~\nstill open\n",
        (t) => t.length - 1,
        true,
      ],
      ["3-space indent: inside", indented, (t) => t.indexOf("   ```") + 5, true],
      ["3-space indent: end", indented, end, false],
      ["4-space indent: inside", listy, (t) => t.indexOf("    ```") + 6, true],
      ["4-space indent: end", listy, end, false],
      ["longer opener: inside", longOpener, (t) => t.indexOf("````") + 2, true],
      // Right after the closer's line + newline: outside.
      [
        "longer opener: after its closer",
        longOpener,
        (t) => t.lastIndexOf("````") + 5,
        false,
      ],
      [
        "unclosed opener stays open to the end",
        "intro\n```ts\nno closer",
        (t) => t.length - 1,
        true,
      ],
      ["multiple: inside the first", multiple, (t) => nthFence(t, 0) + 1, true],
      ["multiple: after the first", multiple, (t) => nthFence(t, 1) + 4, false],
      ["multiple: inside the second", multiple, (t) => nthFence(t, 2) + 1, true],
      ["multiple: after the second", multiple, (t) => nthFence(t, 3) + 4, false],
    ];

    for (const [label, text, at, open] of cases) {
      expect.soft(isOpenAt(text, at(text)), label).toBe(open);
    }
  });

  it("nextSafeOffset moves an offset inside a fence past its closer", () => {
    const closed = `intro\n${fence("ts", "code")}\nafter`;
    const cases: Array<[label: string, text: string, at: Offset, expected: Offset]> = [
      ["outside any fence: unchanged", "no fences here", () => 5, () => 5],
      // The candidate sits inside the opener line, past the ```; +4 includes the newline after the closer.
      [
        "inside a fence: past the closer",
        closed,
        (t) => t.indexOf("```") + 4,
        (t) => t.lastIndexOf("```") + 4,
      ],
      [
        "inside an unclosed fence: end of input",
        "intro\n```ts\nstill open",
        (t) => t.indexOf("```") + 4,
        (t) => t.length,
      ],
    ];

    for (const [label, text, at, expected] of cases) {
      expect.soft(nextSafeOffset(text, at(text)), label).toBe(expected(text));
    }
  });

  it("hasOpenFenceAtEnd reports content that ends inside an unclosed fence", () => {
    const cases: Array<[label: string, text: string, open: boolean]> = [
      ["balanced", `text\n${fence("", "x")}\nmore`, false],
      ["ends inside an unclosed fence", "text\n```ts\nconst x", true],
      ["no fences", "plain prose", false],
    ];

    for (const [label, text, open] of cases) {
      expect.soft(hasOpenFenceAtEnd(text), label).toBe(open);
    }
  });
});
