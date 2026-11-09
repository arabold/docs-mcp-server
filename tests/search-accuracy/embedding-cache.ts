/**
 * On-disk embedding cache for the search accuracy benchmark.
 *
 * Every vector the benchmark obtains is stored under the embedding model's
 * identity, the kind of call (document or query, which some providers embed
 * differently) and a hash of the exact text. A run whose vectors are all
 * cached makes no request to the provider.
 */

import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { Embeddings } from "@langchain/core/embeddings";
import Database, { type Database as DatabaseType } from "better-sqlite3";
import { splitModelSpec } from "../../src/store/embeddings/EmbeddingConfig";

/**
 * The provider-qualified name of an embedding model, so `text-embedding-3-small`
 * and `openai:text-embedding-3-small` name the same model.
 *
 * @param modelSpec A model specification as configured.
 */
export function canonicalModelSpec(modelSpec: string): string {
  const { provider, model } = splitModelSpec(modelSpec);
  return `${provider}:${model}`;
}

/** Whether a text was embedded as a document or as a search query. */
export type EmbeddingKind = "document" | "query";

/** Counts of cache lookups since the cache was opened. */
export interface EmbeddingCacheStats {
  hits: number;
  misses: number;
}

/**
 * Vectors of one embedding model, kept in a SQLite file of their own.
 */
export class EmbeddingCache {
  private readonly db: DatabaseType;
  private readonly select;
  private readonly insert;
  readonly stats: EmbeddingCacheStats = { hits: 0, misses: 0 };

  /**
   * Opens (or creates) the cache of one model.
   *
   * @param cacheDir Directory holding one file per model.
   * @param modelSpec The embedding model, e.g. `openai:text-embedding-3-small`.
   * @param vectorDimension The dimension vectors are padded to.
   */
  constructor(cacheDir: string, modelSpec: string, vectorDimension: number) {
    mkdirSync(cacheDir, { recursive: true });
    const identity = `${canonicalModelSpec(modelSpec)}\0${vectorDimension}`;
    // Readable prefix; the hash keeps specs that slug alike (`a/b`, `a_b`) apart
    const slug = canonicalModelSpec(modelSpec).replace(/[^a-zA-Z0-9.-]+/g, "_");
    const hash = createHash("sha256").update(identity).digest("hex").slice(0, 12);
    this.db = new Database(
      path.join(cacheDir, `${slug}-${vectorDimension}-${hash}.sqlite`),
    );
    this.db.pragma("journal_mode = WAL");
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS vectors (key TEXT PRIMARY KEY, vector BLOB NOT NULL)",
    );
    this.select = this.db.prepare<[string], { vector: Buffer }>(
      "SELECT vector FROM vectors WHERE key = ?",
    );
    this.insert = this.db.prepare<[string, Buffer]>(
      "INSERT OR REPLACE INTO vectors (key, vector) VALUES (?, ?)",
    );
  }

  /** Returns the cached vector of a text, or `undefined`. */
  get(kind: EmbeddingKind, text: string): number[] | undefined {
    const row = this.select.get(cacheKey(kind, text));
    if (!row) {
      this.stats.misses++;
      return undefined;
    }
    this.stats.hits++;
    const floats = new Float32Array(
      row.vector.buffer,
      row.vector.byteOffset,
      row.vector.byteLength / Float32Array.BYTES_PER_ELEMENT,
    );
    return Array.from(floats);
  }

  /** Stores the vectors of several texts in one transaction. */
  putMany(kind: EmbeddingKind, entries: { text: string; vector: number[] }[]): void {
    this.db.transaction(() => {
      for (const { text, vector } of entries) {
        this.insert.run(
          cacheKey(kind, text),
          Buffer.from(new Float32Array(vector).buffer),
        );
      }
    })();
  }

  /** Closes the underlying file. */
  close(): void {
    this.db.close();
  }
}

function cacheKey(kind: EmbeddingKind, text: string): string {
  return createHash("sha256").update(kind).update("\0").update(text).digest("hex");
}

/**
 * Embeddings that answer from an {@link EmbeddingCache} and ask the wrapped
 * client only for texts the cache has not seen. Provider errors propagate
 * unchanged and nothing is cached for the failed texts.
 *
 * `normalize` rewrites every text before it is looked up or sent, so parts
 * that depend on the machine (such as where the corpus is checked out) do not
 * change the vectors.
 */
export class CachingEmbeddings extends Embeddings {
  constructor(
    private readonly inner: Embeddings,
    private readonly cache: EmbeddingCache,
    private readonly normalize: (text: string) => string = (text) => text,
  ) {
    super({});
  }

  /**
   * Embeds documents, requesting each distinct uncached text once in a single
   * call to the wrapped client.
   */
  async embedDocuments(originalTexts: string[]): Promise<number[][]> {
    const texts = originalTexts.map(this.normalize);
    const vectors: (number[] | undefined)[] = texts.map((text) =>
      this.cache.get("document", text),
    );
    const missing = [
      ...new Set(texts.filter((_, index) => vectors[index] === undefined)),
    ];
    if (missing.length > 0) {
      const fetched = (await this.inner.embedDocuments(missing)).map(toFloat32);
      const byText = new Map(missing.map((text, index) => [text, fetched[index]]));
      this.cache.putMany(
        "document",
        missing.map((text) => ({ text, vector: byText.get(text) ?? [] })),
      );
      for (let index = 0; index < texts.length; index++) {
        vectors[index] ??= byText.get(texts[index]);
      }
    }
    return vectors.map((vector) => vector ?? []);
  }

  /** Embeds a search query, from the cache when it has been seen before. */
  async embedQuery(originalText: string): Promise<number[]> {
    const text = this.normalize(originalText);
    const cached = this.cache.get("query", text);
    if (cached) return cached;
    const vector = toFloat32(await this.inner.embedQuery(text));
    this.cache.putMany("query", [{ text, vector }]);
    return vector;
  }
}

/**
 * Rounds a vector to float32, as the cache stores it, so a first run and the
 * runs answered from the cache rank with identical values.
 */
function toFloat32(vector: number[]): number[] {
  return Array.from(new Float32Array(vector));
}

const sharedCaches = new Map<string, EmbeddingCache>();

/**
 * Returns the process-wide cache of one model, opening it on first use, so
 * every embedding client the pipeline creates shares one file and one count.
 *
 * @param cacheDir Directory holding one file per model.
 * @param modelSpec The embedding model.
 * @param vectorDimension The dimension vectors are padded to.
 */
export function sharedEmbeddingCache(
  cacheDir: string,
  modelSpec: string,
  vectorDimension: number,
): EmbeddingCache {
  const key = `${cacheDir}\0${canonicalModelSpec(modelSpec)}\0${vectorDimension}`;
  let cache = sharedCaches.get(key);
  if (!cache) {
    cache = new EmbeddingCache(cacheDir, modelSpec, vectorDimension);
    sharedCaches.set(key, cache);
  }
  return cache;
}

/** Lookups of every shared cache since the process started. */
export function sharedEmbeddingCacheStats(): EmbeddingCacheStats {
  const total: EmbeddingCacheStats = { hits: 0, misses: 0 };
  for (const cache of sharedCaches.values()) {
    total.hits += cache.stats.hits;
    total.misses += cache.stats.misses;
  }
  return total;
}

type EmbeddingFactoryModule =
  typeof import("../../src/store/embeddings/EmbeddingFactory");

/**
 * The embedding factory module with `createEmbeddingModel` wrapped so every
 * client it creates answers from the shared cache. Meant for `vi.mock`.
 *
 * @param actual The real module.
 * @param cacheDir Directory of the embedding cache files.
 * @param normalize Rewrites each text before lookup and embedding.
 */
export function withEmbeddingCache(
  actual: EmbeddingFactoryModule,
  cacheDir: string,
  normalize?: (text: string) => string,
): EmbeddingFactoryModule {
  return {
    ...actual,
    createEmbeddingModel: (providerAndModel, runtime) => {
      const inner = actual.createEmbeddingModel(providerAndModel, runtime);
      const dimension = runtime?.vectorDimension ?? runtime?.config?.vectorDimension ?? 0;
      return new CachingEmbeddings(
        inner,
        sharedEmbeddingCache(cacheDir, providerAndModel, dimension),
        normalize,
      );
    },
  };
}
