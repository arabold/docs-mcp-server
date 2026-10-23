import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JsonDocumentSplitter } from "../../../splitter/JsonDocumentSplitter";
import { TreesitterSourceCodeSplitter } from "../../../splitter/treesitter/TreesitterSourceCodeSplitter";
import type { Chunk } from "../../../splitter/types";
import { type AppConfig, loadConfig } from "../../../utils/config";
import { DocumentStore } from "../../DocumentStore";
import type { DbPageChunk } from "../../types";
import { HierarchicalAssemblyStrategy } from "./HierarchicalAssemblyStrategy";

const LIBRARY = "hierarchical-lib";
const VERSION = "1.0.0";

/** Collapses whitespace, so expectations do not depend on which chunk carries a line break. */
function squash(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Builds a source code chunk for a layout the splitter only produces for large files. */
function chunk(content: string, path: string[], structural = false): Chunk {
  return {
    content,
    section: { path, level: path.length },
    types: structural ? ["code", "structural"] : ["code"],
  };
}

/**
 * Integration tests for selecting the chunks around matches in source code and JSON,
 * run on real splitter output in a real in-memory store.
 */
describe("HierarchicalAssemblyStrategy", () => {
  let config: AppConfig;
  let store: DocumentStore;
  let strategy: HierarchicalAssemblyStrategy;

  beforeEach(async () => {
    config = loadConfig();
    config.app.embeddingModel = ""; // FTS-only: no external credentials required
    store = new DocumentStore(":memory:", config);
    await store.initialize();
    strategy = new HierarchicalAssemblyStrategy(config);
  });

  afterEach(async () => {
    await store.shutdown();
  });

  /** Stores one page of chunks and returns them as stored, in document order. */
  async function storePage(
    url: string,
    contentType: string,
    chunks: Chunk[],
  ): Promise<DbPageChunk[]> {
    await store.addDocuments(LIBRARY, VERSION, 0, {
      url,
      title: url,
      sourceContentType: contentType,
      contentType,
      textContent: "",
      chunks,
      links: [],
      errors: [],
    });
    return store.findChunksByUrl(LIBRARY, VERSION, url);
  }

  /** Returns the text reassembled around the chunks that contain the given texts. */
  async function assemble(chunks: DbPageChunk[], texts: string[]): Promise<string> {
    const matches = texts.map((text) => {
      const match = chunks.find((stored) => stored.content.includes(text));
      if (!match) throw new Error(`No chunk contains ${text}`);
      return match;
    });
    const result = await strategy.selectChunks(LIBRARY, VERSION, matches, store);
    return squash(strategy.assembleContent(result));
  }

  it("rebuilds the structures around matches in source code", async () => {
    const source = `export namespace Accounts {
  export class First {
    a() {}
  }

  console.log("between");

  export class UserService {
    getUser() {}
    createUser() {}
    private cache = new Map();
    deleteUser() {}
  }

  export const other = 1;
}

export function migrate() {}

console.log("done");
`;
    const splitter = new TreesitterSourceCodeSplitter(config.splitter);
    const chunks = await storePage(
      "Accounts.ts",
      "text/typescript",
      await splitter.splitText(source, "text/typescript"),
    );
    const userService =
      "export namespace Accounts { export class UserService { getUser() {} createUser() {} private cache = new Map(); deleteUser() {} } }";

    const cases: [label: string, matches: string[], expected: string][] = [
      // The field between the methods carries the class path, and the statement
      // and class before it share the namespace path; neither may hide the class
      [
        "a method brings its whole class and the namespace boundaries",
        ["deleteUser"],
        userService,
      ],
      ["a class declaration brings the same class", ["class UserService"], userService],
      ["code at the page root comes back alone", ['"done"'], 'console.log("done");'],
      [
        "several matches in a class leave out its other methods",
        ["getUser", "deleteUser"],
        "export namespace Accounts { export class UserService { getUser() {} private cache = new Map(); deleteUser() {} } }",
      ],
      [
        "matches without a common path each keep their own scopes",
        ["a() {}", '"done"'],
        'export namespace Accounts { export class First { a() {} } } console.log("done");',
      ],
    ];

    for (const [label, matches, expected] of cases) {
      expect.soft(await assemble(chunks, matches), label).toBe(expected);
    }
  });

  it("rebuilds the object or array around matches in JSON instead of the whole document", async () => {
    const document = {
      name: "demo",
      server: { host: "localhost", timeout: 30 },
      users: [{ name: "Alice" }],
      target: {},
      list: [],
    };
    const splitter = new JsonDocumentSplitter(config.splitter, {
      preserveFormatting: true,
    });
    const chunks = await storePage(
      "config.json",
      "application/json",
      await splitter.splitText(JSON.stringify(document, null, 2)),
    );
    const server = '{ "server": { "host": "localhost", "timeout": 30 },}';

    // A comma that separated the selection from a left-out sibling stays in place
    const cases: [label: string, match: string, expected: string][] = [
      ["a value brings the object that contains it", '"timeout"', server],
      ["a key brings the object it opens", '"server"', server],
      ["a key brings an empty object", '"target"', '{ "target": { },}'],
      ["a key brings an empty array", '"list"', '{ "list": [ ]}'],
    ];

    for (const [label, match, expected] of cases) {
      expect.soft(await assemble(chunks, [match]), label).toBe(expected);
    }
  });

  it("skips a level that has no chunk of its own", async () => {
    const chunks = await storePage("Gap.ts", "text/typescript", [
      chunk("namespace UserManagement {\n", ["UserManagement"], true),
      // No chunk carries ["UserManagement", "UserService"]
      chunk("  getUserById() {}\n", ["UserManagement", "UserService", "getUserById"]),
      chunk("}\n", ["UserManagement"]),
    ]);

    expect(await assemble(chunks, ["getUserById"])).toBe(
      "namespace UserManagement { getUserById() {} }",
    );
  });

  it("promotes a match with no structural ancestor to its top-level element", async () => {
    // How the splitter breaks up a top-level function too large for one chunk
    const chunks = await storePage("migrate.ts", "text/typescript", [
      chunk("export function applyMigrations() {\n", ["applyMigrations"]),
      chunk("  run(() => migrate());\n", ["applyMigrations", "<anonymous_arrow>"]),
      chunk("}\n", ["applyMigrations"]),
      chunk("export const after = 1;\n", ["after"]),
    ]);

    expect(await assemble(chunks, ["migrate()"])).toBe(
      "export function applyMigrations() { run(() => migrate()); }",
    );
  });
});
