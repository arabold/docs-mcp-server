/**
 * Live end-to-end tests for scraping GitHub, against this project's own
 * repository.
 *
 * They read the real GitHub API, raw file content and github.com, so they catch
 * changes on GitHub's side that the mock sites in `github-scrape-e2e.test.ts`
 * cannot. Include patterns and page limits keep each scrape to a few files.
 *
 * Excluded from the default test run; run them with `npm run test:live`.
 * Without GITHUB_TOKEN or GH_TOKEN the strategy asks the gh CLI for a token,
 * and without one GitHub allows 60 API requests an hour, which these tests stay
 * well under.
 */

import { describe, expect, it } from "vitest";
import { PipelineJobStatus } from "../src/pipeline/types";
import { usePipelineHarness } from "./pipeline-harness";

const LIBRARY = "docs-mcp-server";
const VERSION = "1.0.0";
const REPO_URL = "https://github.com/arabold/docs-mcp-server";
const README_URL = `${REPO_URL}/blob/main/README.md`;

describe("GitHub scraping live", () => {
  const h = usePipelineHarness({
    library: LIBRARY,
    version: VERSION,
    defaults: { includePatterns: ["**/README.md"] },
  });

  /** Lists the stored pages the way a client sees them. */
  async function listedUrls(): Promise<string[]> {
    const { pages } = await h.docService.listPages(LIBRARY, VERSION);
    return pages.map((page) => page.url).sort();
  }

  it("stores a repository's files, not the repository URL", async () => {
    const job = await h.scrape({ url: REPO_URL });

    expect(job.status).toBe(PipelineJobStatus.COMPLETED);
    const urls = await listedUrls();
    expect(urls).toContain(README_URL);
    expect(urls.filter((url) => !url.startsWith(`${REPO_URL}/blob/main/`))).toEqual([]);
    expect(await h.contentOf(README_URL)).toContain("docs-mcp-server");
  }, 120_000);

  it("stores the files of a branch tree URL", async () => {
    const job = await h.scrape({ url: `${REPO_URL}/tree/main` });

    expect(job.status).toBe(PipelineJobStatus.COMPLETED);
    const urls = await listedUrls();
    expect(urls).toContain(README_URL);
    expect(urls.filter((url) => !url.startsWith(`${REPO_URL}/blob/main/`))).toEqual([]);
  }, 120_000);

  it("stores no wiki page for a repository without a wiki", async () => {
    // The repository has its wiki turned off, so github.com redirects the wiki
    // URL to the repository page. The wiki URL is the first link discovery
    // returns, so a budget of two pages reaches it before most files.
    const job = await h.scrape({ url: REPO_URL, includePatterns: [], maxPages: 2 });

    expect(job.status).toBe(PipelineJobStatus.COMPLETED);
    const urls = await listedUrls();
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.filter((url) => !url.startsWith(`${REPO_URL}/blob/main/`))).toEqual([]);
  }, 120_000);
});
