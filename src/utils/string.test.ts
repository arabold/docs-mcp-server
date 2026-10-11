import { describe, expect, it } from "vitest";
import { escapeHtml, formatBytes } from "./string";

describe("formatBytes", () => {
  it("formats zero and invalid values as 0 B", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(-1)).toBe("0 B");
    expect(formatBytes(Number.NaN)).toBe("0 B");
  });

  it("formats byte counts under 1 KB without a decimal", () => {
    expect(formatBytes(512)).toBe("512 B");
  });

  it("formats larger sizes with one decimal place", () => {
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
  });
});

describe("escapeHtml", () => {
  it("escapes markup and quotes, ampersands first", () => {
    expect(escapeHtml(`<a href="x">&amp;</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&amp;amp;&lt;/a&gt;",
    );
  });
});
