/**
 * Live end-to-end tests for scraping GitHub, against this project's own
 * repository.
 *
 * They read the real GitHub API, raw file content and github.com, so they catch
 * changes on GitHub's side that the mock sites in `github-scrape-e2e.test.ts`
 * cannot. Include patterns keep each scrape to a few files.
 *
 * Excluded from the default test run; run them with `npm run test:live`.
 * Without GITHUB_TOKEN or GH_TOKEN the strategy asks the gh CLI for a token,
 * and without one GitHub allows 60 API requests an hour, which these tests stay
 * well under.
 */

import { describe, expect, it } from "vitest";
import { PipelineJobStatus } from "../src/pipeline/types";
import { PageOutcome } from "../src/scraper/types";
import { usePipelineHarness } from "./pipeline-harness";

const LIBRARY = "docs-mcp-server";
const VERSION = "1.0.0";
const REPO_URL = "https://github.com/arabold/docs-mcp-server";
const README_URL = `${REPO_URL}/blob/main/README.md`;
const WIKI_URL = `${REPO_URL}/wiki`;

describe("GitHub scraping live", () => {
  const h = usePipelineHarness({ library: LIBRARY, version: VERSION });

  it("stores only the repository's files, whatever URL the scrape starts from", async () => {
    for (const url of [REPO_URL, `${REPO_URL}/tree/main`]) {
      const job = await h.scrape(
        // The wiki pattern makes each scrape ask for the wiki URL. The
        // repository has its wiki turned off, so GitHub redirects that URL to
        // the repository page, which must not be stored.
        { url, includePatterns: ["**/README.md", "**/wiki"] },
        { onExisting: "replace" },
      );

      expect.soft(job.status, url).toBe(PipelineJobStatus.COMPLETED);
      expect.soft(h.outcomeOf(WIKI_URL), url).toBe(PageOutcome.Absent);
      const { pages } = await h.docService.listPages(LIBRARY, VERSION);
      const urls = pages.map((page) => page.url);
      expect.soft(urls, url).toContain(README_URL);
      expect
        .soft(
          urls.filter((stored) => !stored.startsWith(`${REPO_URL}/blob/main/`)),
          url,
        )
        .toEqual([]);
      expect.soft(await h.contentOf(README_URL), url).toContain("docs-mcp-server");
    }
  }, 120_000);
});
