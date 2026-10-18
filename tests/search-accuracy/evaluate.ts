/**
 * Scoring of the search accuracy benchmark: runs each golden query against the
 * indexed corpus in one mode and turns the ranked results into metrics.
 */

import { createRequire } from "node:module";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { DocumentRetrieverService } from "../../src/store/DocumentRetrieverService";
import { DocumentStore } from "../../src/store/DocumentStore";
import type { AppConfig } from "../../src/utils/config";
import type { GoldenQuery } from "./golden";
import { isPage, matchPassage } from "./passages";

const require = createRequire(import.meta.url);
const { computeIrMetrics, mean } = require("../search-eval/lib/metrics.cjs") as {
  computeIrMetrics: (
    ranked: string[],
    qrels: { url: string; grade: number }[],
  ) => Record<string, number>;
  mean: (values: number[]) => number;
};

/** Search configurations the benchmark compares. */
export const MODES = ["fts", "vector", "hybrid"] as const;
export type Mode = (typeof MODES)[number];

/** What is scored: the store's ranked chunks, or the final search results. */
export const LEVELS = ["store", "final"] as const;
export type Level = (typeof LEVELS)[number];

/** Results requested per query at both levels; ranks past it count as misses. */
export const RESULT_LIMIT = 10;

/** Metrics computed per query and averaged per group. */
export const METRIC_KEYS = [
  "mrr",
  "hit_at_1",
  "hit_at_3",
  "hit_at_5",
  "hit_at_10",
  "recall_at_10",
  "ndcg_at_10",
] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];
export type Metrics = Record<MetricKey, number>;

/** One search result as the benchmark sees it. */
export interface RankedResult {
  url: string;
  content: string;
}

/** Scores of one query at one level. */
export interface QueryScore {
  queryId: string;
  /** 1-based rank of the first result holding a golden passage, or null. */
  chunkRank: number | null;
  /** 1-based rank of the first result from a golden passage's page, or null. */
  pageRank: number | null;
  chunk: Metrics;
  page: Metrics;
}

/** Averages over a group of queries. */
export interface Aggregate {
  queries: number;
  chunk: Metrics;
  page: Metrics;
  chunkMisses: number;
}

/** Averages over all queries and per library, intent and style. */
export interface Breakdown {
  overall: Aggregate;
  byLibrary: Record<string, Aggregate>;
  byIntent: Record<string, Aggregate>;
  byStyle: Record<string, Aggregate>;
}

/** The outcome of one mode. */
export type ModeOutcome =
  | { status: "scored"; levels: Record<Level, QueryScore[]> }
  | { status: "skipped"; reason: string };

/** Golden passages the splitter cut across chunks. */
export interface PassageReport {
  split: { queryId: string; page: string; text: string }[];
}

/** Thrown when golden passages cannot be found in the index. */
export class PassageNotFoundError extends Error {
  constructor(readonly missing: { queryId: string; page: string; text: string }[]) {
    super(
      `${missing.length} golden passage(s) are not in any indexed chunk of their page:\n  ${missing
        .map((entry) => `${entry.queryId} ${entry.page}: "${entry.text}"`)
        .join("\n  ")}`,
    );
    this.name = "PassageNotFoundError";
  }
}

/**
 * Scores one query's ranked results against its golden passages.
 *
 * A result counts at chunk level when it is from a golden passage's page and
 * holds the passage (wholly, or at least half of it when the splitter cut it).
 * It counts at page level when it is from a golden passage's page.
 *
 * @param query The golden query.
 * @param results Results in rank order.
 */
export function scoreQuery(query: GoldenQuery, results: RankedResult[]): QueryScore {
  const chunkIds = results.map((result, index) => {
    let best: { id: string; grade: number } | undefined;
    query.passages.forEach((passage, passageIndex) => {
      if (
        isPage(result.url, passage.page) &&
        matchPassage(result.content, passage.text) !== null &&
        passage.grade > (best?.grade ?? 0)
      ) {
        best = { id: `${query.id}-p${passageIndex}`, grade: passage.grade };
      }
    });
    return best?.id ?? `miss-${index}`;
  });
  const chunkQrels = query.passages.map((passage, passageIndex) => ({
    url: `${query.id}-p${passageIndex}`,
    grade: passage.grade,
  }));

  const pageGrades = new Map<string, number>();
  for (const passage of query.passages) {
    pageGrades.set(
      passage.page,
      Math.max(pageGrades.get(passage.page) ?? 0, passage.grade),
    );
  }
  const pageIds = results.map(
    (result, index) =>
      [...pageGrades.keys()].find((page) => isPage(result.url, page)) ?? `other-${index}`,
  );
  const pageQrels = [...pageGrades].map(([page, grade]) => ({ url: page, grade }));

  const chunkRank = firstRank(chunkIds, new Set(chunkQrels.map((qrel) => qrel.url)));
  const pageRank = firstRank(pageIds, new Set(pageGrades.keys()));
  return {
    queryId: query.id,
    chunkRank,
    pageRank,
    chunk: toMetrics(computeIrMetrics(chunkIds, chunkQrels), chunkRank),
    page: toMetrics(computeIrMetrics(pageIds, pageQrels), pageRank),
  };
}

function firstRank(ids: string[], relevant: Set<string>): number | null {
  const index = ids.findIndex((id) => relevant.has(id));
  return index === -1 ? null : index + 1;
}

function toMetrics(computed: Record<string, number>, rank: number | null): Metrics {
  return {
    mrr: computed.mrr,
    hit_at_1: computed.hit_at_1,
    hit_at_3: computed.hit_at_3,
    hit_at_5: computed.hit_at_5,
    hit_at_10: rank !== null && rank <= 10 ? 1 : 0,
    recall_at_10: computed.recall_at_10,
    ndcg_at_10: computed.ndcg_at_10,
  };
}

/**
 * Averages query scores over all queries and per library, intent and style.
 *
 * @param scores Scores of one mode and level.
 * @param queries The golden queries the scores belong to.
 */
export function aggregate(scores: QueryScore[], queries: GoldenQuery[]): Breakdown {
  const byId = new Map(queries.map((query) => [query.id, query]));
  const group = (key: (query: GoldenQuery) => string) => {
    const groups = new Map<string, QueryScore[]>();
    for (const score of scores) {
      const query = byId.get(score.queryId);
      if (!query) continue;
      groups.set(key(query), [...(groups.get(key(query)) ?? []), score]);
    }
    return Object.fromEntries(
      [...groups]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, members]) => [name, average(members)]),
    );
  };
  return {
    overall: average(scores),
    byLibrary: group((query) => query.library),
    byIntent: group((query) => query.intent),
    byStyle: group((query) => query.style),
  };
}

/**
 * Averages the metrics of a group of query scores.
 *
 * @param scores The scores to average.
 */
export function average(scores: QueryScore[]): Aggregate {
  const averageOf = (side: "chunk" | "page") =>
    Object.fromEntries(
      METRIC_KEYS.map((key) => [key, mean(scores.map((score) => score[side][key]))]),
    ) as Metrics;
  return {
    queries: scores.length,
    chunk: averageOf("chunk"),
    page: averageOf("page"),
    chunkMisses: scores.filter((score) => score.chunkRank === null).length,
  };
}

/**
 * Checks that every golden passage is in a searchable chunk of its page.
 *
 * @param dbPath Path of the indexed store.
 * @param queries The golden queries.
 * @returns The passages the splitter cut across chunks.
 * @throws PassageNotFoundError listing every passage that no chunk holds.
 */
export function validatePassages(dbPath: string, queries: GoldenQuery[]): PassageReport {
  const db = new Database(dbPath, { readonly: true });
  sqliteVec.load(db);
  try {
    const chunksOfPage = db.prepare<[string, string], { content: string; url: string }>(`
      SELECT d.content, p.url
      FROM documents d
      JOIN pages p ON p.id = d.page_id
      JOIN versions v ON v.id = p.version_id
      JOIN libraries l ON l.id = v.library_id
      WHERE l.name = ? AND p.url LIKE ? ESCAPE '\\'
        AND NOT EXISTS (
          SELECT 1 FROM json_each(json_extract(d.metadata, '$.types')) je
          WHERE je.value = 'structural'
        )
    `);
    const missing: PassageReport["split"] = [];
    const split: PassageReport["split"] = [];
    for (const query of queries) {
      for (const passage of query.passages) {
        const pattern = `%/${passage.page.replace(/[\\%_]/g, (char) => `\\${char}`)}`;
        const chunks = chunksOfPage
          .all(query.library.toLowerCase(), pattern)
          .filter((chunk) => isPage(chunk.url, passage.page));
        const matches = chunks.map((chunk) => matchPassage(chunk.content, passage.text));
        const entry = { queryId: query.id, page: passage.page, text: passage.text };
        if (matches.includes("whole")) continue;
        if (matches.includes("split")) split.push(entry);
        else missing.push(entry);
      }
    }
    if (missing.length > 0) throw new PassageNotFoundError(missing);
    return { split };
  } finally {
    db.close();
  }
}

/**
 * The configuration of one mode, derived from the run's configuration.
 *
 * @param mode The mode.
 * @param config The run's configuration; not modified.
 */
export function modeConfig(mode: Mode, config: AppConfig): AppConfig {
  const result = structuredClone(config);
  if (mode === "fts") result.app.embeddingModel = "";
  if (mode === "vector") result.search.weightFts = 0;
  return result;
}

/**
 * Runs every query in one mode at both levels.
 *
 * @param mode The mode.
 * @param dbPath Path of the indexed store.
 * @param queries The golden queries.
 * @param config The run's configuration.
 * @returns The scores, or the reason the mode was skipped.
 */
export async function evaluateMode(
  mode: Mode,
  dbPath: string,
  queries: GoldenQuery[],
  config: AppConfig,
): Promise<ModeOutcome> {
  const effective = modeConfig(mode, config);
  const store = new DocumentStore(dbPath, effective);
  await store.initialize();
  try {
    if (mode !== "fts" && store.getActiveEmbeddingConfig() === null) {
      return {
        status: "skipped",
        reason: "vector search is off: no embedding model or no credentials for it",
      };
    }
    const retriever = new DocumentRetrieverService(store, effective);
    const levels: Record<Level, QueryScore[]> = { store: [], final: [] };
    for (const query of queries) {
      const chunks = await store.findByContent(
        query.library,
        "",
        query.query,
        RESULT_LIMIT,
      );
      levels.store.push(
        scoreQuery(
          query,
          chunks.map((chunk) => ({ url: chunk.url, content: chunk.content })),
        ),
      );
      const results = await retriever.search(
        query.library,
        "",
        query.query,
        RESULT_LIMIT,
      );
      levels.final.push(
        scoreQuery(
          query,
          results.map((result) => ({ url: result.url, content: result.content })),
        ),
      );
    }
    return { status: "scored", levels };
  } finally {
    await store.shutdown();
  }
}
