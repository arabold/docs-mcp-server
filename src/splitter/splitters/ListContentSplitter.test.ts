import { describe, expect, it } from "vitest";
import { ListContentSplitter } from "./ListContentSplitter";
import type { ContentSplitterOptions } from "./types";

describe("ListContentSplitter", () => {
  const options = {
    chunkSize: 50,
  } satisfies ContentSplitterOptions;
  const splitter = new ListContentSplitter(options);

  it("should keep small lists intact", async () => {
    const list = "- Item 1\n- Item 2\n- Item 3";
    const chunks = await splitter.split(list);

    expect(chunks.length).toBe(1);
    expect(chunks[0]).toBe(list);
  });

  it("should split long lists by items", async () => {
    // The first two items are around 45 chars each; the full list is > 50 chars, so it should split.
    const list =
      "- This is item number 1 which is quite long\n- This is item number 2 which is also long\n- This is item number 3";

    const chunks = await splitter.split(list);

    expect(chunks.length).toBeGreaterThan(1);
    // Should split at item boundaries
    expect(chunks[0]).toContain("- This is item number 1");
    // Verify all chunks respect size limit
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(options.chunkSize);
    }
  });

  it("should merge small items if they fit", async () => {
    // Items are short: "- A" (3 chars).
    // Should merge many into one chunk.
    const list = "- A\n- B\n- C\n- D\n- E\n- F\n- G\n- H\n- I\n- J";
    const chunks = await splitter.split(list);

    expect(chunks.length).toBe(1);
    expect(chunks[0]).toBe(list);
  });

  it("should fallback to text splitting for huge items", async () => {
    // Item bigger than chunk size (50)
    const hugeItem =
      "- This is a very very very very very very very very very long item that needs splitting";
    const list = `${hugeItem}\n- Short item`;

    const chunks = await splitter.split(list);

    expect(chunks.length).toBeGreaterThan(1);
    // The huge item should be split into multiple chunks
    const hugeItemChunks = chunks.filter((c) => c.includes("very very"));
    expect(hugeItemChunks.length).toBeGreaterThan(0);

    // Verify size limits
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(options.chunkSize);
    }
  });

  it("should handle numbered lists", async () => {
    const list = "1. Item 1\n2. Item 2\n3. Item 3";
    const chunks = await splitter.split(list);
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toBe(list);
  });
});
