/**
 * Where the search accuracy benchmark keeps its inputs, cache and results.
 *
 * The cache defaults to `.cache/search-accuracy/` under the directory the
 * benchmark runs from (the repository root); `DOCS_ACCURACY_CACHE_DIR`
 * moves it, for example to share one cache between worktrees.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Checked-in inputs and outputs of the benchmark. */
export const MANIFEST_PATH = path.join(HERE, "corpus.yaml");
export const GOLDEN_PATH = path.join(HERE, "golden.yaml");
export const BASELINE_PATH = path.join(HERE, "baseline.json");
export const RESULTS_DIR = path.join(HERE, "results");

/** Root of the benchmark's cache. */
export function cacheDir(): string {
  return path.resolve(
    process.env.DOCS_ACCURACY_CACHE_DIR ??
      path.join(process.cwd(), ".cache", "search-accuracy"),
  );
}

/** Corpus checkouts, embedding cache files and the indexed store. */
export function cachePaths() {
  const root = cacheDir();
  return {
    corpus: path.join(root, "corpus"),
    embeddings: path.join(root, "embeddings"),
    store: path.join(root, "store"),
  };
}
