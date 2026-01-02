import { beforeEach, describe, expect, it, vi } from "vitest";
import { type AppConfig, loadConfig } from "../../../utils/config";
import type { DocumentStore } from "../../DocumentStore";
import type { DbPageChunk } from "../../types";
import { MarkdownAssemblyStrategy } from "./MarkdownAssemblyStrategy";

// Mock DocumentStore with just the methods we need
const createMockDocumentStore = () =>
  ({
    findParentChunk: vi.fn().mockResolvedValue(null),
    findPrecedingSiblingChunks: vi.fn().mockResolvedValue([]),
    findSubsequentSiblingChunks: vi.fn().mockResolvedValue([]),
    findChildChunks: vi.fn().mockResolvedValue([]),
    findChunksByIds: vi.fn().mockResolvedValue([]),
  }) as Partial<DocumentStore> as DocumentStore;

// Test fixtures - creating a "document universe"
const createDocumentUniverse = () => {
  return {
    // Target chunk (the one we're finding relations for)
    target: {
      id: "target",
      content: "Target content",
      url: "https://example.com",
      metadata: { path: ["Chapter 1", "Section 1.1"] },
    } as DbPageChunk,

    // Parent
    parent: {
      id: "parent",
      content: "Parent section content",
      url: "https://example.com",
      metadata: { path: ["Chapter 1"] },
    } as DbPageChunk,

    // Children (limit = 3, so child4 should be excluded)
    child1: {
      id: "child1",
      content: "First child content",
      url: "https://example.com",
      metadata: {
        path: ["Chapter 1", "Section 1.1", "Subsection A"],
      },
    } as DbPageChunk,
    child2: {
      id: "child2",
      content: "Second child content",
      url: "https://example.com",
      metadata: {
        path: ["Chapter 1", "Section 1.1", "Subsection B"],
      },
    } as DbPageChunk,
    child3: {
      id: "child3",
      content: "Third child content",
      url: "https://example.com",
      metadata: {
        path: ["Chapter 1", "Section 1.1", "Subsection C"],
      },
    } as DbPageChunk,
    child4: {
      id: "child4",
      content: "Fourth child content (should be excluded)",
      url: "https://example.com",
      metadata: {
        path: ["Chapter 1", "Section 1.1", "Subsection D"],
      },
    } as DbPageChunk,

    // Preceding siblings (limit = 1, so only prev1 should be included)
    prev1: {
      id: "prev1",
      content: "Previous sibling 1",
      url: "https://example.com",
      metadata: { path: ["Chapter 1", "Section 1.0"] },
    } as DbPageChunk,
    prev2: {
      id: "prev2",
      content: "Previous sibling 2 (should be excluded)",
      url: "https://example.com",
      metadata: { path: ["Chapter 1", "Section 0.9"] },
    } as DbPageChunk,

    // Subsequent siblings (limit = 2)
    next1: {
      id: "next1",
      content: "Next sibling 1",
      url: "https://example.com",
      metadata: { path: ["Chapter 1", "Section 1.2"] },
    } as DbPageChunk,
    next2: {
      id: "next2",
      content: "Next sibling 2",
      url: "https://example.com",
      metadata: { path: ["Chapter 1", "Section 1.3"] },
    } as DbPageChunk,
    next3: {
      id: "next3",
      content: "Next sibling 3 (should be excluded)",
      url: "https://example.com",
      metadata: { path: ["Chapter 1", "Section 1.4"] },
    } as DbPageChunk,

    // Orphan chunk (no relations)
    orphan: {
      id: "orphan",
      content: "Orphan content",
      url: "https://example.com/other",
      metadata: { path: ["Standalone"] },
    } as DbPageChunk,
  };
};

describe("MarkdownAssemblyStrategy", () => {
  let strategy: MarkdownAssemblyStrategy;
  let mockStore: DocumentStore;
  let config: AppConfig;
  let universe: ReturnType<typeof createDocumentUniverse>;

  beforeEach(() => {
    config = loadConfig();
    strategy = new MarkdownAssemblyStrategy(config);
    mockStore = createMockDocumentStore();
    universe = createDocumentUniverse();
  });

  // Helper function for setting up comprehensive mock store responses
  const setupFullMockStore = () => {
    vi.mocked(mockStore.findParentChunk).mockImplementation(async (_lib, _ver, id) => {
      if (id === "target") return universe.parent;
      return null;
    });

    vi.mocked(mockStore.findPrecedingSiblingChunks).mockImplementation(
      async (_lib, _ver, id, limit) => {
        if (id === "target") return [universe.prev1].slice(0, limit); // Only prev1, respecting limit of 1
        return [];
      },
    );

    vi.mocked(mockStore.findSubsequentSiblingChunks).mockImplementation(
      async (_lib, _ver, id, limit) => {
        if (id === "target") return [universe.next1, universe.next2].slice(0, limit); // Only next1 & next2, respecting limit of 2
        return [];
      },
    );

    vi.mocked(mockStore.findChildChunks).mockImplementation(
      async (_lib, _ver, id, limit) => {
        if (id === "target")
          return [universe.child1, universe.child2, universe.child3].slice(0, limit); // Only first 3 children, respecting limit of 3
        return [];
      },
    );

    vi.mocked(mockStore.findChunksByIds).mockImplementation(async (_lib, _ver, ids) => {
      const idSet = new Set(ids);
      return Object.values(universe).filter((doc) => idSet.has(doc.id as string));
    });
  };

  describe("canHandle", () => {
    it("handles markdown content types", () => {
      expect(strategy.canHandle("text/markdown")).toBe(true);
      expect(strategy.canHandle("text/x-markdown")).toBe(true);
    });

    it("handles HTML content types", () => {
      expect(strategy.canHandle("text/html")).toBe(true);
      expect(strategy.canHandle("application/xhtml+xml")).toBe(true);
    });

    it("handles plain text content types", () => {
      expect(strategy.canHandle("text/plain")).toBe(true);
      expect(strategy.canHandle("text/css")).toBe(true);
    });

    it("serves as fallback for unknown types", () => {
      expect(strategy.canHandle(undefined)).toBe(true);
      expect(strategy.canHandle("application/unknown")).toBe(true);
    });

    it("rejects structured content types (delegated to HierarchicalAssemblyStrategy)", () => {
      expect(strategy.canHandle("text/x-typescript")).toBe(false);
      expect(strategy.canHandle("application/json")).toBe(false);
      expect(strategy.canHandle("text/x-python")).toBe(false);
    });
  });

  describe("assembleContent", () => {
    it("joins chunks with double newlines", () => {
      const chunks = [universe.target, universe.child1, universe.child2];

      const result = strategy.assembleContent(chunks);

      expect(result).toBe(
        "Target content\n\nFirst child content\n\nSecond child content",
      );
    });

    it("handles empty chunk array", () => {
      const result = strategy.assembleContent([]);
      expect(result).toBe("");
    });

    it("handles single chunk", () => {
      const result = strategy.assembleContent([universe.target]);
      expect(result).toBe("Target content");
    });

    it("preserves chunk order", () => {
      const chunks = [universe.child2, universe.target, universe.child1];
      const result = strategy.assembleContent(chunks);
      expect(result).toBe(
        "Second child content\n\nTarget content\n\nFirst child content",
      );
    });

    it("handles chunks with existing newlines", () => {
      const chunkWithNewlines = {
        id: "newlines",
        content: "Line 1\nLine 2\n\nLine 4",
        metadata: {},
      } as DbPageChunk;

      const result = strategy.assembleContent([universe.target, chunkWithNewlines]);
      expect(result).toBe("Target content\n\nLine 1\nLine 2\n\nLine 4");
    });
  });

  describe("selectChunks", () => {
    describe("single chunk scenarios", () => {
      it("chunk with no relations (orphan)", async () => {
        // Setup: orphan has no relations
        vi.mocked(mockStore.findParentChunk).mockResolvedValue(null);
        vi.mocked(mockStore.findPrecedingSiblingChunks).mockResolvedValue([]);
        vi.mocked(mockStore.findSubsequentSiblingChunks).mockResolvedValue([]);
        vi.mocked(mockStore.findChildChunks).mockResolvedValue([]);
        vi.mocked(mockStore.findChunksByIds).mockResolvedValue([universe.orphan]);

        const result = await strategy.selectChunks(
          "lib",
          "1.0.0",
          [universe.orphan],
          mockStore,
        );

        expect(result).toEqual([universe.orphan]);
        expect(mockStore.findChunksByIds).toHaveBeenCalledWith("lib", "1.0.0", [
          "orphan",
        ]);
      });

      it("chunk with only parent", async () => {
        vi.mocked(mockStore.findParentChunk).mockResolvedValue(universe.parent);
        vi.mocked(mockStore.findPrecedingSiblingChunks).mockResolvedValue([]);
        vi.mocked(mockStore.findSubsequentSiblingChunks).mockResolvedValue([]);
        vi.mocked(mockStore.findChildChunks).mockResolvedValue([]);
        vi.mocked(mockStore.findChunksByIds).mockResolvedValue([
          universe.target,
          universe.parent,
        ]);

        const result = await strategy.selectChunks(
          "lib",
          "1.0.0",
          [universe.target],
          mockStore,
        );

        // Verify behavior: includes target and its parent
        expect(result).toHaveLength(2);
        expect(result).toContain(universe.target);
        expect(result).toContain(universe.parent);
      });

      it("chunk with only children", async () => {
        vi.mocked(mockStore.findParentChunk).mockResolvedValue(null);
        vi.mocked(mockStore.findPrecedingSiblingChunks).mockResolvedValue([]);
        vi.mocked(mockStore.findSubsequentSiblingChunks).mockResolvedValue([]);
        vi.mocked(mockStore.findChildChunks).mockResolvedValue([
          universe.child1,
          universe.child2,
        ]);
        vi.mocked(mockStore.findChunksByIds).mockResolvedValue([
          universe.target,
          universe.child1,
          universe.child2,
        ]);

        const result = await strategy.selectChunks(
          "lib",
          "1.0.0",
          [universe.target],
          mockStore,
        );

        // Verify behavior: includes target and its children
        expect(result).toHaveLength(3);
        expect(result).toContain(universe.target);
        expect(result).toContain(universe.child1);
        expect(result).toContain(universe.child2);
      });

      it("chunk with only siblings", async () => {
        vi.mocked(mockStore.findParentChunk).mockResolvedValue(null);
        vi.mocked(mockStore.findPrecedingSiblingChunks).mockResolvedValue([
          universe.prev1,
        ]);
        vi.mocked(mockStore.findSubsequentSiblingChunks).mockResolvedValue([
          universe.next1,
          universe.next2,
        ]);
        vi.mocked(mockStore.findChildChunks).mockResolvedValue([]);
        vi.mocked(mockStore.findChunksByIds).mockResolvedValue([
          universe.target,
          universe.prev1,
          universe.next1,
          universe.next2,
        ]);

        const result = await strategy.selectChunks(
          "lib",
          "1.0.0",
          [universe.target],
          mockStore,
        );

        // Verify behavior: includes target and its siblings
        expect(result).toHaveLength(4);
        expect(result).toContain(universe.target);
        expect(result).toContain(universe.prev1);
        expect(result).toContain(universe.next1);
        expect(result).toContain(universe.next2);
      });

      it("chunk with full family (parent + siblings + children)", async () => {
        setupFullMockStore();

        const result = await strategy.selectChunks(
          "lib",
          "1.0.0",
          [universe.target],
          mockStore,
        );

        // Should include target + parent + 1 preceding + 2 subsequent + 3 children = 8 chunks
        expect(result).toHaveLength(8);
        expect(result).toContain(universe.target);
        expect(result).toContain(universe.parent);
        expect(result).toContain(universe.prev1);
        expect(result).toContain(universe.next1);
        expect(result).toContain(universe.next2);
        expect(result).toContain(universe.child1);
        expect(result).toContain(universe.child2);
        expect(result).toContain(universe.child3);

        // Should NOT include prev2 (exceeds preceding limit of 1)
        expect(result).not.toContain(universe.prev2);
        // Should NOT include next3 (exceeds subsequent limit of 2)
        expect(result).not.toContain(universe.next3);
        // Should NOT include child4 (exceeds child limit of 3)
        expect(result).not.toContain(universe.child4);
      });
    });

    describe("multiple initial chunks", () => {
      it("chunks from same document", async () => {
        // Setup: both child1 and child2 relate to target
        vi.mocked(mockStore.findParentChunk).mockImplementation(
          async (_lib, _ver, id) => {
            if (id === "child1" || id === "child2") return universe.target;
            return null;
          },
        );
        vi.mocked(mockStore.findPrecedingSiblingChunks).mockResolvedValue([]);
        vi.mocked(mockStore.findSubsequentSiblingChunks).mockResolvedValue([]);
        vi.mocked(mockStore.findChildChunks).mockResolvedValue([]);
        vi.mocked(mockStore.findChunksByIds).mockResolvedValue([
          universe.child1,
          universe.child2,
          universe.target,
        ]);

        const result = await strategy.selectChunks(
          "lib",
          "1.0.0",
          [universe.child1, universe.child2],
          mockStore,
        );

        // Verify behavior: includes both children plus their shared parent (target), deduplicated
        expect(result).toHaveLength(3);
        expect(result).toContain(universe.child1);
        expect(result).toContain(universe.child2);
        expect(result).toContain(universe.target);
      });

      it("chunks with overlapping relations (deduplication)", async () => {
        // Setup: target and parent both relate to each other
        vi.mocked(mockStore.findParentChunk).mockImplementation(
          async (_lib, _ver, id) => {
            if (id === "target") return universe.parent;
            return null;
          },
        );
        vi.mocked(mockStore.findChildChunks).mockImplementation(
          async (_lib, _ver, id, _limit) => {
            if (id === "parent") return [universe.target];
            return [];
          },
        );
        vi.mocked(mockStore.findPrecedingSiblingChunks).mockResolvedValue([]);
        vi.mocked(mockStore.findSubsequentSiblingChunks).mockResolvedValue([]);
        vi.mocked(mockStore.findChunksByIds).mockResolvedValue([
          universe.target,
          universe.parent,
        ]);

        const result = await strategy.selectChunks(
          "lib",
          "1.0.0",
          [universe.target, universe.parent],
          mockStore,
        );

        // Verify behavior: deduplicates overlapping relationships
        expect(result).toHaveLength(2); // No duplicates
        expect(result).toContain(universe.target);
        expect(result).toContain(universe.parent);
      });

      it("chunks from different documents", async () => {
        vi.mocked(mockStore.findParentChunk).mockResolvedValue(null);
        vi.mocked(mockStore.findPrecedingSiblingChunks).mockResolvedValue([]);
        vi.mocked(mockStore.findSubsequentSiblingChunks).mockResolvedValue([]);
        vi.mocked(mockStore.findChildChunks).mockResolvedValue([]);
        vi.mocked(mockStore.findChunksByIds).mockResolvedValue([
          universe.target,
          universe.orphan,
        ]);

        const result = await strategy.selectChunks(
          "lib",
          "1.0.0",
          [universe.target, universe.orphan],
          mockStore,
        );

        // Verify behavior: includes both unrelated chunks
        expect(result).toHaveLength(2);
        expect(result).toContain(universe.target);
        expect(result).toContain(universe.orphan);
      });
    });

    describe("limit adherence", () => {
      it("respects PRECEDING_SIBLINGS_LIMIT (1)", async () => {
        // Setup: Mock store has 2 preceding siblings available, but strategy should only request 1
        vi.mocked(mockStore.findParentChunk).mockResolvedValue(null);
        vi.mocked(mockStore.findChildChunks).mockResolvedValue([]);
        vi.mocked(mockStore.findSubsequentSiblingChunks).mockResolvedValue([]);

        // Mock returns only 1 sibling (simulating limit enforcement in DocumentStore)
        vi.mocked(mockStore.findPrecedingSiblingChunks).mockResolvedValue([
          universe.prev1,
        ]);
        vi.mocked(mockStore.findChunksByIds).mockResolvedValue([
          universe.target,
          universe.prev1,
        ]);

        const result = await strategy.selectChunks(
          "lib",
          "1.0.0",
          [universe.target],
          mockStore,
        );

        // Verify behavior: strategy requests limit of 1 and gets at most 1 preceding sibling
        expect(mockStore.findPrecedingSiblingChunks).toHaveBeenCalledWith(
          "lib",
          "1.0.0",
          "target",
          1,
        );
        const precedingSiblings = result.filter(
          (chunk) => chunk.id === "prev1" || chunk.id === "prev2",
        );
        expect(precedingSiblings).toHaveLength(1);
        expect(result).toContain(universe.prev1);
        expect(result).not.toContain(universe.prev2);
      });

      it("respects SUBSEQUENT_SIBLINGS_LIMIT (2)", async () => {
        // Setup: Mock store has 3 subsequent siblings available, but strategy should only request 2
        vi.mocked(mockStore.findParentChunk).mockResolvedValue(null);
        vi.mocked(mockStore.findChildChunks).mockResolvedValue([]);
        vi.mocked(mockStore.findPrecedingSiblingChunks).mockResolvedValue([]);

        // Mock returns only 2 siblings (simulating limit enforcement in DocumentStore)
        vi.mocked(mockStore.findSubsequentSiblingChunks).mockResolvedValue([
          universe.next1,
          universe.next2,
        ]);
        vi.mocked(mockStore.findChunksByIds).mockResolvedValue([
          universe.target,
          universe.next1,
          universe.next2,
        ]);

        const result = await strategy.selectChunks(
          "lib",
          "1.0.0",
          [universe.target],
          mockStore,
        );

        // Verify behavior: strategy requests limit of 2 and gets at most 2 subsequent siblings
        expect(mockStore.findSubsequentSiblingChunks).toHaveBeenCalledWith(
          "lib",
          "1.0.0",
          "target",
          2,
        );
        const subsequentSiblings = result.filter((chunk) =>
          ["next1", "next2", "next3"].includes(chunk.id as string),
        );
        expect(subsequentSiblings).toHaveLength(2);
        expect(result).toContain(universe.next1);
        expect(result).toContain(universe.next2);
        expect(result).not.toContain(universe.next3);
      });

      it("respects CHILD_LIMIT (3)", async () => {
        // Setup: Mock store has 4 children available, but strategy should only request 3
        vi.mocked(mockStore.findParentChunk).mockResolvedValue(null);
        vi.mocked(mockStore.findPrecedingSiblingChunks).mockResolvedValue([]);
        vi.mocked(mockStore.findSubsequentSiblingChunks).mockResolvedValue([]);

        // Mock returns only 3 children (simulating limit enforcement in DocumentStore)
        vi.mocked(mockStore.findChildChunks).mockResolvedValue([
          universe.child1,
          universe.child2,
          universe.child3,
        ]);
        vi.mocked(mockStore.findChunksByIds).mockResolvedValue([
          universe.target,
          universe.child1,
          universe.child2,
          universe.child3,
        ]);

        const result = await strategy.selectChunks(
          "lib",
          "1.0.0",
          [universe.target],
          mockStore,
        );

        // Verify behavior: strategy requests limit of 3 and gets at most 3 children
        expect(mockStore.findChildChunks).toHaveBeenCalledWith(
          "lib",
          "1.0.0",
          "target",
          3,
        );
        const children = result.filter((chunk) =>
          ["child1", "child2", "child3", "child4"].includes(chunk.id as string),
        );
        expect(children).toHaveLength(3);
        expect(result).toContain(universe.child1);
        expect(result).toContain(universe.child2);
        expect(result).toContain(universe.child3);
        expect(result).not.toContain(universe.child4);
      });
    });

    describe("edge cases", () => {
      it("handles empty initial chunks", async () => {
        const result = await strategy.selectChunks("lib", "1.0.0", [], mockStore);

        expect(result).toEqual([]);
        // Should not call store methods with empty array
        expect(mockStore.findParentChunk).not.toHaveBeenCalled();
      });

      it("handles chunks without IDs gracefully", async () => {
        const invalidChunk = {
          content: "No ID chunk",
          metadata: {},
        } as DbPageChunk;

        // Mock all store methods to return empty arrays for undefined IDs
        vi.mocked(mockStore.findParentChunk).mockResolvedValue(null);
        vi.mocked(mockStore.findPrecedingSiblingChunks).mockResolvedValue([]);
        vi.mocked(mockStore.findSubsequentSiblingChunks).mockResolvedValue([]);
        vi.mocked(mockStore.findChildChunks).mockResolvedValue([]);
        vi.mocked(mockStore.findChunksByIds).mockResolvedValue([]);

        // This should not throw, even though the chunk has no ID
        const result = await strategy.selectChunks(
          "lib",
          "1.0.0",
          [invalidChunk],
          mockStore,
        );

        expect(result).toEqual([]);
      });
    });
  });

  describe("integration scenarios", () => {
    it("end-to-end: full document hierarchy assembly", async () => {
      setupFullMockStore();

      // Simulate finding chunks, then assembling them
      const selectedChunks = await strategy.selectChunks(
        "lib",
        "1.0.0",
        [universe.target],
        mockStore,
      );
      const assembledContent = strategy.assembleContent(selectedChunks);

      // Should include all related content joined with \n\n
      expect(assembledContent).toContain("Target content");
      expect(assembledContent).toContain("Parent section content");
      expect(assembledContent).toContain("First child content");
      expect(assembledContent).toMatch(/\n\n/); // Should have double newline separators
    });
  });
});
