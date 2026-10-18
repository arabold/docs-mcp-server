import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Embeddings } from "@langchain/core/embeddings";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CachingEmbeddings, EmbeddingCache } from "./embedding-cache";
import { STABLE_CORPUS_URL, stableCorpusText } from "./paths";

/** Embeds a text as [length, first char code], and records every call. */
class RecordingEmbeddings extends Embeddings {
  readonly documentCalls: string[][] = [];
  readonly queryCalls: string[] = [];

  constructor(private readonly offset = 0) {
    super({});
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    this.documentCalls.push(texts);
    return texts.map((text) => this.vector(text));
  }

  async embedQuery(text: string): Promise<number[]> {
    this.queryCalls.push(text);
    return this.vector(text).map((value) => value + 0.5);
  }

  private vector(text: string): number[] {
    return [text.length + this.offset, text.charCodeAt(0)];
  }
}

describe("CachingEmbeddings", () => {
  let cacheDir: string;
  const caches: EmbeddingCache[] = [];
  const openCache = (model = "test:model", dimension = 2) => {
    const cache = new EmbeddingCache(cacheDir, model, dimension);
    caches.push(cache);
    return cache;
  };

  beforeEach(() => {
    cacheDir = mkdtempSync(path.join(tmpdir(), "embedding-cache-"));
  });

  afterEach(() => {
    for (const cache of caches.splice(0)) cache.close();
    rmSync(cacheDir, { recursive: true, force: true });
  });

  it("asks the provider once and answers later calls from the cache", async () => {
    const inner = new RecordingEmbeddings();
    const first = await new CachingEmbeddings(inner, openCache()).embedDocuments([
      "ab",
      "c",
    ]);
    const second = await new CachingEmbeddings(inner, openCache()).embedDocuments([
      "ab",
      "c",
    ]);

    expect(second).toEqual(first);
    expect(first).toEqual([
      [2, 97],
      [1, 99],
    ]);
    expect(inner.documentCalls).toEqual([["ab", "c"]]);
  });

  it("requests only the texts the cache has not seen, each once", async () => {
    const inner = new RecordingEmbeddings();
    const embeddings = new CachingEmbeddings(inner, openCache());
    await embeddings.embedDocuments(["ab"]);

    const vectors = await embeddings.embedDocuments(["new", "ab", "new"]);

    expect(inner.documentCalls).toEqual([["ab"], ["new"]]);
    expect(vectors).toEqual([
      [3, 110],
      [2, 97],
      [3, 110],
    ]);
  });

  it("keeps query vectors apart from document vectors of the same text", async () => {
    const inner = new RecordingEmbeddings();
    const embeddings = new CachingEmbeddings(inner, openCache());

    const document = await embeddings.embedDocuments(["ab"]);
    const query = await embeddings.embedQuery("ab");
    const again = await embeddings.embedQuery("ab");

    expect(document).toEqual([[2, 97]]);
    expect(query).toEqual([2.5, 97.5]);
    expect(again).toEqual(query);
    expect(inner.queryCalls).toEqual(["ab"]);
  });

  it("never answers one model with another model's vectors", async () => {
    await new CachingEmbeddings(
      new RecordingEmbeddings(),
      openCache("test:a"),
    ).embedDocuments(["ab"]);
    const other = new RecordingEmbeddings(100);

    const vectors = await new CachingEmbeddings(
      other,
      openCache("test:b"),
    ).embedDocuments(["ab"]);

    expect(vectors).toEqual([[102, 97]]);
    expect(other.documentCalls).toEqual([["ab"]]);
  });

  it("returns the float32 values it stores, so cached runs rank like the first", async () => {
    const inner = new RecordingEmbeddings();
    inner.embedDocuments = async (texts) => texts.map(() => [0.1, 0.2]);
    const first = await new CachingEmbeddings(inner, openCache()).embedDocuments(["x"]);
    const cached = await new CachingEmbeddings(inner, openCache()).embedDocuments(["x"]);

    expect(first).toEqual(cached);
    expect(first[0][0]).toBe(Math.fround(0.1));
  });

  it("keeps models whose names only differ in punctuation apart", async () => {
    await new CachingEmbeddings(
      new RecordingEmbeddings(),
      openCache("custom:org/model"),
    ).embedDocuments(["ab"]);
    const other = new RecordingEmbeddings(100);

    await new CachingEmbeddings(other, openCache("custom:org_model")).embedDocuments([
      "ab",
    ]);

    expect(other.documentCalls).toEqual([["ab"]]);
  });

  it("shares vectors between a model's short and provider-qualified names", async () => {
    await new CachingEmbeddings(
      new RecordingEmbeddings(),
      openCache("openai:text-embedding-3-small"),
    ).embedDocuments(["ab"]);
    const inner = new RecordingEmbeddings();

    await new CachingEmbeddings(
      inner,
      openCache("text-embedding-3-small"),
    ).embedDocuments(["ab"]);

    expect(inner.documentCalls).toEqual([]);
  });

  it("embeds the same text wherever the corpus is checked out", async () => {
    const inner = new RecordingEmbeddings();
    const header = (dir: string) =>
      `<url>${pathToFileURL(path.join(dir, "react@abc/learn/state.md")).href}</url>\nState`;
    const here = new CachingEmbeddings(
      inner,
      openCache(),
      stableCorpusText("/home/a/corpus"),
    );
    const there = new CachingEmbeddings(
      inner,
      openCache(),
      stableCorpusText("/srv/b/corpus"),
    );

    await here.embedDocuments([header("/home/a/corpus")]);
    await there.embedDocuments([header("/srv/b/corpus")]);

    expect(inner.documentCalls).toEqual([
      [`<url>${STABLE_CORPUS_URL}/react@abc/learn/state.md</url>\nState`],
    ]);
  });
});
