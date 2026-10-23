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
const WIKI_URL = `${REPO_URL}/wiki`;
const WIKI_HOME =
  '<html><head><title>Home · owner/repo Wiki · GitHub</title></head><body><p>Welcome to the wiki.</p></body></html>';

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

  /** Serves the default branch `main` with these files, each holding its own path. */
  function serveRepo(paths: string[]): void {
    api.page("/repos/owner/repo", JSON.stringify({ default_branch: "main" }), {
      type: "application/json",
    });
    serveBranch("main", paths);
  }

  /** Serves `branch` through the tree API and its files through raw content. */
  function serveBranch(branch: string, paths: string[]): void {
    const tree = paths.map((path) => ({ path, type: "blob", sha: path, url: "" }));
    api.page(
      `/repos/owner/repo/git/trees/${branch}?recursive=1`,
      JSON.stringify({ sha: "t", url: "", tree, truncated: false }),
      { type: "application/json" },
    );
    for (const path of paths) {
      raw.page(`/owner/repo/${branch}/${path}`, `# ${path}\n\nThe text of ${path}.`, {
        type: "text/plain",
      });
    }
  }

  /** Lists the stored pages the way a client sees them. */
  async function listedUrls(): Promise<string[]> {
    const { pages } = await h.docService.listPages(LIBRARY, VERSION);
    return pages.map((page) => page.url).sort();
  }

  /** Stores an empty page the way versions before containers were declared did. */
  async function storeLegacyEmptyPage(
    url: string,
    depth: number,
    etag: string | null = null,
  ): Promise<void> {
    await h.docService.addEmptyPage(LIBRARY, VERSION, depth, {
      url,
      title: "",
      sourceContentType: null,
      contentType: null,
      etag,
      lastModified: null,
    });
  }

  /** Sends the wiki URL to the repository page, as GitHub does when a repository has no wiki. */
  function serveNoWiki(): void {
    web
      .redirect("/owner/repo/wiki", "/owner/repo", 302)
      .page("/owner/repo", "<html><body><p>The repository page.</p></body></html>", {
        etag: '"repo"',
      });
  }

  it("stores only files and wiki pages, whatever URL the scrape starts from", async () => {
    const guide = `${REPO_URL}/blob/main/docs/guide.md`;
    const index = `${REPO_URL}/blob/main/src/index.ts`;
    const cases: Array<{
      label: string;
      url: string;
      serveWiki?: () => void;
      wikiOutcome?: PageOutcome;
      expected: string[];
    }> = [
      {
        label: "repository URL",
        url: REPO_URL,
        serveWiki: () => web.page("/owner/repo/wiki", WIKI_HOME),
        wikiOutcome: PageOutcome.Stored,
        expected: [guide, index, WIKI_URL],
      },
      {
        label: "branch tree URL",
        url: `${REPO_URL}/tree/main`,
        serveWiki: () => web.page("/owner/repo/wiki", WIKI_HOME),
        wikiOutcome: PageOutcome.Stored,
        expected: [guide, index, WIKI_URL],
      },
      {
        // The scrape is narrowed to a directory, so the wiki is never asked for.
        label: "directory tree URL",
        url: `${REPO_URL}/tree/main/docs`,
        expected: [guide],
      },
      {
        label: "repository without a wiki",
        url: REPO_URL,
        serveWiki: serveNoWiki,
        wikiOutcome: PageOutcome.Absent,
        expected: [guide, index],
      },
    ];

    for (const { label, url, serveWiki, wikiOutcome, expected } of cases) {
      for (const site of [api, raw, web]) site.reset();
      serveRepo(["docs/guide.md", "src/index.ts"]);
      serveWiki?.();

      const job = await h.scrape({ url }, { onExisting: "replace" });

      expect.soft(job.status, label).toBe(PipelineJobStatus.COMPLETED);
      expect.soft(h.outcomeOf(WIKI_URL), label).toBe(wikiOutcome);
      expect.soft(await listedUrls(), label).toEqual(expected);
    }
  });

  it("brings a refreshed repository to what a new scrape stores", async () => {
    const guide = `${REPO_URL}/blob/main/docs/guide.md`;
    serveRepo(["docs/guide.md"]);
    serveNoWiki();
    await h.scrape({ url: REPO_URL });
    // Rows older versions stored: the repository URL, the wiki URL appended to
    // a tree URL, and the repository page under the wiki URL with that page's
    // ETag, which the refresh sends through the redirect.
    await storeLegacyEmptyPage(REPO_URL, 0);
    await storeLegacyEmptyPage(`${REPO_URL}/tree/main/wiki`, 1);
    await storeLegacyEmptyPage(WIKI_URL, 1, '"repo"');
    expect(await listedUrls()).toEqual([
      REPO_URL,
      guide,
      `${REPO_URL}/tree/main/wiki`,
      WIKI_URL,
    ]);
    serveRepo(["docs/guide.md", "docs/new.md"]);

    const job = await h.refresh();

    expect(job.status).toBe(PipelineJobStatus.COMPLETED);
    expect(web.requestsTo("/owner/repo").at(-1)?.ifNoneMatch).toBe('"repo"');
    expect(await listedUrls()).toEqual([guide, `${REPO_URL}/blob/main/docs/new.md`]);
  });
});
