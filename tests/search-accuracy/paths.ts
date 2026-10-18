/**
 * Where the search accuracy benchmark keeps its inputs, cache and results.
 *
 * The cache defaults to `.cache/search-accuracy/` under the directory the
 * benchmark runs from (the repository root); `DOCS_ACCURACY_CACHE_DIR`
 * moves it, for example to share one cache between worktrees.
 */

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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

/**
 * Where the corpus appears to live in indexed URLs and embedding inputs, so
 * neither depends on the machine or cache directory the benchmark runs in.
 */
export const STABLE_CORPUS_URL = "file:///corpus";

/**
 * Rewrites the corpus directory's file URL in a text to {@link STABLE_CORPUS_URL}.
 *
 * @param corpusDir Directory holding the corpus checkouts.
 * @returns A function rewriting every occurrence in a text.
 */
export function stableCorpusText(corpusDir: string): (text: string) => string {
  const actual = pathToFileURL(corpusDir).href;
  return (text) => text.split(actual).join(STABLE_CORPUS_URL);
}
