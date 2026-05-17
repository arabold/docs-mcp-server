/**
 * Load and validate the benchmark dataset.
 *
 * The dataset YAML is either:
 *   (a) the legacy promptfoo `tests:` format — a top-level array of entries
 *       with `vars: { library, query, intent, qrels }`, OR
 *   (b) the wrapped format used while the dataset is in `draft` status —
 *       `{ status, notes, entries: [ ... same shape ... ] }`.
 *
 * Promptfoo consumes (a) directly. The orchestrator/aggregator uses this
 * loader to validate before invoking promptfoo and to attach config metadata
 * to the summary.
 */

import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import {
  QUERY_INTENTS,
  type DatasetEntry,
  type DatasetFile,
  type QueryIntent,
} from "./types";

export class DatasetLoadError extends Error {}

export function loadDataset(filePath: string): DatasetFile {
  const raw = readFileSync(filePath, "utf8");
  const parsed = parseYaml(raw);

  let status: "draft" | "reviewed" = "reviewed";
  let notes: string | undefined;
  let rawEntries: unknown[];

  if (Array.isArray(parsed)) {
    rawEntries = parsed;
  } else if (parsed && typeof parsed === "object" && Array.isArray((parsed as any).entries)) {
    const obj = parsed as { status?: string; notes?: string; entries: unknown[] };
    if (obj.status === "draft" || obj.status === "reviewed") status = obj.status;
    notes = obj.notes;
    rawEntries = obj.entries;
  } else {
    throw new DatasetLoadError(
      `Dataset at ${filePath} is not a YAML array or an object with an 'entries' array.`,
    );
  }

  const entries = rawEntries.map((e, i) => validateEntry(e, i, filePath));
  enforceLibraryBalance(entries, filePath);

  return { status, notes, entries };
}

function validateEntry(raw: unknown, index: number, filePath: string): DatasetEntry {
  if (!raw || typeof raw !== "object") {
    throw new DatasetLoadError(`${filePath}[${index}]: entry is not an object.`);
  }
  const vars = (raw as any).vars;
  if (!vars || typeof vars !== "object") {
    throw new DatasetLoadError(`${filePath}[${index}]: missing 'vars' object.`);
  }
  const { library, query, intent, qrels } = vars as Record<string, unknown>;

  if (typeof library !== "string" || library.trim() === "") {
    throw new DatasetLoadError(`${filePath}[${index}]: 'library' must be a non-empty string.`);
  }
  if (typeof query !== "string" || query.trim() === "") {
    throw new DatasetLoadError(`${filePath}[${index}]: 'query' must be a non-empty string.`);
  }
  if (typeof intent !== "string" || !QUERY_INTENTS.includes(intent as QueryIntent)) {
    throw new DatasetLoadError(
      `${filePath}[${index}]: 'intent' must be one of ${QUERY_INTENTS.join(", ")} (got ${JSON.stringify(intent)}).`,
    );
  }
  if (!Array.isArray(qrels) || qrels.length === 0) {
    throw new DatasetLoadError(
      `${filePath}[${index}] (${library}: "${query}"): 'qrels' must be a non-empty array.`,
    );
  }
  const validatedQrels = qrels.map((q, qi) => validateQrel(q, qi, index, filePath));

  return {
    library,
    query,
    intent: intent as QueryIntent,
    qrels: validatedQrels,
  };
}

function validateQrel(raw: unknown, qi: number, ei: number, filePath: string) {
  if (!raw || typeof raw !== "object") {
    throw new DatasetLoadError(`${filePath}[${ei}].qrels[${qi}]: not an object.`);
  }
  const { url, grade } = raw as Record<string, unknown>;
  if (typeof url !== "string" || url.trim() === "") {
    throw new DatasetLoadError(
      `${filePath}[${ei}].qrels[${qi}]: 'url' must be a non-empty string.`,
    );
  }
  if (typeof grade !== "number" || !Number.isInteger(grade) || grade < 1) {
    throw new DatasetLoadError(
      `${filePath}[${ei}].qrels[${qi}]: 'grade' must be an integer >= 1.`,
    );
  }
  return { url, grade };
}

/**
 * Spec: no single library accounts for more than 50% of queries.
 */
function enforceLibraryBalance(entries: DatasetEntry[], filePath: string) {
  if (entries.length === 0) return;
  const counts = new Map<string, number>();
  for (const e of entries) counts.set(e.library, (counts.get(e.library) ?? 0) + 1);
  for (const [lib, n] of counts) {
    if (n / entries.length > 0.5) {
      throw new DatasetLoadError(
        `${filePath}: library "${lib}" accounts for ${n}/${entries.length} (${Math.round(
          (n / entries.length) * 100,
        )}%) of queries — must be ≤ 50%.`,
      );
    }
  }
}

export function uniqueLibraries(entries: DatasetEntry[]): string[] {
  return Array.from(new Set(entries.map((e) => e.library))).sort();
}
