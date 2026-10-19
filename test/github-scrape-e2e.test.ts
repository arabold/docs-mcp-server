/**
 * End-to-end tests for scraping GitHub repositories on mock sites.
 *
 * GitHub is three sites to the scraper: the REST API lists a repository's
 * files, raw.githubusercontent.com serves their content, and github.com serves
 * the wiki. Each is a mock site with only the routes a test expects, so a
 * request outside them fails the test as unmatched.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PipelineJobStatus } from "../src/pipeline/types";
import { PageOutcome } from "../src/scraper/types";
import { mockSite } from "./mock-site";
import { usePipelineHarness } from "./pipeline-harness";

const LIBRARY = "github-lib";
const VERSION = "1.0.0";
const REPO_URL = "https://github.com/owner/repo";

describe("GitHub scraping E2E", () => {
  const api = mockSite("https://api.github.com");
  const raw = mockSite("https://raw.githubusercontent.com");
  const web = mockSite("https://github.com");
  const h = usePipelineHarness({ library: LIBRARY, version: VERSION });

  beforeEach(() => {
    // A token in the environment keeps the strategy from asking the local gh
    // CLI for one, on the scrape and on a refresh alike.
    vi.stubEnv("GITHUB_TOKEN", "test-token");
    vi.stubEnv("GH_TOKEN", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("a single-file blob URL", () => {
    const FILE_URL = `${REPO_URL}/blob/main/docs/guide.md`;
    const RAW_PATH = "/owner/repo/main/docs/guide.md";

    beforeEach(() => {
      raw.page(RAW_PATH, "# Guide\n\nHow to use the library.", {
        type: "text/plain",
        etag: '"v1"',
      });
    });

    it("stores exactly that file with its content", async () => {
      // No API or wiki route: discovering the repository would fail the test.
      const job = await h.scrape({ url: FILE_URL });

      expect(job.status).toBe(PipelineJobStatus.COMPLETED);
      expect(await h.storedUrls()).toEqual([FILE_URL]);
      expect(await h.contentOf(FILE_URL)).toContain("How to use the library.");
      expect(raw.requestsTo(RAW_PATH)).toHaveLength(1);
    });

    it("refreshes the file with its stored ETag", async () => {
      await h.scrape({ url: FILE_URL });

      const job = await h.refresh();

      expect(job.status).toBe(PipelineJobStatus.COMPLETED);
      expect(raw.requestsTo(RAW_PATH).map((request) => request.ifNoneMatch)).toEqual([
        null,
        '"v1"',
      ]);
      expect(h.outcomeOf(FILE_URL)).toBe(PageOutcome.Unchanged);
      expect(await h.storedUrls()).toEqual([FILE_URL]);
    });
  });
});
