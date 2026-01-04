import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type AppConfig, loadConfig } from "../../../utils/config";
import { DocumentStore } from "../../DocumentStore";
import type { DbChunkMetadata, DbPageChunk } from "../../types";
import { HierarchicalAssemblyStrategy } from "./HierarchicalAssemblyStrategy";

describe("HierarchicalAssemblyStrategy", () => {
  let strategy: HierarchicalAssemblyStrategy;
  let documentStore: DocumentStore;
  let appConfig: AppConfig;

  beforeEach(async () => {
    appConfig = loadConfig();

    // Disable embeddings for this strategy test
    appConfig.app.embeddingModel = "";

    // Use real DocumentStore initialization but disable embeddings (pass null)
    documentStore = new DocumentStore(":memory:", appConfig);
    await documentStore.initialize();
    strategy = new HierarchicalAssemblyStrategy(appConfig);
  });

  afterEach(async () => {
    if (documentStore) {
      await documentStore.shutdown();
    }
  });

  describe("canHandle", () => {
    it("should handle source code MIME types", () => {
      expect(strategy.canHandle("text/javascript")).toBe(true);
      expect(strategy.canHandle("text/typescript")).toBe(true);
      expect(strategy.canHandle("text/x-typescript")).toBe(true);
      expect(strategy.canHandle("text/x-python")).toBe(true);
    });

    it("should handle JSON MIME types", () => {
      expect(strategy.canHandle("application/json")).toBe(true);
      expect(strategy.canHandle("text/json")).toBe(true);
      expect(strategy.canHandle("text/x-json")).toBe(true);
    });

    it("should not handle other MIME types", () => {
      expect(strategy.canHandle("text/html")).toBe(false);
      expect(strategy.canHandle("text/markdown")).toBe(false);
      expect(strategy.canHandle("text/plain")).toBe(false);
    });
  });

  describe("selectChunks", () => {
    it("should return empty array for empty input", async () => {
      const result = await strategy.selectChunks("test", "1.0", [], documentStore);
      expect(result).toEqual([]);
    });

    it("should reconstruct complete hierarchy for single match", async () => {
      // Use the public API to add documents
      await documentStore.addDocuments("test-hierarchy", "1.0", 0, {
        url: "Deep.ts",
        title: "Deep TypeScript File",
        contentType: "text/typescript",
        textContent: "",
        chunks: [
          {
            content: "namespace UserManagement {",
            section: {
              path: ["UserManagement"],
              level: 0,
            },
            types: ["structural"],
          },
          {
            content: "  export class UserService {",
            section: {
              path: ["UserManagement", "UserService"],
              level: 1,
            },
            types: ["structural"],
          },
          {
            content: "    getUserById(id: string) { return db.find(id); }",
            section: {
              path: ["UserManagement", "UserService", "getUserById"],
              level: 2,
            },
            types: ["text"],
          },
        ],
        links: [],
        errors: [],
      });

      // Query the database to get the actual document IDs
      const allChunks = await documentStore.findChunksByUrl(
        "test-hierarchy",
        "1.0",
        "Deep.ts",
      );
      expect(allChunks.length).toBe(3);

      const namespaceId = allChunks[0].id;
      const classId = allChunks[1].id;
      const methodId = allChunks[2].id;

      // Input: just the deeply nested method
      const inputDoc = allChunks[2];

      const result = await strategy.selectChunks(
        "test-hierarchy",
        "1.0",
        [inputDoc],
        documentStore,
      );

      const resultContent = result.map((doc) => doc.content);
      const resultIds = result.map((doc) => doc.id);

      // Should include the complete hierarchy: method + class + namespace
      expect(resultContent).toContain(
        "    getUserById(id: string) { return db.find(id); }",
      );
      expect(resultContent).toContain("  export class UserService {");
      expect(resultContent).toContain("namespace UserManagement {");

      expect(resultIds).toContain(methodId);
      expect(resultIds).toContain(classId);
      expect(resultIds).toContain(namespaceId);

      expect(result.length).toBeGreaterThanOrEqual(3);
    });

    it("should handle hierarchical gaps in parent chain", async () => {
      // Use the public API to add documents with a gap in the hierarchy
      await documentStore.addDocuments("test-gaps", "1.0", 0, {
        url: "GapTest.ts",
        title: "Gap Test TypeScript File",
        contentType: "text/typescript",
        textContent: "",
        chunks: [
          {
            content: "namespace UserManagement {",
            section: {
              path: ["UserManagement"],
              level: 0,
            },
            types: ["structural"],
          },
          // Intermediate class is missing (gap in hierarchy)
          // No chunk with path: ["UserManagement", "UserService"]
          {
            content: "    getUserById(id: string) { return db.find(id); }",
            section: {
              path: ["UserManagement", "UserService", "getUserById"],
              level: 2,
            },
            types: ["text"],
          },
        ],
        links: [],
        errors: [],
      });

      // Query the database to get the actual document IDs
      const allChunks = await documentStore.findChunksByUrl(
        "test-gaps",
        "1.0",
        "GapTest.ts",
      );
      expect(allChunks.length).toBe(2);

      const namespaceId = allChunks[0].id;
      const methodId = allChunks[1].id;

      // Input: just the deeply nested method (with missing intermediate parent)
      const inputDoc = allChunks[1];

      const result = await strategy.selectChunks(
        "test-gaps",
        "1.0",
        [inputDoc],
        documentStore,
      );

      const resultContent = result.map((doc) => doc.content);
      const resultIds = result.map((doc) => doc.id);

      // Should include the matched method and find the root namespace despite the gap
      expect(resultContent).toContain(
        "    getUserById(id: string) { return db.find(id); }",
      );
      expect(resultContent).toContain("namespace UserManagement {");
      expect(resultIds).toContain(methodId);
      expect(resultIds).toContain(namespaceId);
      expect(result.length).toBeGreaterThanOrEqual(2);
    });

    it("should promote deeply nested anonymous functions to their top-level container", async () => {
      // Use the public API to add documents with nested anonymous function
      await documentStore.addDocuments("test-promotion", "1.0", 0, {
        url: "applyMigrations.ts",
        title: "Apply Migrations TypeScript File",
        contentType: "text/typescript",
        textContent: "",
        chunks: [
          {
            content:
              "export async function applyMigrations(db: Database): Promise<void> {\n  const overallTransaction = db.transaction(() => {\n    console.log('migrating');\n  });\n}",
            section: {
              path: ["applyMigrations"],
              level: 1,
            },
            types: ["code"],
          },
          {
            content: "    console.log('migrating');",
            section: {
              path: ["applyMigrations", "<anonymous_arrow>"],
              level: 2,
            },
            types: ["code"],
          },
        ],
        links: [],
        errors: [],
      });

      // Query the database to get the actual document IDs
      const allChunks = await documentStore.findChunksByUrl(
        "test-promotion",
        "1.0",
        "applyMigrations.ts",
      );
      expect(allChunks.length).toBe(2);

      const topFunctionId = allChunks[0].id;
      const nestedArrowId = allChunks[1].id;

      // Input: search hit on the nested anonymous arrow function
      const inputDoc = allChunks[1];

      const result = await strategy.selectChunks(
        "test-promotion",
        "1.0",
        [inputDoc],
        documentStore,
      );

      const _resultContent = result.map((doc) => doc.content);
      const resultIds = result.map((doc) => doc.id);

      // Should promote to include the entire top-level function that contains the anonymous function
      expect(resultIds).toContain(topFunctionId);
      expect(resultIds).toContain(nestedArrowId);

      const assembled = strategy.assembleContent(result);
      expect(assembled).toMatch(/applyMigrations/);
      expect(assembled).toMatch(/migrating/);
    });

    it("should handle multiple matches with selective subtree reassembly", async () => {
      const versionId = await documentStore.resolveVersionId("test-multi", "1.0");

      expect(versionId).toBeGreaterThan(0);

      // Create a page first
      // @ts-expect-error Accessing private property for testing
      const pageResult = documentStore.statements.insertPage.run(
        versionId,
        "UserService.ts",
        "User Service TypeScript File",
        null,
        null,
        "text/typescript",
        0, // depth
      );
      const pageId = pageResult.lastInsertRowid as number;

      // Class with multiple methods - only some will be matched
      // @ts-expect-error Accessing private property for testing
      const _classOpenResult = documentStore.statements.insertDocument.run(
        pageId,
        "class UserService {",
        JSON.stringify({
          path: ["UserService", "opening"],
          level: 1,
        } satisfies DbChunkMetadata),
        0,
      );

      // Method 1: getUser (will be matched)
      // @ts-expect-error Accessing private property for testing
      const getUserResult = documentStore.statements.insertDocument.run(
        pageId,
        "  getUser(id) { return db.find(id); }",
        JSON.stringify({
          path: ["UserService", "opening", "getUser"],
          level: 2,
        } satisfies DbChunkMetadata),
        1,
      );
      const getUserId = getUserResult.lastInsertRowid.toString();

      // Method 2: createUser (will NOT be matched)
      // @ts-expect-error Accessing private property for testing
      documentStore.statements.insertDocument.run(
        pageId,
        "  createUser(data) { return db.create(data); }",
        JSON.stringify({
          path: ["UserService", "opening", "createUser"],
          level: 2,
        } satisfies DbChunkMetadata),
        2,
      );

      // Method 3: deleteUser (will be matched)
      // @ts-expect-error Accessing private property for testing
      const deleteUserResult = documentStore.statements.insertDocument.run(
        pageId,
        "  deleteUser(id) { return db.delete(id); }",
        JSON.stringify({
          path: ["UserService", "opening", "deleteUser"],
          level: 2,
        } satisfies DbChunkMetadata),
        3,
      );
      const deleteUserId = deleteUserResult.lastInsertRowid.toString();

      const inputDocs: DbPageChunk[] = [
        {
          id: getUserId,
          page_id: pageId,
          url: "UserService.ts",
          title: "User Service TypeScript File",
          content_type: "text/typescript",
          content: "  getUser(id) { return db.find(id); }",
          metadata: {
            path: ["UserService", "getUser"],
            level: 2,
          },
          sort_order: 1,
          embedding: null,
          created_at: new Date().toISOString(),
          score: null,
        },
        {
          id: deleteUserId,
          page_id: pageId,
          url: "UserService.ts",
          title: "User Service TypeScript File",
          content_type: "text/typescript",
          content: "  deleteUser(id) { return db.delete(id); }",
          metadata: {
            path: ["UserService", "deleteUser"],
            level: 2,
          },
          sort_order: 3,
          embedding: null,
          created_at: new Date().toISOString(),
          score: null,
        },
      ];

      const result = await strategy.selectChunks(
        "test-multi",
        "1.0",
        inputDocs as DbPageChunk[],
        documentStore,
      );

      const content = result.map((doc) => doc.content);

      // Should include both matched methods
      expect(content).toContain("  getUser(id) { return db.find(id); }");
      expect(content).toContain("  deleteUser(id) { return db.delete(id); }");

      // Should NOT include the unmatched createUser method
      expect(content.some((c) => c.includes("createUser"))).toBe(false);
    });

    it("should handle multiple matches across different documents", async () => {
      const versionId = await documentStore.resolveVersionId("test-cross-doc", "1.0");

      expect(versionId).toBeGreaterThan(0);

      // Create pages first
      // @ts-expect-error Accessing private property for testing
      const pageAResult = documentStore.statements.insertPage.run(
        versionId,
        "FileA.ts",
        "File A TypeScript File",
        null,
        null,
        "text/typescript",
        0, // depth
      );
      const pageAId = pageAResult.lastInsertRowid as number;

      // @ts-expect-error Accessing private property for testing
      const pageBResult = documentStore.statements.insertPage.run(
        versionId,
        "FileB.ts",
        "File B TypeScript File",
        null,
        null,
        "text/typescript",
        0, // depth
      );
      const pageBId = pageBResult.lastInsertRowid as number;

      // File A
      // @ts-expect-error Accessing private property for testing
      const methodAResult = documentStore.statements.insertDocument.run(
        pageAId,
        "  methodAlpha() { return 'Alpha'; }",
        JSON.stringify({
          path: ["FileA", "methodAlpha"],
          level: 2,
        } satisfies DbChunkMetadata),
        0,
      );
      const methodAId = methodAResult.lastInsertRowid.toString();

      // File B
      // @ts-expect-error Accessing private property for testing
      const methodBResult = documentStore.statements.insertDocument.run(
        pageBId,
        "  methodBeta() { return 'Beta'; }",
        JSON.stringify({
          path: ["FileB", "methodBeta"],
          level: 2,
        } satisfies DbChunkMetadata),
        0,
      );
      const methodBId = methodBResult.lastInsertRowid.toString();

      const inputDocs: DbPageChunk[] = [
        {
          id: methodAId,
          page_id: pageAId,
          url: "FileA.ts",
          title: "File A TypeScript File",
          content_type: "text/typescript",
          content: "  methodAlpha() { return 'Alpha'; }",
          metadata: {
            path: ["FileA", "methodAlpha"],
            level: 2,
          },
          sort_order: 0,
          embedding: null,
          created_at: new Date().toISOString(),
          score: null,
        },
        {
          id: methodBId,
          page_id: pageBId,
          url: "FileB.ts",
          title: "File B TypeScript File",
          content_type: "text/typescript",
          content: "  methodBeta() { return 'Beta'; }",
          metadata: {
            path: ["FileB", "methodBeta"],
            level: 2,
          },
          sort_order: 0,
          embedding: null,
          created_at: new Date().toISOString(),
          score: null,
        },
      ];

      const result = await strategy.selectChunks(
        "test-cross-doc",
        "1.0",
        inputDocs,
        documentStore,
      );

      const content = result.map((d) => d.content);
      expect(content).toContain("  methodAlpha() { return 'Alpha'; }");
      expect(content).toContain("  methodBeta() { return 'Beta'; }");
    });
  });

  describe("assembleContent", () => {
    it("should concatenate chunks in document order", () => {
      const chunks: DbPageChunk[] = [
        {
          id: "1",
          content: "class UserService {",
          metadata: {},
        } as DbPageChunk,
        {
          id: "2",
          content: "  getUser() { return 'user'; }",
          metadata: {},
        } as DbPageChunk,
        {
          id: "3",
          content: "}",
          metadata: {},
        } as DbPageChunk,
      ];

      const result = strategy.assembleContent(chunks);
      expect(result).toBe("class UserService {  getUser() { return 'user'; }}");
    });

    it("should handle empty array gracefully", () => {
      const result = strategy.assembleContent([]);
      expect(result).toBe("");
    });

    it("should provide debug output when requested", () => {
      const chunks: DbPageChunk[] = [
        {
          id: "1",
          content: "function test() {",
          metadata: { path: ["test"], level: 0 },
        } as DbPageChunk,
        {
          id: "2",
          content: "  return 42;",
          metadata: { path: ["test", "return"], level: 1 },
        } as DbPageChunk,
      ];

      const result = strategy.assembleContent(chunks, true);
      expect(result).toContain("=== #1");
      expect(result).toContain("=== #2");
      expect(result).toContain("function test() {");
      expect(result).toContain("  return 42;");
    });
  });
});
