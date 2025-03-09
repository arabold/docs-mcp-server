#!/usr/bin/env node
import "dotenv/config";
import { Command } from "commander";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { VectorStoreManager } from "./store/index.js";
import type { VectorStoreProgress } from "./types/index.js";
import type { DocContent } from "./types/index.js";
import { findVersion, listLibraries } from "./tools/library.js";
import { search } from "./tools/search.js";
import { scrape } from "./tools/scrape.js";

const formatOutput = (data: unknown) => JSON.stringify(data, null, 2);

const program = new Command();

// Use the same data directory as the MCP server
const baseDir = path.join(os.homedir(), ".docs-mcp", "data");

// Initialize the store manager
const store = new VectorStoreManager(baseDir, {
  onProgress: (progress: VectorStoreProgress) => {
    console.log(
      `Processing document ${progress.documentsProcessed}/${progress.totalDocuments}: "${progress.currentDocument.title}" (${progress.currentDocument.numChunks} chunks)`
    );
  },
});

program
  .name("docs-mcp")
  .description("CLI for managing documentation vector store")
  .version("1.0.0");

program
  .command("scrape <library> <version> <url>")
  .description("Scrape and index documentation from a URL")
  .option("-p, --max-pages <number>", "Maximum pages to scrape", "100")
  .option("-d, --max-depth <number>", "Maximum navigation depth", "3")
  .option(
    "--subpages-only",
    "Allow scraping pages outside the initial URL path",
    true
  )
  .action(async (library, version, url, options) => {
    try {
      const result = await scrape({
        url,
        library,
        version,
        maxPages: Number.parseInt(options.maxPages),
        maxDepth: Number.parseInt(options.maxDepth),
        subpagesOnly: options.subpagesOnly,
        store,
        onProgress: (progress) => {
          console.log(
            `Scraping page ${progress.pagesScraped}/${options.maxPages} (depth ${progress.depth}/${options.maxDepth}): ${progress.currentUrl}`
          );
          return undefined;
        },
      });

      console.log(
        `Successfully scraped ${result.pagesScraped} pages and indexed ${result.documentsIndexed} documents`
      );
    } catch (error: unknown) {
      console.error(
        "Error:",
        error instanceof Error ? error.message : String(error)
      );
      process.exit(1);
    }
  });

program
  .command("search <library> <version> <query>")
  .description("Search documents in a library")
  .option("-l, --limit <number>", "Maximum number of results", "5")
  .action(async (library, version, query, options) => {
    try {
      const result = await search({
        library,
        version,
        query,
        limit: Number.parseInt(options.limit),
        store,
      });
      console.log(formatOutput(result.results));
    } catch (error: unknown) {
      console.error(
        "Error:",
        error instanceof Error ? error.message : String(error)
      );
      process.exit(1);
    }
  });

program
  .command("list-libraries")
  .description("List all available libraries and their versions")
  .action(async () => {
    try {
      const result = await listLibraries({ store });
      console.log(formatOutput(result.libraries));
    } catch (error: unknown) {
      console.error(
        "Error:",
        error instanceof Error ? error.message : String(error)
      );
      process.exit(1);
    }
  });

program
  .command("find-version <library> [targetVersion]")
  .description("Find the best matching version for a library")
  .action(async (library, targetVersion) => {
    try {
      const version = await findVersion({ store, library, targetVersion });
      if (version) {
        console.log(version);
      } else {
        console.error("No matching version found");
        process.exit(1);
      }
    } catch (error: unknown) {
      console.error(
        "Error:",
        error instanceof Error ? error.message : String(error)
      );
      process.exit(1);
    }
  });

program.parse();
