/**
 * Preflight check: every library referenced in the dataset must be indexed
 * in the local store before the benchmark runs. On failure, print the exact
 * scrape command the operator needs and exit non-zero.
 */

import envPaths from "env-paths";
import { EventBusService } from "../../src/events/EventBusService";
import { createDocumentManagement } from "../../src/store";
import { loadConfig } from "../../src/utils/config";
import { LogLevel, setLogLevel } from "../../src/utils/logger";
import { loadDataset, uniqueLibraries } from "./loader";

export interface PreflightResult {
  ok: boolean;
  missing: string[];
}

/**
 * Returns the libraries from the dataset that are NOT indexed.
 * Caller is responsible for printing the human-readable error.
 */
export async function runPreflight(datasetPath: string): Promise<PreflightResult> {
  setLogLevel(LogLevel.ERROR);

  const dataset = loadDataset(datasetPath);
  const libraries = uniqueLibraries(dataset.entries);

  const appConfig = loadConfig();
  if (!appConfig.app.storePath) {
    const paths = envPaths("docs-mcp-server", { suffix: "" });
    appConfig.app.storePath = paths.data;
  }

  const eventBus = new EventBusService();
  const docService = await createDocumentManagement({ appConfig, eventBus });

  try {
    const missing: string[] = [];
    for (const library of libraries) {
      try {
        await docService.validateLibraryExists(library);
      } catch {
        missing.push(library);
      }
    }
    return { ok: missing.length === 0, missing };
  } finally {
    await docService.shutdown();
  }
}

export function scrapeCommandFor(library: string): string {
  // Mirrors the user-facing CLI. The exact source URL must be chosen by the
  // operator — the dataset cannot encode it because libraries may have moved
  // doc URLs between versions.
  return `npx docs-mcp-server scrape ${library} <docs-url>`;
}

/** CLI entry point used by tests/search-eval/cli/preflight.ts. */
export async function runPreflightCli(datasetPath?: string): Promise<void> {
  const path = datasetPath ?? process.argv[2] ?? "tests/search-eval/dataset.yaml";
  const result = await runPreflight(path);
  if (result.ok) {
    console.log(`✅ Preflight passed: all libraries indexed.`);
    return;
  }
  console.error(`❌ Preflight failed: missing libraries in store:`);
  for (const lib of result.missing) {
    console.error(`   - ${lib}    →    ${scrapeCommandFor(lib)}`);
  }
  process.exit(1);
}
