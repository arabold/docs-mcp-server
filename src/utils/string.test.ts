import { describe, expect, it } from "vitest";
import { escapeHtml, formatBytes } from "./string";

describe("formatBytes", () => {
  it("formats a byte count with a unit, and invalid counts as 0 B", () => {
    const cases: Array<[bytes: number, expected: string]> = [
      [0, "0 B"],
      [-1, "0 B"],
      [Number.NaN, "0 B"],
      // Under 1 KB without a decimal
      [512, "512 B"],
      // Larger sizes with one decimal place
      [1536, "1.5 KB"],
      [1024 * 1024, "1.0 MB"],
    ];

    for (const [bytes, expected] of cases) {
      expect.soft(formatBytes(bytes), String(bytes)).toBe(expected);
    }
  });
});

describe("escapeHtml", () => {
  it("escapes markup and quotes, ampersands first", () => {
    expect(escapeHtml(`<a href="x">&amp;</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&amp;amp;&lt;/a&gt;",
    );
  });
});
