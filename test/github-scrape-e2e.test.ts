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

  describe("a repository URL", () => {
    beforeEach(() => {
      serveRepo(["docs/guide.md"]);
      web.page("/owner/repo/wiki", WIKI_HOME);
    });

    it("stores the files and wiki pages, not the repository URL", async () => {
      const job = await h.scrape({ url: REPO_URL });

      expect(job.status).toBe(PipelineJobStatus.COMPLETED);
      expect(await listedUrls()).toEqual([
        `${REPO_URL}/blob/main/docs/guide.md`,
        WIKI_URL,
      ]);
    });

    it("discovers files added since the scrape on refresh", async () => {
      await h.scrape({ url: REPO_URL });
      serveRepo(["docs/guide.md", "docs/new.md"]);

      const job = await h.refresh();

      expect(job.status).toBe(PipelineJobStatus.COMPLETED);
      expect(await listedUrls()).toEqual([
        `${REPO_URL}/blob/main/docs/guide.md`,
        `${REPO_URL}/blob/main/docs/new.md`,
        WIKI_URL,
      ]);
    });

    it("deletes the repository page an older version stored on refresh", async () => {
      await h.scrape({ url: REPO_URL });
      await storeLegacyEmptyPage(REPO_URL, 0);

      const job = await h.refresh();

      expect(job.status).toBe(PipelineJobStatus.COMPLETED);
      expect(await listedUrls()).toEqual([
        `${REPO_URL}/blob/main/docs/guide.md`,
        WIKI_URL,
      ]);
    });
  });

  describe("a branch tree URL", () => {
    const TREE_URL = `${REPO_URL}/tree/main`;

    beforeEach(() => {
      // The URL names the branch, so the strategy never asks for the default.
      serveBranch("main", ["docs/guide.md"]);
      web.page("/owner/repo/wiki", WIKI_HOME);
    });

    it("stores the branch's files and the repository's wiki", async () => {
      const job = await h.scrape({ url: TREE_URL });

      expect(job.status).toBe(PipelineJobStatus.COMPLETED);
      expect(await listedUrls()).toEqual([
        `${REPO_URL}/blob/main/docs/guide.md`,
        WIKI_URL,
      ]);
    });

    it("deletes the empty pages an older version stored on refresh", async () => {
      await h.scrape({ url: TREE_URL });
      await storeLegacyEmptyPage(TREE_URL, 0);
      await storeLegacyEmptyPage(`${TREE_URL}/wiki`, 1);

      const job = await h.refresh();

      expect(job.status).toBe(PipelineJobStatus.COMPLETED);
      expect(await listedUrls()).toEqual([
        `${REPO_URL}/blob/main/docs/guide.md`,
        WIKI_URL,
      ]);
    });
  });

  describe("a repository without a wiki", () => {
    beforeEach(() => {
      serveRepo(["docs/guide.md"]);
      // GitHub sends the wiki URL of a repository without a wiki to the
      // repository page.
      web
        .redirect("/owner/repo/wiki", "/owner/repo", 302)
        .page("/owner/repo", "<html><body><p>The repository page.</p></body></html>", {
          etag: '"repo"',
        });
    });

    it("stores no wiki page", async () => {
      const job = await h.scrape({ url: REPO_URL });

      expect(job.status).toBe(PipelineJobStatus.COMPLETED);
      expect(await listedUrls()).toEqual([`${REPO_URL}/blob/main/docs/guide.md`]);
    });

    it("deletes the wiki page an older version stored, even when the repository page is unchanged", async () => {
      await h.scrape({ url: REPO_URL });
      // Older versions stored the repository page under the wiki URL, with the
      // repository page's ETag, which the refresh sends through the redirect.
      await storeLegacyEmptyPage(WIKI_URL, 1, '"repo"');

      const job = await h.refresh();

      expect(job.status).toBe(PipelineJobStatus.COMPLETED);
      expect(web.requestsTo("/owner/repo").at(-1)?.ifNoneMatch).toBe('"repo"');
      expect(await listedUrls()).toEqual([`${REPO_URL}/blob/main/docs/guide.md`]);
    });
  });

  it("leaves the wiki out of a scrape narrowed to a directory", async () => {
    serveBranch("main", ["docs/guide.md", "src/index.ts"]);

    // No wiki route: requesting the wiki would fail the test.
    const job = await h.scrape({ url: `${REPO_URL}/tree/main/docs` });

    expect(job.status).toBe(PipelineJobStatus.COMPLETED);
    expect(await listedUrls()).toEqual([`${REPO_URL}/blob/main/docs/guide.md`]);
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

  it("stores wiki pages under the title GitHub gives them, with or without text", async () => {
    api
      .page("/repos/owner/repo", JSON.stringify({ default_branch: "main" }), {
        type: "application/json",
      })
      .page(
        "/repos/owner/repo/git/trees/main?recursive=1",
        JSON.stringify({ sha: "t", url: "", tree: [], truncated: false }),
        { type: "application/json" },
      );
    web
      .page(
        "/owner/repo/wiki",
        '<html><head><title>Home · owner/repo Wiki · GitHub</title></head><body><p>Welcome to the wiki.</p><a href="/owner/repo/wiki/Draft">Draft</a></body></html>',
      )
      .page(
        "/owner/repo/wiki/Draft",
        "<html><head><title>Draft · owner/repo Wiki · GitHub</title></head><body></body></html>",
      );

    const job = await h.scrape({ url: REPO_URL });

    expect(job.status).toBe(PipelineJobStatus.COMPLETED);
    expect(h.outcomeOf(`${REPO_URL}/wiki/Draft`)).toBe(PageOutcome.Empty);
    const { pages } = await h.docService.listPages(LIBRARY, VERSION);
    expect(pages.map(({ url, title }) => ({ url, title }))).toEqual([
      { url: `${REPO_URL}/wiki`, title: "Home · owner/repo Wiki · GitHub" },
      { url: `${REPO_URL}/wiki/Draft`, title: "Draft · owner/repo Wiki · GitHub" },
    ]);
  });
});
