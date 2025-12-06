/**
 * Tests for JSON chunk size limits
 * Verifies that JSON chunks never exceed the maximum chunk size,
 * even when falling back to text-based splitting.
 */

import { describe, expect, it } from "vitest";
import { SPLITTER_MAX_CHUNK_SIZE } from "../utils/config";
import { JsonDocumentSplitter } from "./JsonDocumentSplitter";

describe("JsonDocumentSplitter - chunk size limits", () => {
  it("should respect max chunk size when processing deep nested JSON", async () => {
    // Create a deeply nested JSON that exceeds maxDepth
    const largeValue = "x".repeat(6000); // Larger than max chunk size
    const deepJson = {
      level1: {
        level2: {
          level3: {
            level4: {
              level5: {
                level6: {
                  largeData: largeValue,
                },
              },
            },
          },
        },
      },
    };

    const splitter = new JsonDocumentSplitter({ maxDepth: 3 });
    const chunks = await splitter.splitText(JSON.stringify(deepJson, null, 2));

    // Verify no chunk exceeds the max size
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(SPLITTER_MAX_CHUNK_SIZE);
    }
  });

  it("should respect max chunk size when exceeding maxChunks limit", async () => {
    // Create a JSON with many properties that will exceed maxChunks
    const largeJson: Record<string, any> = {};
    for (let i = 0; i < 100; i++) {
      // Each property has a large value
      largeJson[`property${i}`] = "x".repeat(6000);
    }

    const splitter = new JsonDocumentSplitter({ maxChunks: 50 });
    const chunks = await splitter.splitText(JSON.stringify(largeJson, null, 2));

    // Verify no chunk exceeds the max size
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(SPLITTER_MAX_CHUNK_SIZE);
    }

    // Should have fallen back to text splitting
    const hasTextSplitterChunks = chunks.some(
      (c) => c.section.level === 0 && c.section.path.length === 0,
    );
    expect(hasTextSplitterChunks).toBe(true);
  });

  it("should handle very large single JSON values at max depth", async () => {
    // Create a JSON where a nested value is very large
    const veryLargeValue = "y".repeat(15000); // 15KB value
    const json = {
      level1: {
        level2: {
          level3: {
            level4: {
              level5: {
                level6: {
                  hugeData: veryLargeValue,
                  moreData: "additional data",
                },
              },
            },
          },
        },
      },
    };

    const splitter = new JsonDocumentSplitter({ maxDepth: 3 });
    const chunks = await splitter.splitText(JSON.stringify(json, null, 2));

    // Verify no chunk exceeds the max size
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (chunk.content.length > SPLITTER_MAX_CHUNK_SIZE) {
        console.log(
          `Chunk ${i} exceeds max size: ${chunk.content.length} > ${SPLITTER_MAX_CHUNK_SIZE}`,
        );
        console.log(`Content preview: ${chunk.content.substring(0, 100)}...`);
      }
      expect(chunk.content.length).toBeLessThanOrEqual(SPLITTER_MAX_CHUNK_SIZE);
    }

    // Should have multiple chunks due to text splitting
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("should handle array with large values at max depth", async () => {
    const largeValue = "z".repeat(6000);
    const json = {
      level1: {
        level2: {
          level3: {
            level4: [largeValue, largeValue, largeValue],
          },
        },
      },
    };

    const splitter = new JsonDocumentSplitter({ maxDepth: 3 });
    const chunks = await splitter.splitText(JSON.stringify(json, null, 2));

    // Verify no chunk exceeds the max size
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(SPLITTER_MAX_CHUNK_SIZE);
    }
  });

  it("should properly split chunks smaller than max size when not at depth limit", async () => {
    // Normal JSON that shouldn't trigger text splitting
    const json = {
      config: {
        database: {
          host: "localhost",
          port: 5432,
          name: "mydb",
        },
        cache: {
          enabled: true,
          ttl: 3600,
        },
      },
    };

    const splitter = new JsonDocumentSplitter({ maxDepth: 5 });
    const chunks = await splitter.splitText(JSON.stringify(json, null, 2));

    // All chunks should be well below max size
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThan(200); // Much smaller than max
    }

    // Should have JSON structure chunks (not text fallback)
    const hasJsonStructure = chunks.some((c) => c.section.level > 0);
    expect(hasJsonStructure).toBe(true);
  });
});
