import type { Document } from "@langchain/core/documents";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DocumentStore } from "../../DocumentStore";
import { HierarchicalAssemblyStrategy } from "./HierarchicalAssemblyStrategy";

describe("HierarchicalAssemblyStrategy", () => {
  let strategy: HierarchicalAssemblyStrategy;
  let documentStore: DocumentStore;

  beforeEach(async () => {
    // Use real DocumentStore initialization but disable embeddings (pass null)
    documentStore = new DocumentStore(":memory:", null);
    await documentStore.initialize();
    strategy = new HierarchicalAssemblyStrategy();
  });

  afterEach(async () => {
    await documentStore.shutdown();
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
      const versionId = await documentStore.resolveVersionId("test-hierarchy", "1.0");

      expect(versionId).toBeGreaterThan(0);

      // Create a page first
      const pageResult = (documentStore as any).statements.insertPage.run(
        versionId,
        "Deep.ts",
        "Deep TypeScript File",
        null,
        null,
        "text/typescript",
      );
      const pageId = pageResult.lastInsertRowid;

      // Create a hierarchy: namespace > class > method
      const namespaceResult = (documentStore as any).statements.insertDocument.run(
        pageId,
        "namespace UserManagement {",
        JSON.stringify({
          url: "Deep.ts",
          path: ["UserManagement"],
          level: 0,
          types: ["structural"],
        }),
        0,
      );
      const namespaceId = namespaceResult.lastInsertRowid;

      const classResult = (documentStore as any).statements.insertDocument.run(
        pageId,
        "  export class UserService {",
        JSON.stringify({
          url: "Deep.ts",
          path: ["UserManagement", "UserService"],
          level: 1,
          types: ["structural"],
        }),
        1,
      );
      const classId = classResult.lastInsertRowid;

      const methodResult = (documentStore as any).statements.insertDocument.run(
        pageId,
        "    getUserById(id: string) { return db.find(id); }",
        JSON.stringify({
          url: "Deep.ts",
          path: ["UserManagement", "UserService", "getUserById"],
          level: 2,
          types: ["content"],
        }),
        2,
      );
      const methodId = methodResult.lastInsertRowid;

      // Input: just the deeply nested method
      const inputDoc: Document = {
        id: methodId,
        pageContent: "    getUserById(id: string) { return db.find(id); }",
        metadata: {
          url: "Deep.ts",
          path: ["UserManagement", "UserService", "getUserById"],
          level: 2,
          types: ["content"],
        },
      };

      const result = await strategy.selectChunks(
        "test-hierarchy",
        "1.0",
        [inputDoc],
        documentStore,
      );

      const resultContent = result.map((doc) => doc.pageContent);
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
      const versionId = await documentStore.resolveVersionId("test-gaps", "1.0");

      expect(versionId).toBeGreaterThan(0);

      // Create a page first
      const pageResult = (documentStore as any).statements.insertPage.run(
        versionId,
        "GapTest.ts",
        "Gap Test TypeScript File",
        null,
        null,
        "text/typescript",
      );
      const pageId = pageResult.lastInsertRowid;

      // Root namespace - exists
      const namespaceResult = (documentStore as any).statements.insertDocument.run(
        pageId,
        "namespace UserManagement {",
        JSON.stringify({
          url: "GapTest.ts",
          path: ["UserManagement"],
          level: 0,
          types: ["structural"],
        }),
        0,
      );
      const namespaceId = namespaceResult.lastInsertRowid;

      // Intermediate class - missing (gap in hierarchy)
      // No chunk with path: ["UserManagement", "UserService"]

      // Deep method with missing intermediate parent
      const methodResult = (documentStore as any).statements.insertDocument.run(
        pageId,
        "    getUserById(id: string) { return db.find(id); }",
        JSON.stringify({
          url: "GapTest.ts",
          path: ["UserManagement", "UserService", "getUserById"],
          level: 2,
          types: ["content"],
        }),
        1,
      );
      const methodId = methodResult.lastInsertRowid;

      const inputDoc: Document = {
        id: methodId,
        pageContent: "    getUserById(id: string) { return db.find(id); }",
        metadata: {
          url: "GapTest.ts",
          path: ["UserManagement", "UserService", "getUserById"],
          level: 2,
          types: ["content"],
        },
      };

      const result = await strategy.selectChunks(
        "test-gaps",
        "1.0",
        [inputDoc],
        documentStore,
      );

      const resultContent = result.map((doc) => doc.pageContent);
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
      const versionId = await documentStore.resolveVersionId("test-promotion", "1.0");

      expect(versionId).toBeGreaterThan(0);

      // Create a page first
      const pageResult = (documentStore as any).statements.insertPage.run(
        versionId,
        "applyMigrations.ts",
        "Apply Migrations TypeScript File",
        null,
        null,
        "text/typescript",
      );
      const pageId = pageResult.lastInsertRowid;

      // Create a simpler, more realistic scenario that matches how the splitter actually works
      // Function containing nested arrow function
      const topFunctionResult = (documentStore as any).statements.insertDocument.run(
        pageId,
        "export async function applyMigrations(db: Database): Promise<void> {\n  const overallTransaction = db.transaction(() => {\n    console.log('migrating');\n  });\n}",
        JSON.stringify({
          url: "applyMigrations.ts",
          path: ["applyMigrations"],
          level: 1,
          types: ["code", "content"],
        }),
        0,
      );
      const topFunctionId = topFunctionResult.lastInsertRowid;

      // Nested arrow function inside the main function
      const nestedArrowResult = (documentStore as any).statements.insertDocument.run(
        pageId,
        "    console.log('migrating');",
        JSON.stringify({
          url: "applyMigrations.ts",
          path: ["applyMigrations", "<anonymous_arrow>"],
          level: 2,
          types: ["code", "content"],
        }),
        1,
      );
      const nestedArrowId = nestedArrowResult.lastInsertRowid;

      // Input: search hit on the nested anonymous arrow function
      const inputDoc: Document = {
        id: nestedArrowId,
        pageContent: "    console.log('migrating');",
        metadata: {
          url: "applyMigrations.ts",
          path: ["applyMigrations", "<anonymous_arrow>"],
          level: 2,
          types: ["code", "content"],
        },
      };

      const result = await strategy.selectChunks(
        "test-promotion",
        "1.0",
        [inputDoc],
        documentStore,
      );

      const _resultContent = result.map((doc) => doc.pageContent);
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
      const pageResult = (documentStore as any).statements.insertPage.run(
        versionId,
        "UserService.ts",
        "User Service TypeScript File",
        null,
        null,
        "text/typescript",
      );
      const pageId = pageResult.lastInsertRowid;

      // Class with multiple methods - only some will be matched
      const _classOpenResult = (documentStore as any).statements.insertDocument.run(
        pageId,
        "class UserService {",
        JSON.stringify({
          url: "UserService.ts",
          path: ["UserService", "opening"],
          level: 1,
        }),
        0,
      );

      // Method 1: getUser (will be matched)
      const getUserResult = (documentStore as any).statements.insertDocument.run(
        pageId,
        "  getUser(id) { return db.find(id); }",
        JSON.stringify({
          url: "UserService.ts",
          path: ["UserService", "opening", "getUser"],
          level: 2,
        }),
        1,
      );
      const getUserId = getUserResult.lastInsertRowid.toString();

      // Method 2: createUser (will NOT be matched)
      (documentStore as any).statements.insertDocument.run(
        pageId,
        "  createUser(data) { return db.create(data); }",
        JSON.stringify({
          url: "UserService.ts",
          path: ["UserService", "opening", "createUser"],
          level: 2,
        }),
        2,
      );

      // Method 3: deleteUser (will be matched)
      const deleteUserResult = (documentStore as any).statements.insertDocument.run(
        pageId,
        "  deleteUser(id) { return db.delete(id); }",
        JSON.stringify({
          url: "UserService.ts",
          path: ["UserService", "opening", "deleteUser"],
          level: 2,
        }),
        3,
      );
      const deleteUserId = deleteUserResult.lastInsertRowid.toString();

      const inputDocs: Document[] = [
        {
          id: getUserId,
          pageContent: "  getUser(id) { return db.find(id); }",
          metadata: {
            url: "UserService.ts",
            path: ["UserService", "getUser"],
            level: 2,
          },
        },
        {
          id: deleteUserId,
          pageContent: "  deleteUser(id) { return db.delete(id); }",
          metadata: {
            url: "UserService.ts",
            path: ["UserService", "deleteUser"],
            level: 2,
          },
        },
      ];

      const result = await strategy.selectChunks(
        "test-multi",
        "1.0",
        inputDocs,
        documentStore,
      );

      const content = result.map((doc) => doc.pageContent);

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
      const pageAResult = (documentStore as any).statements.insertPage.run(
        versionId,
        "FileA.ts",
        "File A TypeScript File",
        null,
        null,
        "text/typescript",
      );
      const pageAId = pageAResult.lastInsertRowid;

      const pageBResult = (documentStore as any).statements.insertPage.run(
        versionId,
        "FileB.ts",
        "File B TypeScript File",
        null,
        null,
        "text/typescript",
      );
      const pageBId = pageBResult.lastInsertRowid;

      // File A
      const methodAResult = (documentStore as any).statements.insertDocument.run(
        pageAId,
        "  methodAlpha() { return 'Alpha'; }",
        JSON.stringify({
          url: "FileA.ts",
          path: ["FileA", "methodAlpha"],
          level: 2,
        }),
        0,
      );
      const methodAId = methodAResult.lastInsertRowid.toString();

      // File B
      const methodBResult = (documentStore as any).statements.insertDocument.run(
        pageBId,
        "  methodBeta() { return 'Beta'; }",
        JSON.stringify({
          url: "FileB.ts",
          path: ["FileB", "methodBeta"],
          level: 2,
        }),
        0,
      );
      const methodBId = methodBResult.lastInsertRowid.toString();

      const inputDocs: Document[] = [
        {
          id: methodAId,
          pageContent: "  methodAlpha() { return 'Alpha'; }",
          metadata: {
            url: "FileA.ts",
            path: ["FileA", "methodAlpha"],
            level: 2,
          },
        },
        {
          id: methodBId,
          pageContent: "  methodBeta() { return 'Beta'; }",
          metadata: {
            url: "FileB.ts",
            path: ["FileB", "methodBeta"],
            level: 2,
          },
        },
      ];

      const result = await strategy.selectChunks(
        "test-cross-doc",
        "1.0",
        inputDocs,
        documentStore,
      );

      const content = result.map((d) => d.pageContent);
      expect(content).toContain("  methodAlpha() { return 'Alpha'; }");
      expect(content).toContain("  methodBeta() { return 'Beta'; }");
    });
  });

  describe("assembleContent", () => {
    it("should concatenate chunks in document order", () => {
      const chunks: Document[] = [
        {
          id: "1",
          pageContent: "class UserService {",
          metadata: {},
        },
        {
          id: "2",
          pageContent: "  getUser() { return 'user'; }",
          metadata: {},
        },
        {
          id: "3",
          pageContent: "}",
          metadata: {},
        },
      ];

      const result = strategy.assembleContent(chunks);
      expect(result).toBe("class UserService {  getUser() { return 'user'; }}");
    });

    it("should handle empty array gracefully", () => {
      const result = strategy.assembleContent([]);
      expect(result).toBe("");
    });

    it("should provide debug output when requested", () => {
      const chunks: Document[] = [
        {
          id: "1",
          pageContent: "function test() {",
          metadata: { path: ["test"], level: 0 },
        },
        {
          id: "2",
          pageContent: "  return 42;",
          metadata: { path: ["test", "return"], level: 1 },
        },
      ];

      const result = strategy.assembleContent(chunks, true);
      expect(result).toContain("=== #1");
      expect(result).toContain("=== #2");
      expect(result).toContain("function test() {");
      expect(result).toContain("  return 42;");
    });
  });
});
