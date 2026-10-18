/**
 * Baseline handling and reporting of the search accuracy benchmark.
 *
 * The baseline keeps every query's scores per mode and level, so a run over a
 * subset of libraries is compared with the same queries of the baseline.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { AppConfig } from "../../src/utils/config";
import { canonicalModelSpec } from "./embedding-cache";
import {
  type Aggregate,
  aggregate,
  average,
  LEVELS,
  type Level,
  METRIC_KEYS,
  type MetricKey,
  type Metrics,
  MODES,
  type Mode,
  type ModeOutcome,
  type PassageReport,
  type QueryScore,
} from "./evaluate";
import type { GoldenQuery } from "./golden";

/** Largest drop of a gated metric a measurement run accepts. */
export const TOLERANCE = 0.02;

/** Metrics that fail a measurement run when they drop by more than {@link TOLERANCE}. */
export const GATED_METRICS = [
  "mrr",
  "hit_at_5",
  "ndcg_at_10",
] as const satisfies MetricKey[];

/** The configuration a run's numbers come from. */
export interface RunSnapshot {
  corpusSha256: string;
  goldenSha256: string;
  /** Null when no mode used embeddings. */
  embeddingModel: string | null;
  vectorDimension: number;
  search: AppConfig["search"];
  resultLimit: number;
}

/** Everything one run produced. */
export interface RunResult {
  snapshot: RunSnapshot;
  queries: GoldenQuery[];
  modes: Partial<Record<Mode, ModeOutcome>>;
  passages: PassageReport;
  /** Texts sent to the embedding provider during the run. */
  embeddingRequests: number;
}

/**
 * A query's scores as the baseline keeps them, on one line each: the
 * chunk-level and page-level first ranks, then each side's metrics in
 * {@link METRIC_KEYS} order.
 */
export interface BaselineQuery {
  ranks: [number | null, number | null];
  chunk: number[];
  page: number[];
}

const round = (value: number) => Math.round(value * 10000) / 10000;

function toBaselineQuery(score: QueryScore): BaselineQuery {
  return {
    ranks: [score.chunkRank, score.pageRank],
    chunk: METRIC_KEYS.map((key) => round(score.chunk[key])),
    page: METRIC_KEYS.map((key) => round(score.page[key])),
  };
}

function fromBaselineQuery(queryId: string, entry: BaselineQuery): QueryScore {
  const metrics = (values: number[]) =>
    Object.fromEntries(
      METRIC_KEYS.map((key, index) => [key, values[index] ?? 0]),
    ) as Metrics;
  return {
    queryId,
    chunkRank: entry.ranks[0],
    pageRank: entry.ranks[1],
    chunk: metrics(entry.chunk),
    page: metrics(entry.page),
  };
}

/** The checked-in baseline. */
export interface Baseline {
  snapshot: RunSnapshot;
  /** Readable overall numbers; comparisons recompute them from `queries`. */
  summary: Partial<Record<Mode, Record<Level, Aggregate>>>;
  queries: Partial<Record<Mode, Record<Level, Record<string, BaselineQuery>>>>;
}

/** A gated metric that dropped too far. */
export interface Regression {
  mode: Mode;
  level: Level;
  side: "chunk" | "page";
  metric: MetricKey;
  baseline: number;
  current: number;
}

/** A query whose chunk-level first rank moved. */
export interface RankChange {
  mode: Mode;
  level: Level;
  queryId: string;
  before: number | null;
  after: number | null;
}

/** The result of comparing a run with the baseline. */
export interface Comparison {
  status: "compared" | "no-baseline" | "config-mismatch";
  mismatches: string[];
  regressions: Regression[];
  rankChanges: RankChange[];
  /** Baseline numbers over the run's queries, per compared mode and level. */
  baselineSummary: Partial<Record<Mode, Record<Level, Aggregate>>>;
  /** Modes the run scored but could not compare, with the reason. */
  notCompared: { mode: Mode; reason: string }[];
}

/** SHA-256 of a file's bytes. */
export function fileSha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** Reads the baseline, or null when there is none. */
export function readBaseline(path: string): Baseline | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Baseline;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function scoredModes(run: RunResult): [Mode, Record<Level, QueryScore[]>][] {
  return MODES.flatMap((mode) => {
    const outcome = run.modes[mode];
    return outcome?.status === "scored" ? [[mode, outcome.levels]] : [];
  });
}

/** Snapshot differences that make every mode incomparable. */
function sharedMismatches(current: RunSnapshot, baseline: RunSnapshot): string[] {
  const mismatches: string[] = [];
  if (current.corpusSha256 !== baseline.corpusSha256)
    mismatches.push("corpus.yaml changed");
  if (current.goldenSha256 !== baseline.goldenSha256)
    mismatches.push("golden.yaml changed");
  if (JSON.stringify(current.search) !== JSON.stringify(baseline.search)) {
    mismatches.push(
      `search settings differ: ${JSON.stringify(current.search)} vs ${JSON.stringify(baseline.search)}`,
    );
  }
  if (current.resultLimit !== baseline.resultLimit) {
    mismatches.push(`result limit ${current.resultLimit} vs ${baseline.resultLimit}`);
  }
  return mismatches;
}

function embeddingMismatch(current: RunSnapshot, baseline: RunSnapshot): string | null {
  const model = (snapshot: RunSnapshot) =>
    snapshot.embeddingModel === null ? null : canonicalModelSpec(snapshot.embeddingModel);
  if (
    model(current) === model(baseline) &&
    current.vectorDimension === baseline.vectorDimension
  ) {
    return null;
  }
  return `embedding model ${current.embeddingModel} (${current.vectorDimension}) vs ${baseline.embeddingModel} (${baseline.vectorDimension})`;
}

/**
 * Compares a run with the baseline over the queries the run scored.
 *
 * Full-text scores are compared whatever embedding model the run used; vector
 * and hybrid scores only when the embedding model matches.
 *
 * @param run The finished run.
 * @param baseline The checked-in baseline, or null.
 */
export function compareWithBaseline(
  run: RunResult,
  baseline: Baseline | null,
): Comparison {
  const comparison: Comparison = {
    status: "compared",
    mismatches: [],
    regressions: [],
    rankChanges: [],
    baselineSummary: {},
    notCompared: [],
  };
  if (!baseline) return { ...comparison, status: "no-baseline" };

  comparison.mismatches = sharedMismatches(run.snapshot, baseline.snapshot);
  if (comparison.mismatches.length > 0)
    return { ...comparison, status: "config-mismatch" };

  const embedding = embeddingMismatch(run.snapshot, baseline.snapshot);
  for (const [mode, levels] of scoredModes(run)) {
    if (mode !== "fts" && embedding) {
      comparison.notCompared.push({ mode, reason: embedding });
      continue;
    }
    const recorded = baseline.queries[mode];
    if (!recorded) {
      comparison.notCompared.push({ mode, reason: "not in the baseline" });
      continue;
    }
    const summaries = {} as Record<Level, Aggregate>;
    for (const level of LEVELS) {
      const before = run.queries.map((query) => recorded[level][query.id]);
      if (before.some((entry) => entry === undefined)) {
        comparison.notCompared.push({
          mode,
          reason: `queries missing at ${level} level`,
        });
        continue;
      }
      const baselineScores = run.queries.map((query, index) =>
        fromBaselineQuery(query.id, before[index] as BaselineQuery),
      );
      const baselineAggregate = average(baselineScores);
      const currentAggregate = average(levels[level]);
      summaries[level] = baselineAggregate;
      for (const side of ["chunk", "page"] as const) {
        for (const metric of GATED_METRICS) {
          const previous = baselineAggregate[side][metric];
          const current = currentAggregate[side][metric];
          if (current < previous - TOLERANCE - 1e-9) {
            comparison.regressions.push({
              mode,
              level,
              side,
              metric,
              baseline: previous,
              current,
            });
          }
        }
      }
      for (const score of levels[level]) {
        const previous = recorded[level][score.queryId]?.ranks[0] ?? null;
        if (previous !== score.chunkRank) {
          comparison.rankChanges.push({
            mode,
            level,
            queryId: score.queryId,
            before: previous,
            after: score.chunkRank,
          });
        }
      }
    }
    comparison.baselineSummary[mode] = summaries;
  }
  return comparison;
}

/**
 * Builds the baseline from a run over the full golden set.
 *
 * Modes the run did not score keep their previous entries when the shared
 * snapshot is unchanged and, for the vector and hybrid modes, the run used the
 * same embedding model or none at all; otherwise they are dropped.
 *
 * @param run A run over every golden query.
 * @param previous The current baseline, or null.
 */
export function buildBaseline(run: RunResult, previous: Baseline | null): Baseline {
  const keepPrevious =
    previous !== null && sharedMismatches(run.snapshot, previous.snapshot).length === 0;
  const baseline: Baseline = {
    snapshot: { ...run.snapshot },
    summary: {},
    queries: {},
  };
  for (const mode of MODES) {
    const outcome = run.modes[mode];
    if (outcome?.status === "scored") {
      baseline.summary[mode] = {} as Record<Level, Aggregate>;
      baseline.queries[mode] = {} as Record<Level, Record<string, BaselineQuery>>;
      for (const level of LEVELS) {
        (baseline.summary[mode] as Record<Level, Aggregate>)[level] = roundAggregate(
          average(outcome.levels[level]),
        );
        (baseline.queries[mode] as Record<Level, Record<string, BaselineQuery>>)[level] =
          Object.fromEntries(
            outcome.levels[level].map((score) => [score.queryId, toBaselineQuery(score)]),
          );
      }
    } else if (
      keepPrevious &&
      previous?.queries[mode] &&
      (mode === "fts" ||
        run.snapshot.embeddingModel === null ||
        embeddingMismatch(run.snapshot, previous.snapshot) === null)
    ) {
      baseline.summary[mode] = previous.summary[mode];
      baseline.queries[mode] = previous.queries[mode];
      if (mode !== "fts" && baseline.snapshot.embeddingModel === null) {
        baseline.snapshot.embeddingModel = previous.snapshot.embeddingModel;
        baseline.snapshot.vectorDimension = previous.snapshot.vectorDimension;
      }
    }
  }
  return baseline;
}

/**
 * Writes the baseline as JSON with one line per query, so a refresh shows as
 * one changed line per query whose scores moved.
 *
 * @param baseline The baseline to write.
 */
export function serializeBaseline(baseline: Baseline): string {
  const modes = MODES.flatMap((mode) => {
    const levels = baseline.queries[mode];
    if (!levels) return [];
    const levelBlocks = LEVELS.map((level) => {
      const entries = Object.entries(levels[level]).map(
        ([queryId, entry]) =>
          `        ${JSON.stringify(queryId)}: ${JSON.stringify(entry)}`,
      );
      return `      ${JSON.stringify(level)}: {\n${entries.join(",\n")}\n      }`;
    });
    return [`    ${JSON.stringify(mode)}: {\n${levelBlocks.join(",\n")}\n    }`];
  });
  const head = JSON.stringify(
    { snapshot: baseline.snapshot, summary: baseline.summary },
    null,
    2,
  );
  return `${head.slice(0, -2)},\n  "queries": {\n${modes.join(",\n")}\n  }\n}\n`;
}

function roundMetrics(metrics: Metrics): Metrics {
  return Object.fromEntries(
    METRIC_KEYS.map((key) => [key, round(metrics[key])]),
  ) as Metrics;
}

function roundAggregate(value: Aggregate): Aggregate {
  return { ...value, chunk: roundMetrics(value.chunk), page: roundMetrics(value.page) };
}

const fmt = (value: number) => value.toFixed(3);
const fmtRank = (rank: number | null) => (rank === null ? "miss" : String(rank));
const fmtDelta = (current: number, previous: number | undefined) => {
  if (previous === undefined) return "";
  const delta = current - previous;
  if (Math.abs(delta) < 0.0005) return " (±0)";
  return ` (${delta > 0 ? "+" : ""}${delta.toFixed(3)})`;
};

/**
 * The summary table printed after every run.
 *
 * @param run The finished run.
 * @param comparison Its comparison with the baseline.
 * @param baselineWritten Where a refresh wrote the baseline; replaces the verdict.
 */
export function renderSummary(
  run: RunResult,
  comparison: Comparison,
  baselineWritten?: string,
): string {
  const lines = [
    "| Mode | Level | Chunk MRR | Chunk Hit@1 | Chunk Hit@5 | Chunk nDCG@10 | Chunk misses | Page MRR | Page Hit@5 | Page nDCG@10 |",
    "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|",
  ];
  for (const mode of MODES) {
    const outcome = run.modes[mode];
    if (!outcome) continue;
    if (outcome.status === "skipped") {
      lines.push(`| ${mode} | — | skipped: ${outcome.reason} | | | | | | | |`);
      continue;
    }
    for (const level of LEVELS) {
      const current = average(outcome.levels[level]);
      const before = comparison.baselineSummary[mode]?.[level];
      lines.push(
        `| ${mode} | ${level} | ${fmt(current.chunk.mrr)}${fmtDelta(current.chunk.mrr, before?.chunk.mrr)} | ${fmt(current.chunk.hit_at_1)}${fmtDelta(current.chunk.hit_at_1, before?.chunk.hit_at_1)} | ${fmt(current.chunk.hit_at_5)}${fmtDelta(current.chunk.hit_at_5, before?.chunk.hit_at_5)} | ${fmt(current.chunk.ndcg_at_10)}${fmtDelta(current.chunk.ndcg_at_10, before?.chunk.ndcg_at_10)} | ${current.chunkMisses}/${current.queries} | ${fmt(current.page.mrr)}${fmtDelta(current.page.mrr, before?.page.mrr)} | ${fmt(current.page.hit_at_5)}${fmtDelta(current.page.hit_at_5, before?.page.hit_at_5)} | ${fmt(current.page.ndcg_at_10)}${fmtDelta(current.page.ndcg_at_10, before?.page.ndcg_at_10)} |`,
      );
    }
  }

  lines.push("", `Texts sent to the embedding provider: ${run.embeddingRequests}.`);
  if (baselineWritten) {
    lines.push(`Baseline written to ${baselineWritten}.`);
    return lines.join("\n");
  }
  switch (comparison.status) {
    case "no-baseline":
      lines.push(
        "No baseline yet. Record one with `npm run evaluate:accuracy:baseline`.",
      );
      break;
    case "config-mismatch":
      lines.push(
        "Not compared with the baseline; it was recorded with a different configuration:",
        ...comparison.mismatches.map((mismatch) => `- ${mismatch}`),
        "Refresh it with `npm run evaluate:accuracy:baseline`.",
      );
      break;
    case "compared":
      lines.push(
        comparison.regressions.length === 0
          ? `No metric dropped by more than ${TOLERANCE}. ${comparison.rankChanges.length} first-rank change(s).`
          : `${comparison.regressions.length} regression(s) beyond ${TOLERANCE}:`,
        ...comparison.regressions.map(
          (regression) =>
            `- ${regression.mode} ${regression.level} ${regression.side} ${regression.metric}: ${fmt(regression.baseline)} → ${fmt(regression.current)}`,
        ),
      );
      if (comparison.notCompared.length > 0) {
        lines.push(
          `${comparison.notCompared.length} mode(s) could not be compared with the baseline, which fails the run:`,
          ...comparison.notCompared.map((entry) => `- ${entry.mode}: ${entry.reason}`),
          "Refresh the baseline, or limit the run with DOCS_ACCURACY_MODES.",
        );
      }
      break;
  }
  return lines.join("\n");
}

/**
 * The full Markdown report: summary, rank changes, breakdowns and split passages.
 *
 * @param run The finished run.
 * @param comparison Its comparison with the baseline.
 */
export function renderReport(run: RunResult, comparison: Comparison): string {
  const byId = new Map(run.queries.map((query) => [query.id, query]));
  const sections = [
    "# Search accuracy",
    "",
    `Queries: ${run.queries.length}. Embedding model: ${run.snapshot.embeddingModel ?? "none"}. Texts sent to the embedding provider: ${run.embeddingRequests}.`,
    "",
    renderSummary(run, comparison),
  ];

  if (comparison.rankChanges.length > 0) {
    sections.push(
      "",
      "## First-rank changes (chunk level)",
      "",
      "| Mode | Level | Query | Before | After |",
      "|---|---|---|---:|---:|",
      ...comparison.rankChanges.map(
        (change) =>
          `| ${change.mode} | ${change.level} | ${change.queryId}: ${byId.get(change.queryId)?.query ?? ""} | ${fmtRank(change.before)} | ${fmtRank(change.after)} |`,
      ),
    );
  }

  for (const [mode, levels] of scoredModes(run)) {
    for (const level of LEVELS) {
      const breakdown = aggregate(levels[level], run.queries);
      sections.push(
        "",
        `## ${mode}, ${level} level: breakdown`,
        "",
        "| Group | Queries | Chunk MRR | Chunk Hit@5 | Chunk misses | Page Hit@5 |",
        "|---|---:|---:|---:|---:|---:|",
      );
      for (const [label, groups] of [
        ["library", breakdown.byLibrary],
        ["intent", breakdown.byIntent],
        ["style", breakdown.byStyle],
      ] as const) {
        for (const [name, group] of Object.entries(groups)) {
          sections.push(
            `| ${label}: ${name} | ${group.queries} | ${fmt(group.chunk.mrr)} | ${fmt(group.chunk.hit_at_5)} | ${group.chunkMisses} | ${fmt(group.page.hit_at_5)} |`,
          );
        }
      }
    }
  }

  if (run.passages.split.length > 0) {
    sections.push(
      "",
      "## Golden passages the splitter cut across chunks",
      "",
      ...run.passages.split.map(
        (entry) => `- ${entry.queryId} \`${entry.page}\`: "${entry.text}"`,
      ),
    );
  }
  return `${sections.join("\n")}\n`;
}
