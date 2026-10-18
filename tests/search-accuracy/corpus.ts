/**
 * Corpus of the search accuracy benchmark: the pinned manifest and the local
 * checkouts it describes.
 *
 * Each source is fetched once with a shallow, blobless, sparse `git` checkout
 * of its pinned commit, so only the documentation files are downloaded. A
 * checkout is reused for as long as its directory holds the revision marker
 * written after a successful checkout.
 */

import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { parse } from "yaml";

const execFileAsync = promisify(execFile);

/** Marker written into a checkout once its revision is fully checked out. */
const REVISION_MARKER = ".accuracy-revision";

/** One documentation source of the corpus, pinned to a commit. */
export interface CorpusSource {
  /** Library name the source is indexed under. */
  library: string;
  /** HTTPS URL of the git repository. */
  repository: string;
  /** Full commit SHA. */
  revision: string;
  /** Directory inside the repository that is indexed as the library. */
  root: string;
  /** Patterns relative to `root`, in gitignore syntax; a leading "!" excludes. */
  include: string[];
  /** SPDX identifier of the documentation's license. */
  license: string;
}

/** A source checked out on disk. */
export interface CorpusCheckout {
  source: CorpusSource;
  /** Absolute path of the source's `root` directory. */
  directory: string;
}

/** Thrown when a source cannot be fetched at its pinned revision. */
export class CorpusFetchError extends Error {
  constructor(
    readonly library: string,
    readonly revision: string,
    cause: unknown,
  ) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`Cannot fetch corpus source "${library}" at ${revision}: ${detail}`, { cause });
    this.name = "CorpusFetchError";
  }
}

/**
 * Reads and checks the corpus manifest.
 *
 * @param manifestPath Path of `corpus.yaml`.
 * @returns The sources in manifest order.
 * @throws Error listing every missing or malformed field.
 */
export function loadCorpusManifest(manifestPath: string): CorpusSource[] {
  const raw = parse(readFileSync(manifestPath, "utf8")) as { sources?: unknown };
  if (!Array.isArray(raw?.sources) || raw.sources.length === 0) {
    throw new Error(`${manifestPath}: "sources" must be a non-empty list`);
  }

  const problems: string[] = [];
  const libraries = new Set<string>();
  const sources = raw.sources.map((entry: Partial<CorpusSource>, index: number) => {
    const where = `sources[${index}]${entry?.library ? ` (${entry.library})` : ""}`;
    for (const field of [
      "library",
      "repository",
      "revision",
      "root",
      "license",
    ] as const) {
      if (typeof entry?.[field] !== "string" || entry[field] === "") {
        problems.push(`${where}: "${field}" must be a non-empty string`);
      }
    }
    if (typeof entry?.revision === "string" && !/^[0-9a-f]{40}$/.test(entry.revision)) {
      problems.push(`${where}: "revision" must be a full 40-character commit SHA`);
    }
    if (
      !Array.isArray(entry?.include) ||
      !entry.include.some(
        (pattern) => typeof pattern === "string" && !pattern.startsWith("!"),
      )
    ) {
      problems.push(`${where}: "include" must list at least one pattern that is not "!"`);
    }
    if (typeof entry?.library === "string") {
      if (libraries.has(entry.library)) problems.push(`${where}: duplicate library`);
      libraries.add(entry.library);
    }
    return entry as CorpusSource;
  });

  if (problems.length > 0) {
    throw new Error(`${manifestPath} is invalid:\n  ${problems.join("\n  ")}`);
  }
  return sources;
}

/**
 * Makes sure every source is checked out at its pinned revision.
 *
 * Sources already checked out are reused without touching the network.
 *
 * @param sources The corpus sources.
 * @param cacheDir Directory holding the checkouts (`<library>@<revision>`).
 * @returns One checkout per source, in the same order.
 * @throws CorpusFetchError when `git` cannot fetch or check out a source.
 */
export async function ensureCorpus(
  sources: CorpusSource[],
  cacheDir: string,
): Promise<CorpusCheckout[]> {
  mkdirSync(cacheDir, { recursive: true });
  const checkouts: CorpusCheckout[] = [];
  for (const source of sources) {
    const checkoutDir = path.join(cacheDir, `${source.library}@${source.revision}`);
    if (!isCheckedOut(checkoutDir, source.revision)) {
      await checkOut(source, checkoutDir);
    }
    checkouts.push({ source, directory: path.join(checkoutDir, source.root) });
  }
  return checkouts;
}

function isCheckedOut(checkoutDir: string, revision: string): boolean {
  const marker = path.join(checkoutDir, REVISION_MARKER);
  return existsSync(marker) && readFileSync(marker, "utf8").trim() === revision;
}

/** Sparse patterns for `git sparse-checkout set --no-cone`, anchored at the repository root. */
function sparsePatterns(source: CorpusSource): string[] {
  const root = source.root.replace(/^\/+|\/+$/g, "");
  return source.include.map((pattern) =>
    pattern.startsWith("!") ? `!/${root}/${pattern.slice(1)}` : `/${root}/${pattern}`,
  );
}

async function checkOut(source: CorpusSource, checkoutDir: string): Promise<void> {
  rmSync(checkoutDir, { recursive: true, force: true });
  mkdirSync(checkoutDir, { recursive: true });
  const git = (...args: string[]) =>
    execFileAsync("git", ["-C", checkoutDir, ...args], { maxBuffer: 16 * 1024 * 1024 });
  try {
    await git("init", "--quiet");
    await git("remote", "add", "origin", source.repository);
    await git("sparse-checkout", "set", "--no-cone", ...sparsePatterns(source));
    await git(
      "fetch",
      "--quiet",
      "--depth",
      "1",
      "--filter=blob:none",
      "origin",
      source.revision,
    );
    await git("checkout", "--quiet", source.revision);
  } catch (error) {
    rmSync(checkoutDir, { recursive: true, force: true });
    throw new CorpusFetchError(source.library, source.revision, error);
  }
  if (!existsSync(path.join(checkoutDir, source.root))) {
    rmSync(checkoutDir, { recursive: true, force: true });
    throw new CorpusFetchError(
      source.library,
      source.revision,
      new Error(`"${source.root}" does not exist at this revision`),
    );
  }
  writeFileSync(path.join(checkoutDir, REVISION_MARKER), `${source.revision}\n`);
}
