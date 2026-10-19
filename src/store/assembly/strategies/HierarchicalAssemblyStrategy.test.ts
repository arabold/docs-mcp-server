import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JsonDocumentSplitter } from "../../../splitter/JsonDocumentSplitter";
import type { Chunk } from "../../../splitter/types";
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

    describe("single matches in splitter output", () => {
      /** Builds a chunk the way the source code splitter emits it. */
      function chunk(content: string, path: string[], structural = false): Chunk {
        return {
          content,
          section: { path, level: path.length },
          types: structural ? ["code", "structural"] : ["code"],
        };
      }

      /** Stores one page of chunks and returns them as stored, in document order. */
      async function storePage(
        url: string,
        contentType: string,
        chunks: Chunk[],
      ): Promise<DbPageChunk[]> {
        await documentStore.addDocuments("test-single", "1.0", 0, {
          url,
          title: url,
          sourceContentType: contentType,
          contentType,
          textContent: "",
          chunks,
          links: [],
          errors: [],
        });
        return documentStore.findChunksByUrl("test-single", "1.0", url);
      }

      /** Returns the reassembled text for a single match. */
      async function assemble(match: DbPageChunk): Promise<string> {
        const result = await strategy.selectChunks(
          "test-single",
          "1.0",
          [match],
          documentStore,
        );
        return strategy.assembleContent(result);
      }

      it("returns the enclosing class with all its methods for a hit inside one method", async () => {
        const chunks = await storePage("UserService.ts", "text/typescript", [
          chunk("export class UserService {\n", ["UserService"], true),
          chunk("  getUser(id: string) {\n    return db.find(id);\n  }\n", [
            "UserService",
            "getUser",
          ]),
          chunk("  deleteUser(id: string) {\n    return db.delete(id);\n  }\n", [
            "UserService",
            "deleteUser",
          ]),
          chunk("}\n", ["UserService"]),
          chunk("export function helper() {\n  return 1;\n}\n", ["helper"]),
        ]);

        expect(await assemble(chunks[2])).toBe(
          "export class UserService {\n" +
            "  getUser(id: string) {\n    return db.find(id);\n  }\n" +
            "  deleteUser(id: string) {\n    return db.delete(id);\n  }\n" +
            "}\n",
        );
      });

      it.each([
        ["inside a method", 2],
        ["on the class declaration", 1],
      ])(
        "returns a namespaced class and the namespace boundaries for a match %s",
        async (_where, index) => {
          const chunks = await storePage("Accounts.ts", "text/typescript", [
            chunk("export namespace Accounts {\n", ["Accounts"], true),
            chunk("  export class UserService {\n", ["Accounts", "UserService"], true),
            chunk("    getUser(id: string) {\n      return id;\n    }\n", [
              "Accounts",
              "UserService",
              "getUser",
            ]),
            chunk("  }\n", ["Accounts", "UserService"]),
            chunk("  export const limit = 5;\n", ["Accounts", "limit"]),
            chunk("}\n", ["Accounts"]),
            chunk("const after = 1;\n", ["after"]),
          ]);

          expect(await assemble(chunks[index])).toBe(
            "export namespace Accounts {\n" +
              "  export class UserService {\n" +
              "    getUser(id: string) {\n      return id;\n    }\n" +
              "  }\n" +
              "}\n",
          );
        },
      );

      it("finds the class around a match when a field sits between its methods", async () => {
        const chunks = await storePage("Accounts.ts", "text/typescript", [
          chunk("export namespace Accounts {\n", ["Accounts"], true),
          chunk("  export class UserService {\n", ["Accounts", "UserService"], true),
          chunk("    getUser() {}\n", ["Accounts", "UserService", "getUser"]),
          chunk("    private cache = new Map();\n", ["Accounts", "UserService"]),
          chunk("    deleteUser() {}\n", ["Accounts", "UserService", "deleteUser"]),
          chunk("  }\n", ["Accounts", "UserService"]),
          chunk("  export const other = 1;\n", ["Accounts", "other"]),
          chunk("}\n", ["Accounts"]),
        ]);

        expect(await assemble(chunks[4])).toBe(
          "export namespace Accounts {\n" +
            "  export class UserService {\n" +
            "    getUser() {}\n" +
            "    private cache = new Map();\n" +
            "    deleteUser() {}\n" +
            "  }\n" +
            "}\n",
        );
      });

      it("opens an enclosing scope at its declaration, skipping the members before the match", async () => {
        const chunks = await storePage("Accounts.ts", "text/typescript", [
          chunk("export namespace Accounts {\n", ["Accounts"], true),
          chunk("  export class First {\n", ["Accounts", "First"], true),
          chunk("    a() { return 1; }\n", ["Accounts", "First", "a"]),
          chunk("  }\n", ["Accounts", "First"]),
          chunk('  console.log("between");\n', ["Accounts"]),
          chunk("  export class Second {\n", ["Accounts", "Second"], true),
          chunk("    b() { return 2; }\n", ["Accounts", "Second", "b"]),
          chunk("  }\n", ["Accounts", "Second"]),
          chunk("}\n", ["Accounts"]),
        ]);

        expect(await assemble(chunks[6])).toBe(
          "export namespace Accounts {\n" +
            "  export class Second {\n" +
            "    b() { return 2; }\n" +
            "  }\n" +
            "}\n",
        );
      });

      it("returns only the matched chunk for a hit in global code", async () => {
        const chunks = await storePage("main.ts", "text/typescript", [
          chunk("console.log(start);\n", []),
          chunk("export class Worker {\n", ["Worker"], true),
          chunk("  run() {}\n", ["Worker", "run"]),
          chunk("}\n", ["Worker"]),
        ]);

        expect(await assemble(chunks[0])).toBe("console.log(start);\n");
      });

      describe("JSON", () => {
        /** Stores a document as the JSON splitter chunks it and returns the chunk holding `text`. */
        async function storeJsonAndFind(
          document: object,
          text: string,
        ): Promise<DbPageChunk> {
          const splitter = new JsonDocumentSplitter(appConfig.splitter, {
            preserveFormatting: true,
          });
          const chunks = await storePage(
            "config.json",
            "application/json",
            await splitter.splitText(JSON.stringify(document, null, 2)),
          );
          const match = chunks.find((stored) => stored.content.includes(text));
          if (!match) throw new Error(`No chunk contains ${text}`);
          return match;
        }

        it.each([
          ["a value inside it", '"timeout"'],
          ["its key", '"server"'],
        ])(
          "returns the object for a match on %s instead of the whole document",
          async (_what, text) => {
            const match = await storeJsonAndFind(
              {
                name: "demo",
                server: { host: "localhost", timeout: 30 },
                users: [{ name: "Alice" }],
              },
              text,
            );

            const assembled = await assemble(match);
            expect(assembled).toContain('"server": ');
            expect(assembled).toContain('"host": "localhost"');
            expect(assembled).toContain('"timeout": 30');
            expect(assembled).not.toContain("demo");
            expect(assembled).not.toContain("Alice");
          },
        );

        it.each([
          ["object", {}],
          ["array", []],
        ])("returns an empty %s a matched key opens", async (_kind, empty) => {
          const match = await storeJsonAndFind(
            { name: "unrelated", target: empty, other: 1 },
            '"target"',
          );

          const assembled = await assemble(match);
          expect(assembled).toContain('"target": ');
          expect(assembled).not.toContain("unrelated");
          expect(assembled).not.toContain("other");
        });
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
  });
});
