import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JsonDocumentSplitter } from "../../../splitter/JsonDocumentSplitter";
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
        sourceContentType: "text/typescript",
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

    it("returns the enclosing class with all its methods for a hit inside one method", async () => {
      // Chunks as the TypeScript splitter emits them for a class and a function
      await documentStore.addDocuments("test-class-subtree", "1.0", 0, {
        url: "UserService.ts",
        title: "UserService.ts",
        sourceContentType: "text/typescript",
        contentType: "text/typescript",
        textContent: "",
        chunks: [
          {
            content: "export class UserService {\n",
            section: { path: ["UserService"], level: 1 },
            types: ["code", "structural"],
          },
          {
            content: "  getUser(id: string) {\n    return db.find(id);\n  }\n",
            section: { path: ["UserService", "getUser"], level: 2 },
            types: ["code"],
          },
          {
            content: "  deleteUser(id: string) {\n    return db.delete(id);\n  }\n",
            section: { path: ["UserService", "deleteUser"], level: 2 },
            types: ["code"],
          },
          {
            content: "}\n",
            section: { path: ["UserService"], level: 1 },
            types: ["code"],
          },
          {
            content: "export function helper() {\n  return 1;\n}\n",
            section: { path: ["helper"], level: 1 },
            types: ["code"],
          },
        ],
        links: [],
        errors: [],
      });
      const chunks = await documentStore.findChunksByUrl(
        "test-class-subtree",
        "1.0",
        "UserService.ts",
      );
      const deleteUser = chunks[2];

      const result = await strategy.selectChunks(
        "test-class-subtree",
        "1.0",
        [deleteUser],
        documentStore,
      );

      expect(strategy.assembleContent(result)).toBe(
        "export class UserService {\n" +
          "  getUser(id: string) {\n    return db.find(id);\n  }\n" +
          "  deleteUser(id: string) {\n    return db.delete(id);\n  }\n" +
          "}\n",
      );
    });

    describe("a class inside a namespace", () => {
      /** Stores the chunks the TypeScript splitter emits for a class inside a namespace. */
      async function storeNamespace(): Promise<DbPageChunk[]> {
        await documentStore.addDocuments("test-nested-scopes", "1.0", 0, {
          url: "Accounts.ts",
          title: "Accounts.ts",
          sourceContentType: "text/typescript",
          contentType: "text/typescript",
          textContent: "",
          chunks: [
            {
              content: "export namespace Accounts {\n",
              section: { path: ["Accounts"], level: 1 },
              types: ["code", "structural"],
            },
            {
              content: "  export class UserService {\n",
              section: { path: ["Accounts", "UserService"], level: 2 },
              types: ["code", "structural"],
            },
            {
              content: "    getUser(id: string) {\n      return id;\n    }\n",
              section: { path: ["Accounts", "UserService", "getUser"], level: 3 },
              types: ["code"],
            },
            {
              content: "  }\n",
              section: { path: ["Accounts", "UserService"], level: 2 },
              types: ["code"],
            },
            {
              content: "  export const limit = 5;\n",
              section: { path: ["Accounts", "limit"], level: 2 },
              types: ["code"],
            },
            {
              content: "}\n",
              section: { path: ["Accounts"], level: 1 },
              types: ["code"],
            },
            {
              content: "const after = 1;\n",
              section: { path: ["after"], level: 1 },
              types: ["code"],
            },
          ],
          links: [],
          errors: [],
        });
        return documentStore.findChunksByUrl("test-nested-scopes", "1.0", "Accounts.ts");
      }

      const classInNamespace =
        "export namespace Accounts {\n" +
        "  export class UserService {\n" +
        "    getUser(id: string) {\n      return id;\n    }\n" +
        "  }\n" +
        "}\n";

      it("closes every enclosing scope without adding its other members", async () => {
        const chunks = await storeNamespace();

        const result = await strategy.selectChunks(
          "test-nested-scopes",
          "1.0",
          [chunks[2]],
          documentStore,
        );

        expect(strategy.assembleContent(result)).toBe(classInNamespace);
      });

      it("returns only the class for a match on its declaration", async () => {
        const chunks = await storeNamespace();

        const result = await strategy.selectChunks(
          "test-nested-scopes",
          "1.0",
          [chunks[1]],
          documentStore,
        );

        expect(strategy.assembleContent(result)).toBe(classInNamespace);
      });
    });

    it("opens an enclosing scope at its declaration, skipping the members before the match", async () => {
      // Chunks as the TypeScript splitter emits them for a namespace with a statement between two classes
      await documentStore.addDocuments("test-scope-opening", "1.0", 0, {
        url: "Accounts.ts",
        title: "Accounts.ts",
        sourceContentType: "text/typescript",
        contentType: "text/typescript",
        textContent: "",
        chunks: [
          {
            content: "export namespace Accounts {\n",
            section: { path: ["Accounts"], level: 1 },
            types: ["code", "structural"],
          },
          {
            content: "  export class First {\n",
            section: { path: ["Accounts", "First"], level: 2 },
            types: ["code", "structural"],
          },
          {
            content: "    a() { return 1; }\n",
            section: { path: ["Accounts", "First", "a"], level: 3 },
            types: ["code"],
          },
          {
            content: "  }\n",
            section: { path: ["Accounts", "First"], level: 2 },
            types: ["code"],
          },
          {
            content: '  console.log("between");\n',
            section: { path: ["Accounts"], level: 1 },
            types: ["code"],
          },
          {
            content: "  export class Second {\n",
            section: { path: ["Accounts", "Second"], level: 2 },
            types: ["code", "structural"],
          },
          {
            content: "    b() { return 2; }\n",
            section: { path: ["Accounts", "Second", "b"], level: 3 },
            types: ["code"],
          },
          {
            content: "  }\n",
            section: { path: ["Accounts", "Second"], level: 2 },
            types: ["code"],
          },
          {
            content: "}\n",
            section: { path: ["Accounts"], level: 1 },
            types: ["code"],
          },
        ],
        links: [],
        errors: [],
      });
      const chunks = await documentStore.findChunksByUrl(
        "test-scope-opening",
        "1.0",
        "Accounts.ts",
      );

      const result = await strategy.selectChunks(
        "test-scope-opening",
        "1.0",
        [chunks[6]],
        documentStore,
      );

      expect(strategy.assembleContent(result)).toBe(
        "export namespace Accounts {\n" +
          "  export class Second {\n" +
          "    b() { return 2; }\n" +
          "  }\n" +
          "}\n",
      );
    });

    it("returns only the matched chunk for a hit in global code", async () => {
      // Chunks as the TypeScript splitter emits them for global code before a class
      await documentStore.addDocuments("test-global-code", "1.0", 0, {
        url: "main.ts",
        title: "main.ts",
        sourceContentType: "text/typescript",
        contentType: "text/typescript",
        textContent: "",
        chunks: [
          {
            content: "console.log(start);\n",
            section: { path: [], level: 0 },
            types: ["code"],
          },
          {
            content: "export class Worker {\n",
            section: { path: ["Worker"], level: 1 },
            types: ["code", "structural"],
          },
          {
            content: "  run() {}\n",
            section: { path: ["Worker", "run"], level: 2 },
            types: ["code"],
          },
          {
            content: "}\n",
            section: { path: ["Worker"], level: 1 },
            types: ["code"],
          },
        ],
        links: [],
        errors: [],
      });
      const chunks = await documentStore.findChunksByUrl(
        "test-global-code",
        "1.0",
        "main.ts",
      );

      const result = await strategy.selectChunks(
        "test-global-code",
        "1.0",
        [chunks[0]],
        documentStore,
      );

      expect(strategy.assembleContent(result)).toBe("console.log(start);\n");
    });

    describe("JSON matches", () => {
      const config = {
        name: "demo",
        server: { host: "localhost", timeout: 30 },
        users: [{ name: "Alice" }],
      };

      /** Stores a document as the JSON splitter chunks it and returns the chunk holding `text`. */
      async function storeConfigAndFind(
        text: string,
        document: object = config,
      ): Promise<DbPageChunk> {
        const splitter = new JsonDocumentSplitter(appConfig.splitter, {
          preserveFormatting: true,
        });
        await documentStore.addDocuments("test-json", "1.0", 0, {
          url: "config.json",
          title: "config.json",
          sourceContentType: "application/json",
          contentType: "application/json",
          textContent: "",
          chunks: await splitter.splitText(JSON.stringify(document, null, 2)),
          links: [],
          errors: [],
        });
        const chunks = await documentStore.findChunksByUrl(
          "test-json",
          "1.0",
          "config.json",
        );
        const match = chunks.find((chunk) => chunk.content.includes(text));
        if (!match) throw new Error(`No chunk contains ${text}`);
        return match;
      }

      it("returns the object that contains the match instead of the whole document", async () => {
        const timeout = await storeConfigAndFind('"timeout"');

        const result = await strategy.selectChunks(
          "test-json",
          "1.0",
          [timeout],
          documentStore,
        );

        const assembled = strategy.assembleContent(result);
        expect(assembled).toContain('"server": ');
        expect(assembled).toContain('"host": "localhost"');
        expect(assembled).toContain('"timeout": 30');
        expect(assembled).not.toContain("demo");
        expect(assembled).not.toContain("Alice");
      });

      it("returns the object a matched key opens", async () => {
        const server = await storeConfigAndFind('"server"');

        const result = await strategy.selectChunks(
          "test-json",
          "1.0",
          [server],
          documentStore,
        );

        const assembled = strategy.assembleContent(result);
        expect(assembled).toContain('"host": "localhost"');
        expect(assembled).toContain('"timeout": 30');
        expect(assembled).not.toContain("demo");
        expect(assembled).not.toContain("Alice");
      });

      it.each([
        ["object", {}],
        ["array", []],
      ])("returns an empty %s a matched key opens", async (_kind, empty) => {
        const target = await storeConfigAndFind('"target"', {
          name: "unrelated",
          target: empty,
          other: 1,
        });

        const result = await strategy.selectChunks(
          "test-json",
          "1.0",
          [target],
          documentStore,
        );

        const assembled = strategy.assembleContent(result);
        expect(assembled).toContain('"target": ');
        expect(assembled).not.toContain("unrelated");
        expect(assembled).not.toContain("other");
      });
    });

    it("should handle hierarchical gaps in parent chain", async () => {
      // Use the public API to add documents with a gap in the hierarchy
      await documentStore.addDocuments("test-gaps", "1.0", 0, {
        url: "GapTest.ts",
        title: "Gap Test TypeScript File",
        sourceContentType: "text/typescript",
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
        sourceContentType: "text/typescript",
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
        "text/typescript",
        0, // depth
        null, // content_url: retrieved from its own URL
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
        "text/typescript",
        0, // depth
        null, // content_url: retrieved from its own URL
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
        "text/typescript",
        0, // depth
        null, // content_url: retrieved from its own URL
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
