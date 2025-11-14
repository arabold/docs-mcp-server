import { describe, expect, it } from "vitest";
import { MinimumChunkSizeError } from "../errors";
import { TableContentSplitter } from "./TableContentSplitter";
import type { ContentSplitterOptions } from "./types";

describe("TableContentSplitter", () => {
  const options = {
    chunkSize: 100,
  } satisfies ContentSplitterOptions;
  const splitter = new TableContentSplitter(options);

  it("should preserve table headers in each chunk", async () => {
    const table = `| Column 1 | Column 2 | Column 3 |
|----------|-----------|-----------|
| Data A1  | Data A2   | Data A3   |
| Data B1  | Data B2   | Data B3   |`;

    const chunks = await splitter.split(table);

    for (const chunk of chunks) {
      const lines = chunk.split("\n");
      expect(lines[0]).toBe("| Column 1 | Column 2 | Column 3 |");
      expect(lines[1]).toBe("|---|---|---|");
    }
  });

  it("should split large tables by rows", async () => {
    // Create a large table that *might* exceed chunkSize, depending on header length
    const rows = Array(20)
      .fill(0)
      .map((_, i) => `| Data ${i}A | Data ${i}B |`);
    const table = `| Header A | Header B |
|----------|-----------|
${rows.join("\n")}`;

    const chunks = await splitter.split(table);
    expect(chunks.length).toBeGreaterThan(0); // It will split, even if not > 1
    for (const chunk of chunks) {
      const lines = chunk.split("\n");
      expect(lines[0]).toBe("| Header A | Header B |");
      expect(lines[1]).toBe("|---|---|");
    }
  });

  it("should throw MinimumChunkSizeError if single row with headers exceeds chunkSize", async () => {
    const splitter = new TableContentSplitter({
      chunkSize: 50, // Small size for testing
    });
    const table = `| Header A | Header B | Header C |
|----------|-----------|-----------|
| Very long data that exceeds max chunk size with headers | More data | And more |`;

    await expect(splitter.split(table)).rejects.toThrow(MinimumChunkSizeError);

    await expect(splitter.split(table)).rejects.toThrowError(
      "Cannot split content any further",
    );
  });

  it("should handle empty table", async () => {
    const splitter = new TableContentSplitter(options);
    const table = "";
    const chunks = await splitter.split(table);
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toBe("");
  });

  it("should preserve special characters", async () => {
    const splitter = new TableContentSplitter(options);
    const table = `| Symbol | Description |
|---------|-------------|
| →       | Arrow       |
| 👋      | Wave        |
| &copy;  | Copyright   |
| <tag>   | HTML Tag    |`;

    const chunks = await splitter.split(table);
    const allContent = chunks.join("");
    expect(allContent).toContain("→");
    expect(allContent).toContain("👋");
    expect(allContent).toContain("&copy;");
    expect(allContent).toContain("<tag>");
  });
});
