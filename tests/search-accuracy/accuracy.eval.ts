/**
 * Search accuracy benchmark.
 *
 * Fetches the pinned corpus, indexes it through the real pipeline, checks that
 * every golden passage is in the index, scores each golden query in every
 * mode at store and final level, and compares the result with the baseline.
 * See README.md in this directory.
 *
 * Run with `npm run evaluate:accuracy`; `npm run evaluate:accuracy:baseline`
 * rewrites the baseline instead of comparing with it.
 */

import "dotenv/config";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../../src/utils/config";
import {
  buildBaseline,
  compareWithBaseline,
  fileSha256,
  type RunResult,
  readBaseline,
  renderReport,
  renderSummary,
  serializeBaseline,
} from "./baseline";
import { ensureCorpus, loadCorpusManifest } from "./corpus";
import { canonicalModelSpec, sharedEmbeddingCacheStats } from "./embedding-cache";
import {
  evaluateMode,
  MODES,
  type Mode,
  RESULT_LIMIT,
  validatePassages,
} from "./evaluate";
import { loadGoldenSet } from "./golden";
import { benchmarkConfig, indexCorpus } from "./index-corpus";
import {
  BASELINE_PATH,
  cachePaths,
  GOLDEN_PATH,
  MANIFEST_PATH,
  RESULTS_DIR,
} from "./paths";

vi.mock("../../src/store/embeddings/EmbeddingFactory", async (importOriginal) => {
  const { withEmbeddingCache } = await import("./embedding-cache");
  const { cachePaths, stableCorpusText } = await import("./paths");
  const { corpus, embeddings } = cachePaths();
  return withEmbeddingCache(await importOriginal(), embeddings, stableCorpusText(corpus));
});

/** Prints a line; the default reporter drops `console.log` output of passing tests. */
function print(text: string): void {
  process.stdout.write(`${text}\n`);
}

/** Values of a comma-separated option, or undefined when it is not set. */
function listOption(name: string): string[] | undefined {
  const value = process.env[name]?.trim();
  return value ? value.split(",").map((entry) => entry.trim()) : undefined;
}

describe("search accuracy", () => {
  it("ranks the golden passages at least as well as the baseline", async () => {
    const refreshBaseline = import.meta.env.MODE === "baseline";
    const modes = (listOption("DOCS_ACCURACY_MODES") ?? [...MODES]) as Mode[];
    const unknownModes = modes.filter((mode) => !MODES.includes(mode));
    if (unknownModes.length > 0) {
      throw new Error(`Unknown DOCS_ACCURACY_MODES: ${unknownModes.join(", ")}`);
    }

    // Inputs first, so a malformed manifest or golden set fails before any download
    const sources = loadCorpusManifest(MANIFEST_PATH);
    const golden = loadGoldenSet(
      GOLDEN_PATH,
      sources.map((source) => source.library),
    );
    const libraries = listOption("DOCS_ACCURACY_LIBRARIES");
    const unknownLibraries = (libraries ?? []).filter(
      (library) => !sources.some((source) => source.library === library),
    );
    if (unknownLibraries.length > 0) {
      throw new Error(`Unknown DOCS_ACCURACY_LIBRARIES: ${unknownLibraries.join(", ")}`);
    }
    if (refreshBaseline && libraries) {
      throw new Error("The baseline covers every library; unset DOCS_ACCURACY_LIBRARIES");
    }
    const queries = golden.queries.filter(
      (query) => !libraries || libraries.includes(query.library),
    );

    const paths = cachePaths();
    const checkouts = await ensureCorpus(sources, paths.corpus);
    const config = benchmarkConfig(loadConfig(), paths.store, paths.corpus);
    const dbPath = path.join(paths.store, "documents.db");
    const reuseIndex =
      process.env.DOCS_ACCURACY_REUSE_INDEX === "1" && existsSync(dbPath);
    if (!reuseIndex) {
      const started = Date.now();
      print(`Indexing ${checkouts.length} libraries…`);
      await indexCorpus(checkouts, paths.corpus, config);
      print(`Indexed in ${Math.round((Date.now() - started) / 1000)} s`);
    }

    const passages = validatePassages(dbPath, queries);

    const run: RunResult = {
      snapshot: {
        corpusSha256: fileSha256(MANIFEST_PATH),
        goldenSha256: fileSha256(GOLDEN_PATH),
        embeddingModel: null,
        vectorDimension: config.embeddings.vectorDimension,
        search: config.search,
        resultLimit: RESULT_LIMIT,
      },
      queries,
      modes: {},
      passages,
      embeddingRequests: 0,
    };
    for (const mode of modes) {
      const outcome = await evaluateMode(mode, dbPath, queries, config);
      run.modes[mode] = outcome;
      if (mode !== "fts" && outcome.status === "scored") {
        run.snapshot.embeddingModel = canonicalModelSpec(config.app.embeddingModel);
      }
    }
    run.embeddingRequests = sharedEmbeddingCacheStats().misses;

    const previous = readBaseline(BASELINE_PATH);
    const comparison = compareWithBaseline(run, previous);
    mkdirSync(RESULTS_DIR, { recursive: true });
    writeFileSync(path.join(RESULTS_DIR, "report.md"), renderReport(run, comparison));
    writeFileSync(
      path.join(RESULTS_DIR, "run.json"),
      `${JSON.stringify(run, null, 2)}\n`,
    );

    if (refreshBaseline) {
      writeFileSync(BASELINE_PATH, serializeBaseline(buildBaseline(run, previous)));
      print(`\n${renderSummary(run, comparison, BASELINE_PATH)}`);
      return;
    }

    print(
      `\n${renderSummary(run, comparison)}\n\nFull report: ${path.join(RESULTS_DIR, "report.md")}`,
    );
    expect(comparison.status).toBe("compared");
    expect(comparison.notCompared).toEqual([]);
    expect(comparison.regressions).toEqual([]);
  });
});
