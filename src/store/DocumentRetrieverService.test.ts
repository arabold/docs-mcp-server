import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SectionContentType } from "../splitter/types";
import type { AppConfig } from "../utils/config";
import { loadConfig } from "../utils/config";
import { DocumentRetrieverService } from "./DocumentRetrieverService";
import { DocumentStore } from "./DocumentStore";
import type { DbChunkRank, DbPageChunk } from "./types";

const LIBRARY = "retriever-lib";
const VERSION = "1.0.0";

interface SeedChunk {
  content: string;
  path: string[];
  types?: SectionContentType[];
}

/**
 * Integration tests for search result assembly, run against a real in-memory
 * SQLite store in full-text-only mode.
 */
describe("DocumentRetrieverService", () => {
  let config: AppConfig;
  let store: DocumentStore;
  let service: DocumentRetrieverService;

  beforeEach(async () => {
    config = loadConfig();
    config.app.embeddingModel = ""; // FTS-only: no external credentials required
    store = new DocumentStore(":memory:", config);
    await store.initialize();
    service = new DocumentRetrieverService(store, config);
  });

  afterEach(async () => {
    await store.shutdown();
  });

  /** Stores one page whose chunks carry the given section paths. */
  async function addPage(
    url: string,
    chunks: SeedChunk[],
    options: {
      version?: string;
      contentType?: string;
      sourceContentType?: string;
      contentUrl?: string;
    } = {},
  ): Promise<void> {
    const contentType = options.contentType ?? "text/markdown";
    await store.addDocuments(LIBRARY, options.version ?? VERSION, 1, {
      url,
      contentUrl: options.contentUrl,
      title: "Page",
      sourceContentType: options.sourceContentType ?? contentType,
      contentType,
      textContent: "",
      links: [],
      errors: [],
      chunks: chunks.map(({ content, path, types }) => ({
        types: types ?? ["text"],
        content,
        section: { level: path.length, path },
      })),
    });
  }

  /** Stores `count` single-chunk pages that all match the word "zebra". */
  async function addMatchingPages(count: number): Promise<void> {
    for (let i = 0; i < count; i++) {
      await addPage(`https://example.com/page${i}`, [
        { content: `Zebra page ${i}`, path: [`Page ${i}`] },
      ]);
    }
  }

  it("returns no results when nothing matches the query", async () => {
    await addPage("https://example.com/guide", [{ content: "Install it", path: ["A"] }]);

    expect(await service.search(LIBRARY, VERSION, "zebra")).toEqual([]);
  });

  it("assembles hits with their parent and neighbouring chunks in page order, each chunk once", async () => {
    const install = ["Guide", "Install"];
    await addPage("https://example.com/guide", [
      { content: "# Guide", path: ["Guide"] },
      { content: "Read this first", path: install },
      { content: "Check the requirements", path: install },
      { content: "Install the zebra package", path: install },
      { content: "Configure the zebra package", path: install },
      { content: "Verify the setup", path: install },
      { content: "Troubleshooting tips", path: install },
      { content: "Known issues", path: install },
      { content: "# Reference", path: ["Reference"] },
    ]);

    const results = await service.search(LIBRARY, VERSION, "zebra");

    // One preceding and two subsequent siblings per hit by default; the shared
    // parent leads once even though the store returns it after the hits.
    expect(results.map((r) => r.content)).toEqual([
      "# Guide\n\nCheck the requirements\n\nInstall the zebra package\n\nConfigure the zebra package\n\nVerify the setup\n\nTroubleshooting tips",
    ]);
  });

  it("includes up to childLimit child chunks of a hit", async () => {
    await addPage("https://example.com/guide", [
      { content: "# Zebra guide", path: ["Guide"] },
      { content: "Install", path: ["Guide", "Install"] },
      { content: "Nested detail", path: ["Guide", "Install", "Detail"] },
      { content: "Configure", path: ["Guide", "Configure"] },
      { content: "Deploy", path: ["Guide", "Deploy"] },
      { content: "Upgrade", path: ["Guide", "Upgrade"] },
    ]);

    const results = await service.search(LIBRARY, VERSION, "zebra");

    // Three children by default; a grandchild is not a child
    expect(results.map((r) => r.content)).toEqual([
      "# Zebra guide\n\nInstall\n\nConfigure\n\nDeploy",
    ]);
  });

  it("rebuilds structured content from its enclosing structure without separators", async () => {
    const cases: [
      label: string,
      contentType: string,
      container: string,
      member: string,
    ][] = [
      [
        "source code",
        "text/x-typescript",
        "class Greeter {\n",
        "  greet() { return 'zebra'; }\n",
      ],
      ["JSON", "application/json", "{\n", '  "greeting": "zebra"\n'],
    ];

    for (const [label, contentType, container, member] of cases) {
      const url = `https://example.com/greeter-${contentType}`;
      await addPage(
        url,
        [
          { content: container, path: ["Greeter"], types: ["structural"] },
          { content: member, path: ["Greeter", "greet"], types: ["code"] },
        ],
        { contentType },
      );

      const results = await service.search(LIBRARY, VERSION, "zebra");

      expect
        .soft(
          results.filter((r) => r.url === url).map((r) => r.content),
          label,
        )
        .toEqual([`${container}${member}`]);
    }
  });

  it("reports the page URL, where its content was fetched from, and its content types", async () => {
    await addPage(
      "https://example.com/converted",
      [{ content: "Zebra crossing", path: ["Roads"] }],
      {
        contentType: "text/markdown",
        sourceContentType: "text/html",
        contentUrl: "https://example.com/converted.md",
      },
    );

    const [result] = await service.search(LIBRARY, VERSION, "zebra");

    expect(result).toMatchObject({
      url: "https://example.com/converted",
      contentUrl: "https://example.com/converted.md",
      mimeType: "text/markdown",
      sourceMimeType: "text/html",
    });
  });

  it("returns at most ten results by default, or the requested number", async () => {
    await addMatchingPages(11);

    expect(await service.search(LIBRARY, VERSION, "zebra")).toHaveLength(10);
    expect(await service.search(LIBRARY, VERSION, "zebra", 3)).toHaveLength(3);
  });

  it("searches the unversioned documentation when no version is given", async () => {
    await addPage(
      "https://example.com/unversioned",
      [{ content: "Unversioned zebra", path: ["A"] }],
      { version: "" },
    );

    const results = await service.search(LIBRARY, null, "zebra");

    expect(results.map((r) => r.content)).toEqual(["Unversioned zebra"]);
  });

  describe("Smart Chunking (Distance-based Clustering)", () => {
    const DOC = "https://example.com/doc";
    const OTHER_DOC = "https://example.com/other";

    beforeEach(async () => {
      // Each chunk has its own top-level section, so no chunk brings in
      // context of its own and a result holds exactly the hits it clusters.
      await addPage(
        DOC,
        Array.from({ length: 10 }, (_, i) => ({
          content: `Section ${i}`,
          path: [`S${i}`],
        })),
      );
      await addPage(OTHER_DOC, [{ content: "Other 0", path: ["O0"] }]);
    });

    /**
     * Turns stored chunks into search hits with fixed scores, ordered best
     * first like the store's results. The store's full-text ranking decides
     * which chunks match and how they score; fixing both lets a test control
     * the hit order and the `sort_order` distance between hits.
     */
    async function hits(
      scores: Record<string, number>,
    ): Promise<(DbPageChunk & DbChunkRank)[]> {
      const chunks = [
        ...(await store.findChunksByUrl(LIBRARY, VERSION, DOC)),
        ...(await store.findChunksByUrl(LIBRARY, VERSION, OTHER_DOC)),
      ];
      return chunks
        .filter((chunk) => chunk.content in scores)
        .map((chunk) => ({ ...chunk, score: scores[chunk.content] }))
        .sort((a, b) => b.score - a.score);
    }

    it("merges hits on one page that lie within maxChunkDistance and splits the others", async () => {
      // maxChunkDistance is 3: Section 0 and 2 are 2 apart, Section 2 and 8 are 6 apart
      vi.spyOn(store, "findByContent").mockResolvedValue(
        await hits({ "Section 0": 0.8, "Section 2": 0.9, "Section 8": 0.7 }),
      );

      const results = await service.search(LIBRARY, VERSION, "section");

      // Page order within a result, with the best score of its merged hits
      expect(results.map((r) => [r.content, r.score])).toEqual([
        ["Section 0\n\nSection 2", 0.9],
        ["Section 8", 0.7],
      ]);
    });

    it("should sort final results by score", async () => {
      // Section 8 is split from Section 0, so its page yields a weak result
      // ahead of the other page's in page order.
      vi.spyOn(store, "findByContent").mockResolvedValue(
        await hits({ "Section 0": 0.5, "Section 8": 0.9, "Other 0": 0.7 }),
      );

      const results = await service.search(LIBRARY, VERSION, "section");

      expect(results.map((r) => r.content)).toEqual([
        "Section 8",
        "Other 0",
        "Section 0",
      ]);
    });
  });
});
