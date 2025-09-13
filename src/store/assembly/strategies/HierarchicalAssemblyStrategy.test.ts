import { Document } from "@langchain/core/documents";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentStore } from "../../DocumentStore";
import { HierarchicalAssemblyStrategy } from "./HierarchicalAssemblyStrategy";

vi.mock("../../../utils/logger");

// Simplified mock that focuses on data relationships, not method calls
const createMockDocumentStore = (hierarchyMap: Map<string, string | null>) =>
  ({
    findParentChunk: vi.fn().mockImplementation(async (_lib, _ver, id) => {
      const parentId = hierarchyMap.get(id);
      if (!parentId) return null;

      // Find the parent document from our test fixtures
      const parentDoc = Object.values(testFixtures).find((doc) => doc.id === parentId);
      return parentDoc || null;
    }),
    findChildChunks: vi.fn().mockResolvedValue([]),
    findChunksByIds: vi.fn().mockImplementation(async (_lib, _ver, ids) => {
      return Object.values(testFixtures).filter((doc) => ids.includes(doc.id as string));
    }),
  }) as Partial<DocumentStore> as DocumentStore;

// Global test fixtures for reuse across tests
const testFixtures = {
  // TypeScript class hierarchy
  tsModule: new Document({
    id: "ts-module",
    pageContent: "export namespace Utils {",
    metadata: { mimeType: "text/x-typescript" },
  }),
  tsClass: new Document({
    id: "ts-class",
    pageContent: "  export class StringHelper {",
    metadata: { mimeType: "text/x-typescript" },
  }),
  tsMethod: new Document({
    id: "ts-method",
    pageContent: "    public static format(text: string): string {",
    metadata: { mimeType: "text/x-typescript" },
  }),
  tsMethodBody: new Document({
    id: "ts-method-body",
    pageContent: "      return text.trim().toLowerCase();",
    metadata: { mimeType: "text/x-typescript" },
  }),

  // JSON configuration hierarchy
  jsonRoot: new Document({
    id: "json-root",
    pageContent: '{"app": {',
    metadata: { mimeType: "application/json" },
  }),
  jsonConfig: new Document({
    id: "json-config",
    pageContent: '  "database": {',
    metadata: { mimeType: "application/json" },
  }),
  jsonSetting: new Document({
    id: "json-setting",
    pageContent: '    "connectionTimeout": 30000',
    metadata: { mimeType: "application/json" },
  }),

  // Standalone chunks
  orphanFunction: new Document({
    id: "orphan-function",
    pageContent: "function standalone() { return true; }",
    metadata: { mimeType: "text/javascript" },
  }),
};

describe("HierarchicalAssemblyStrategy", () => {
  let strategy: HierarchicalAssemblyStrategy;
  let mockStore: DocumentStore;

  beforeEach(() => {
    strategy = new HierarchicalAssemblyStrategy();
  });

  describe("canHandle", () => {
    it("handles source code content types", () => {
      expect(strategy.canHandle("text/x-typescript")).toBe(true);
      expect(strategy.canHandle("text/javascript")).toBe(true);
      expect(strategy.canHandle("text/x-python")).toBe(true);
      expect(strategy.canHandle("text/x-java")).toBe(true);
      expect(strategy.canHandle("text/x-csharp")).toBe(true);
    });

    it("handles JSON content types", () => {
      expect(strategy.canHandle("application/json")).toBe(true);
      expect(strategy.canHandle("text/json")).toBe(true);
      expect(strategy.canHandle("text/x-json")).toBe(true);
    });

    it("rejects markdown/text content", () => {
      expect(strategy.canHandle("text/markdown")).toBe(false);
      expect(strategy.canHandle("text/x-markdown")).toBe(false);
      expect(strategy.canHandle("text/html")).toBe(false);
      expect(strategy.canHandle("text/plain")).toBe(false);
    });

    it("rejects unknown types", () => {
      expect(strategy.canHandle(undefined as any)).toBe(false);
      expect(strategy.canHandle("application/unknown")).toBe(false);
      expect(strategy.canHandle("")).toBe(false);
    });
  });

  describe("assembleContent", () => {
    it("concatenates chunks without any separators", () => {
      const chunks = [testFixtures.tsModule, testFixtures.tsClass, testFixtures.tsMethod];

      const result = strategy.assembleContent(chunks);

      expect(result).toBe(
        "export namespace Utils {  export class StringHelper {    public static format(text: string): string {",
      );
      // Verify no separators are inserted
      expect(result).not.toContain("\n");
      expect(result).not.toContain(" \n");
      expect(result).not.toContain("\n ");
    });

    it("handles empty chunk array", () => {
      const result = strategy.assembleContent([]);
      expect(result).toBe("");
    });

    it("handles single chunk", () => {
      const result = strategy.assembleContent([testFixtures.tsMethodBody]);
      expect(result).toBe("      return text.trim().toLowerCase();");
    });

    it("preserves chunk order", () => {
      const chunks = [
        testFixtures.tsMethod,
        testFixtures.tsMethodBody,
        testFixtures.tsClass,
      ];
      const result = strategy.assembleContent(chunks);
      expect(result).toBe(
        "    public static format(text: string): string {      return text.trim().toLowerCase();  export class StringHelper {",
      );
    });
  });

  describe("selectChunks", () => {
    describe("single chunk scenarios", () => {
      it("orphan chunk with no parent", async () => {
        const hierarchyMap = new Map([["orphan-function", null]]);
        mockStore = createMockDocumentStore(hierarchyMap);

        const result = await strategy.selectChunks(
          "lib",
          "1.0.0",
          [testFixtures.orphanFunction],
          mockStore,
        );

        expect(result).toEqual([testFixtures.orphanFunction]);
      });

      it("chunk with single parent", async () => {
        const hierarchyMap = new Map([
          ["ts-class", "ts-module"],
          ["ts-module", null],
        ]);
        mockStore = createMockDocumentStore(hierarchyMap);

        const result = await strategy.selectChunks(
          "lib",
          "1.0.0",
          [testFixtures.tsClass],
          mockStore,
        );

        expect(result).toHaveLength(2);
        expect(result).toContain(testFixtures.tsClass);
        expect(result).toContain(testFixtures.tsModule);
      });

      it("deep hierarchy chain", async () => {
        const hierarchyMap = new Map([
          ["ts-method-body", "ts-method"],
          ["ts-method", "ts-class"],
          ["ts-class", "ts-module"],
          ["ts-module", null],
        ]);
        mockStore = createMockDocumentStore(hierarchyMap);

        const result = await strategy.selectChunks(
          "lib",
          "1.0.0",
          [testFixtures.tsMethodBody],
          mockStore,
        );

        expect(result).toHaveLength(4);
        expect(result).toContain(testFixtures.tsMethodBody);
        expect(result).toContain(testFixtures.tsMethod);
        expect(result).toContain(testFixtures.tsClass);
        expect(result).toContain(testFixtures.tsModule);
      });
    });

    describe("multiple chunks scenarios", () => {
      it("separate hierarchies", async () => {
        const hierarchyMap = new Map([
          ["ts-class", "ts-module"],
          ["ts-module", null],
          ["json-config", "json-root"],
          ["json-root", null],
        ]);
        mockStore = createMockDocumentStore(hierarchyMap);

        const result = await strategy.selectChunks(
          "lib",
          "1.0.0",
          [testFixtures.tsClass, testFixtures.jsonConfig],
          mockStore,
        );

        expect(result).toHaveLength(4);
        expect(result).toContain(testFixtures.tsClass);
        expect(result).toContain(testFixtures.tsModule);
        expect(result).toContain(testFixtures.jsonConfig);
        expect(result).toContain(testFixtures.jsonRoot);
      });

      it("overlapping hierarchies deduplication", async () => {
        const hierarchyMap = new Map([
          ["ts-method", "ts-class"],
          ["ts-class", "ts-module"],
          ["ts-module", null],
        ]);
        mockStore = createMockDocumentStore(hierarchyMap);

        const result = await strategy.selectChunks(
          "lib",
          "1.0.0",
          [testFixtures.tsMethod, testFixtures.tsClass], // tsClass is parent of tsMethod
          mockStore,
        );

        expect(result).toHaveLength(3);
        expect(result).toContain(testFixtures.tsMethod);
        expect(result).toContain(testFixtures.tsClass);
        expect(result).toContain(testFixtures.tsModule);
      });
    });

    describe("error scenarios", () => {
      it("handles missing parent gracefully", async () => {
        const hierarchyMap = new Map();
        mockStore = createMockDocumentStore(hierarchyMap);

        const result = await strategy.selectChunks(
          "lib",
          "1.0.0",
          [testFixtures.tsClass],
          mockStore,
        );

        expect(result).toEqual([testFixtures.tsClass]);
      });

      it("handles DocumentStore errors with fallback", async () => {
        const hierarchyMap = new Map([["ts-class", "ts-module"]]);
        mockStore = createMockDocumentStore(hierarchyMap);

        // Make findChunksByIds fail to trigger fallback
        vi.mocked(mockStore.findChunksByIds)
          .mockRejectedValueOnce(new Error("Database error"))
          .mockResolvedValueOnce([testFixtures.tsClass]);

        const result = await strategy.selectChunks(
          "lib",
          "1.0.0",
          [testFixtures.tsClass],
          mockStore,
        );

        expect(result).toContain(testFixtures.tsClass);
      });

      it("handles circular references", async () => {
        const hierarchyMap = new Map([
          ["ts-class", "ts-module"],
          ["ts-module", "ts-class"], // Circular reference
        ]);
        mockStore = createMockDocumentStore(hierarchyMap);

        const result = await strategy.selectChunks(
          "lib",
          "1.0.0",
          [testFixtures.tsClass],
          mockStore,
        );

        expect(result).toHaveLength(2);
        expect(result).toContain(testFixtures.tsClass);
        expect(result).toContain(testFixtures.tsModule);
      });

      it("handles chunks without IDs", async () => {
        const invalidChunk = new Document({
          pageContent: "No ID chunk",
          metadata: { mimeType: "text/x-typescript" },
        });

        const hierarchyMap = new Map();
        mockStore = createMockDocumentStore(hierarchyMap);

        const result = await strategy.selectChunks(
          "lib",
          "1.0.0",
          [invalidChunk],
          mockStore,
        );

        expect(result).toEqual([]);
      });

      it("handles empty initial chunks", async () => {
        const hierarchyMap = new Map();
        mockStore = createMockDocumentStore(hierarchyMap);

        const result = await strategy.selectChunks("lib", "1.0.0", [], mockStore);

        expect(result).toEqual([]);
      });
    });
  });

  describe("realistic integration scenarios", () => {
    it("TypeScript class method hierarchy", async () => {
      const hierarchyMap = new Map([
        ["ts-method-body", "ts-method"],
        ["ts-method", "ts-class"],
        ["ts-class", "ts-module"],
        ["ts-module", null],
      ]);
      mockStore = createMockDocumentStore(hierarchyMap);

      const selectedChunks = await strategy.selectChunks(
        "lib",
        "1.0.0",
        [testFixtures.tsMethodBody],
        mockStore,
      );
      const assembledContent = strategy.assembleContent(selectedChunks);

      expect(assembledContent).toContain("export namespace Utils");
      expect(assembledContent).toContain("export class StringHelper");
      expect(assembledContent).toContain("public static format");
      expect(assembledContent).toContain("return text.trim().toLowerCase()");

      // Verify it's proper concatenated code without separators
      expect(assembledContent).not.toContain("\n\n");
      expect(assembledContent).not.toContain(" , ");
    });

    it("JSON configuration hierarchy", async () => {
      const hierarchyMap = new Map([
        ["json-setting", "json-config"],
        ["json-config", "json-root"],
        ["json-root", null],
      ]);
      mockStore = createMockDocumentStore(hierarchyMap);

      const selectedChunks = await strategy.selectChunks(
        "lib",
        "1.0.0",
        [testFixtures.jsonSetting],
        mockStore,
      );
      const assembledContent = strategy.assembleContent(selectedChunks);

      expect(assembledContent).toContain('{"app": {');
      expect(assembledContent).toContain('"database": {');
      expect(assembledContent).toContain('"connectionTimeout": 30000');

      // Verify proper JSON structure without separators
      expect(assembledContent).not.toContain("\n\n");
    });

    it("mixed content types", async () => {
      const hierarchyMap = new Map([
        ["ts-class", "ts-module"],
        ["ts-module", null],
        ["json-config", "json-root"],
        ["json-root", null],
        ["orphan-function", null],
      ]);
      mockStore = createMockDocumentStore(hierarchyMap);

      const selectedChunks = await strategy.selectChunks(
        "lib",
        "1.0.0",
        [testFixtures.tsClass, testFixtures.jsonConfig, testFixtures.orphanFunction],
        mockStore,
      );

      expect(selectedChunks).toHaveLength(5);

      // TypeScript hierarchy
      expect(selectedChunks).toContain(testFixtures.tsClass);
      expect(selectedChunks).toContain(testFixtures.tsModule);

      // JSON hierarchy
      expect(selectedChunks).toContain(testFixtures.jsonConfig);
      expect(selectedChunks).toContain(testFixtures.jsonRoot);

      // Standalone
      expect(selectedChunks).toContain(testFixtures.orphanFunction);
    });
  });
});
