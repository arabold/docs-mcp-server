import { HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { mockSite } from "../../../test/mock-site";
import { loadConfig } from "../../utils/config";
import { FetchStatus } from "../fetcher/types";
import type { ScraperOptions, ScraperProgressEvent } from "../types";
import { GitHubScraperStrategy } from "./GitHubScraperStrategy";
import * as githubAuth from "./github-auth";

// Building realistic request headers loads a large browser-fingerprint model on
// every fetcher construction, which only costs time here.
vi.mock("../fetcher/FingerprintGenerator");

const baseConfig = loadConfig();
// One attempt per request, so a request that fails fails the test at once.
const config = {
  ...baseConfig,
  scraper: {
    ...baseConfig.scraper,
    fetcher: { ...baseConfig.scraper.fetcher, maxRetries: 0 },
  },
};

const REPO_URL = "https://github.com/owner/repo";
// An explicit token keeps the strategy from asking the local gh CLI for one.
const AUTH = { Authorization: "Bearer test-token" };

const options = (overrides: Partial<ScraperOptions> = {}): ScraperOptions => ({
  url: REPO_URL,
  library: "test-lib",
  version: "1.0.0",
  headers: AUTH,
  ...overrides,
});

/** A path in a repository tree; directories are listed as `tree` entries. */
type TreeEntry = string | { path: string; type: "tree" };

const treeBody = (entries: TreeEntry[]): string =>
  JSON.stringify({
    sha: "tree123",
    url: "https://api.github.com/repos/owner/repo/git/trees/tree123",
    tree: entries.map((entry) =>
      typeof entry === "string"
        ? { path: entry, type: "blob", sha: "abc", url: "" }
        : { ...entry, sha: "abc", url: "" },
    ),
    truncated: false,
  });

const blobUrl = (path: string, branch = "main") =>
  `https://github.com/owner/repo/blob/${branch}/${path}`;

describe("GitHubScraperStrategy", () => {
  const api = mockSite("https://api.github.com");
  const raw = mockSite("https://raw.githubusercontent.com");
  const web = mockSite("https://github.com");

  const json = { type: "application/json" };
  const repoInfoPath = "/repos/owner/repo";
  const treePath = (branch: string) =>
    `/repos/owner/repo/git/trees/${branch}?recursive=1`;

  /** Serves `owner/repo` with default branch `main` and `entries` in its tree. */
  function serveRepo(entries: TreeEntry[]): void {
    api.page(repoInfoPath, JSON.stringify({ default_branch: "main" }), json);
    api.page(treePath("main"), treeBody(entries), json);
  }

  /** Runs the discovery step for the scrape's root URL. */
  const discover = (overrides: Partial<ScraperOptions> = {}) => {
    const scrapeOptions = options(overrides);
    return new GitHubScraperStrategy(config).processItem(
      { url: scrapeOptions.url, depth: 0 },
      scrapeOptions,
    );
  };

  it("discovers the wiki and every readable file of the default branch", async () => {
    serveRepo([
      "README.md",
      "src/index.js",
      "docs/guide.rst",
      "package.json",
      "config.yaml",
      "script.py",
      // Well-known names without an extension
      "Dockerfile",
      "Makefile",
      "README",
      "CHANGELOG",
      // Config files
      ".prettierrc",
      ".eslintrc",
      ".babelrc",
      ".env",
      ".env.local",
      // Admitted only because its MIME type is text/*
      "src/main.coffee",
      // Binary files
      "image.png",
      "video.mp4",
      "archive.zip",
      "binary.exe",
      "lib.so",
      "app.dmg",
      // A directory
      { path: "src", type: "tree" },
    ]);

    const result = await discover();

    expect(result.status).toBe(FetchStatus.SUCCESS);
    expect(result.links).toEqual([
      `${REPO_URL}/wiki`,
      ...[
        "README.md",
        "src/index.js",
        "docs/guide.rst",
        "package.json",
        "config.yaml",
        "script.py",
        "Dockerfile",
        "Makefile",
        "README",
        "CHANGELOG",
        ".prettierrc",
        ".eslintrc",
        ".babelrc",
        ".env",
        ".env.local",
        "src/main.coffee",
      ].map((path) => blobUrl(path)),
    ]);
  });

  it("sends the auth header with every GitHub API request", async () => {
    serveRepo(["README.md"]);

    await discover();

    expect(api.requests.map((request) => request.path)).toEqual([
      repoInfoPath,
      treePath("main"),
    ]);
    for (const request of api.requests) {
      expect(request.headers.get("authorization")).toBe("Bearer test-token");
    }
  });

  it("scopes a tree URL to its branch and subpath", async () => {
    // The branch is in the URL, so the repository info is never asked for.
    api.page(
      treePath("dev"),
      treeBody([
        { path: "docs", type: "tree" },
        "docs/guide.md",
        "docs/api/ref.md",
        "docsx/other.md",
        "README.md",
      ]),
      json,
    );

    const result = await discover({ url: `${REPO_URL}/tree/dev/docs` });

    expect(result.links?.filter((link) => link.includes("/blob/"))).toEqual([
      blobUrl("docs/guide.md", "dev"),
      blobUrl("docs/api/ref.md", "dev"),
    ]);
  });

  it("applies include and exclude patterns to repository paths", async () => {
    serveRepo([
      "README.md",
      "src/index.js",
      "src/index.test.js",
      "package.json",
      "node_modules/package/index.js",
    ]);

    const result = await discover({
      includePatterns: ["*.md", "src/**", "node_modules/**"],
      excludePatterns: ["**/*.test.js", "node_modules/**"],
    });

    expect(result.links).toEqual([
      `${REPO_URL}/wiki`,
      blobUrl("README.md"),
      blobUrl("src/index.js"),
    ]);
  });

  it("rejects an invalid repository URL", async () => {
    await expect(discover({ url: "https://github.com/invalid" })).rejects.toThrow(
      "Invalid GitHub repository URL",
    );
  });

  it("should return empty links for non-depth-0 items", async () => {
    const strategy = new GitHubScraperStrategy(config);

    const result = await strategy.processItem({ url: REPO_URL, depth: 1 }, options());

    expect(result.status).toBe(FetchStatus.SUCCESS);
    expect(result.links).toEqual([]);
  });

  it("should handle single blob file URLs with strict scoping", async () => {
    const result = await discover({ url: blobUrl("README.md") });

    expect(result.status).toBe(FetchStatus.SUCCESS);
    // Strict scoping: blob URL should index ONLY that file, not discover wiki
    expect(result.links).toEqual([blobUrl("README.md")]);
  });

  it("marks legacy github-file:// URLs as not found at any depth", async () => {
    const strategy = new GitHubScraperStrategy(config);
    const items = [
      { url: "github-file://src/cli/types.ts", depth: 1 },
      { url: "github-file://README.md", depth: 0 },
      { url: "github-file://src/index.js", depth: 2 },
    ];

    for (const item of items) {
      const result = await strategy.processItem(item, options());
      expect.soft(result, `${item.url} at depth ${item.depth}`).toEqual({
        url: item.url,
        links: [],
        status: FetchStatus.NOT_FOUND,
      });
    }
  });

  it("names the token variable when the repository info or its tree is not found", async () => {
    const cases: Array<{ label: string; serve: () => void }> = [
      {
        // The tree has no route, so asking for it would fail the test.
        label: "repository info",
        serve: () => api.notFound(repoInfoPath),
      },
      {
        label: "tree",
        serve: () => {
          api.page(repoInfoPath, JSON.stringify({ default_branch: "main" }), json);
          api.notFound(treePath("main"));
        },
      },
    ];

    for (const { label, serve } of cases) {
      api.reset();
      serve();
      await expect
        .soft(discover(), label)
        .rejects.toThrow(
          /Repository "owner\/repo" not found or not accessible.*GITHUB_TOKEN/,
        );
    }
  });

  it("should fall back to main when default branch is missing", async () => {
    api.page(repoInfoPath, JSON.stringify({}), json);
    api.page(treePath("main"), treeBody([]), json);

    const result = await discover();

    expect(result.status).toBe(FetchStatus.SUCCESS);
    expect(api.wasRequested(treePath("main"))).toBe(true);
  });

  it("should throw user-friendly error when JSON parsing fails", async () => {
    api.page(repoInfoPath, JSON.stringify({ default_branch: "main" }), json);
    api.page(treePath("main"), "not valid json {{{", json);

    await expect(discover()).rejects.toThrow(/Failed to parse GitHub API response/);
  });

  it("indexes the repository wiki, following links only within the wiki", async () => {
    serveRepo([]);
    // The issues link leaves the wiki, so it is not followed.
    web
      .page(
        "/owner/repo/wiki",
        '<html><head><title>Home · owner/repo Wiki</title></head><body><p>Welcome to the wiki.</p><a href="/owner/repo/wiki/Guide">Guide</a><a href="/owner/repo/issues">Issues</a></body></html>',
      )
      .page(
        "/owner/repo/wiki/Guide",
        '<html><head><title>Guide · owner/repo Wiki</title></head><body><p>How to use the library.</p><a href="/owner/repo/wiki">Home</a></body></html>',
      );
    const events: ScraperProgressEvent[] = [];

    await new GitHubScraperStrategy(config).scrape(options(), async (event) => {
      events.push(event);
    });

    expect(events.map((event) => event.currentUrl)).toEqual([
      REPO_URL,
      `${REPO_URL}/wiki`,
      `${REPO_URL}/wiki/Guide`,
    ]);
    const stored = events.flatMap((event) => (event.result ? [event.result] : []));
    expect(stored).toEqual([
      expect.objectContaining({
        url: `${REPO_URL}/wiki`,
        title: "Home · owner/repo Wiki",
        textContent: expect.stringContaining("Welcome to the wiki."),
      }),
      expect.objectContaining({
        url: `${REPO_URL}/wiki/Guide`,
        title: "Guide · owner/repo Wiki",
        textContent: expect.stringContaining("How to use the library."),
      }),
    ]);
  });

  it("should resolve GitHub auth once per scrape", async () => {
    const resolveSpy = vi.spyOn(githubAuth, "resolveGitHubAuth");
    serveRepo(["a.md", "b.md"]);
    web.notFound("/owner/repo/wiki");
    raw.page("/owner/repo/main/a.md", "# A", { type: "text/plain" });
    raw.page("/owner/repo/main/b.md", "# B", { type: "text/plain" });

    try {
      // The root, the wiki and both files are four items, which share one lookup.
      await new GitHubScraperStrategy(config).scrape(options(), vi.fn());

      // The files may be fetched concurrently, in any order.
      expect(raw.requests.map((request) => request.path).sort()).toEqual([
        "/owner/repo/main/a.md",
        "/owner/repo/main/b.md",
      ]);
      expect(resolveSpy).toHaveBeenCalledTimes(1);
    } finally {
      resolveSpy.mockRestore();
    }
  });

  it("explains an authentication or access failure of the GitHub API", async () => {
    const cases: Array<{ label: string; response: () => Response; message: RegExp }> = [
      {
        label: "401",
        response: () => new HttpResponse(null, { status: 401 }),
        message: /GitHub authentication failed.*invalid or expired/,
      },
      {
        // The fetcher raises a challenge error, not a status error, for a 403
        // with challenge markers. It still carries the status and still
        // deserves the friendly message.
        label: "403 with a Cloudflare challenge",
        response: () =>
          new HttpResponse("Just a moment...", {
            status: 403,
            headers: { "cf-mitigated": "challenge" },
          }),
        message: /GitHub access denied/,
      },
      {
        label: "403",
        response: () => new HttpResponse(null, { status: 403 }),
        message: /GitHub access denied.*(permissions|rate-limited)/,
      },
    ];

    for (const { label, response, message } of cases) {
      api.reset();
      api.respond(repoInfoPath, response);
      await expect.soft(discover(), label).rejects.toThrow(message);
    }
  });

  it("does not report access denied when only the repo name contains 403", async () => {
    // The error message embeds the API url, so a message-substring check
    // would misreport this connection failure as a permissions problem.
    api.respond("/repos/owner/error-403", () => HttpResponse.error());

    const error = await discover({ url: "https://github.com/owner/error-403" }).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toMatch(
      /Failed to fetch https:\/\/api\.github\.com\/repos\/owner\/error-403/,
    );
    expect(String(error)).not.toMatch(/access denied/);
  });
});
