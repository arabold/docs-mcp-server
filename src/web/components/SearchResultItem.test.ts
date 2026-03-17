import { describe, expect, it } from "vitest";
import SearchResultItem from "./SearchResultItem";

describe("SearchResultItem", () => {
  it("shows the original MIME type when available", async () => {
    const html = String(
      await SearchResultItem({
        result: {
          url: "https://example.com/page",
          content: "# Title\n\nBody",
          score: 0.9,
          mimeType: "text/markdown",
          sourceMimeType: "text/html",
        },
      }),
    );

    expect(html).toContain("text/html");
    expect(html).not.toContain("text/markdown</span>");
  });

  it("falls back to processed MIME type when original MIME type is missing", async () => {
    const html = String(
      await SearchResultItem({
        result: {
          url: "https://example.com/code.ts",
          content: "const x = 1;",
          score: 0.9,
          mimeType: "text/x-typescript",
        },
      }),
    );

    expect(html).toContain("text/x-typescript");
  });
});
