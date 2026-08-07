import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalFileStrategy } from "../src/scraper/strategies/LocalFileStrategy";
import type { ScraperOptions, ScraperProgressEvent } from "../src/scraper/types";
import type { ProgressCallback } from "../src/types";
import { loadConfig } from "../src/utils/config";
import { logger } from "../src/utils/logger";

const FIXTURE_ARCHIVE = path.join(process.cwd(), "test", "fixtures", "archive.zip");

describe("LocalFileStrategy - .gitignore integration (issue #438)", () => {
  let rootDirectory: string;

  beforeEach(async () => {
    // realpath so the crawl root matches the resolved paths the strategy sees
    // (macOS puts the temp dir behind a /var -> /private/var symlink).
    rootDirectory = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), "gitignore-e2e-")),
    );
  });

  afterEach(async () => {
    await fs.rm(rootDirectory, { recursive: true, force: true });
  });

  async function write(relativePath: string, content: string): Promise<void> {
    const filePath = path.join(rootDirectory, relativePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content);
  }

  async function scrape(
    options: Omit<ScraperOptions, "url" | "library" | "version">,
    fileAccess: { includeHidden?: boolean } = {},
  ): Promise<ScraperProgressEvent[]> {
    const appConfig = loadConfig();
    appConfig.scraper.security.fileAccess.allowedRoots = [rootDirectory];
    appConfig.scraper.security.fileAccess.followSymlinks = true;
    appConfig.scraper.security.fileAccess.includeHidden =
      fileAccess.includeHidden ?? false;

    const strategy = new LocalFileStrategy(appConfig);
    const events: ScraperProgressEvent[] = [];
    const progressCallback: ProgressCallback<ScraperProgressEvent> = async (event) => {
      events.push(event);
    };

    try {
      await strategy.scrape(
        {
          url: pathToFileURL(rootDirectory).href,
          library: "gitignore-e2e",
          version: "1.0.0",
          maxPages: 20,
          maxDepth: 3,
          maxConcurrency: 2,
          ignoreErrors: false,
          ...options,
        },
        progressCallback,
      );
      return events;
    } finally {
      await strategy.cleanup();
    }
  }

  it("keeps ignored files when the option is disabled", async () => {
    await write(".gitignore", "ignored.md\n");
    await write("ignored.md", "# Indexed by default\n");

    const events = await scrape({});

    expect(events.map((event) => event.currentUrl)).toContain(
      pathToFileURL(path.join(rootDirectory, "ignored.md")).href,
    );
  });

  it("applies root and nested rules when the option is enabled", async () => {
    await write(
      ".gitignore",
      "ignored.md\nbuild/\n*.generated.md\nnested/reincluded/\n",
    );
    await write("keep.md", "# Keep\n");
    await write("ignored.md", "# Ignore\n");
    await write(path.join("build", "secret.md"), "# Ignore directory\n");
    await write(
      path.join("nested", ".gitignore"),
      "!keep.generated.md\n!reincluded/\n",
    );
    await write(path.join("nested", "drop.generated.md"), "# Ignore\n");
    await write(path.join("nested", "keep.generated.md"), "# Keep\n");
    await write(path.join("nested", "reincluded", "keep.md"), "# Keep\n");

    const events = await scrape({ respectGitignore: true });
    const processedUrls = new Set(events.map((event) => event.currentUrl));

    expect(processedUrls).toEqual(
      new Set([
        pathToFileURL(path.join(rootDirectory, "keep.md")).href,
        pathToFileURL(path.join(rootDirectory, "nested", "keep.generated.md")).href,
        pathToFileURL(path.join(rootDirectory, "nested", "reincluded", "keep.md"))
          .href,
      ]),
    );
  });

  it("preserves direct files for a nested directory-only globstar", async () => {
    await write(path.join("nested", ".gitignore"), "**/\n");
    await write(path.join("nested", "direct.md"), "# Keep direct file\n");
    await write(path.join("nested", "subdirectory", "ignored.md"), "# Ignore\n");

    const events = await scrape({ respectGitignore: true });
    const processedUrls = events.map((event) => event.currentUrl);

    expect(processedUrls).toContain(
      pathToFileURL(path.join(rootDirectory, "nested", "direct.md")).href,
    );
    expect(processedUrls).not.toContain(
      pathToFileURL(path.join(rootDirectory, "nested", "subdirectory", "ignored.md"))
        .href,
    );
  });

  it("reports a previously indexed file as deleted after it becomes ignored", async () => {
    await write(".gitignore", "secret.md\n");
    await write("secret.md", "# Secret\n");
    const secretUrl = pathToFileURL(path.join(rootDirectory, "secret.md")).href;

    const events = await scrape({
      respectGitignore: true,
      initialQueue: [{ url: secretUrl, depth: 1, pageId: 438 }],
    });

    expect(events).toContainEqual(
      expect.objectContaining({
        currentUrl: secretUrl,
        pageId: 438,
        result: null,
        deleted: true,
      }),
    );
  });

  it("does not resolve a symlink ignored by a path rule before reporting a refresh deletion", async () => {
    await write(".gitignore", "ignored-link\n");
    await write(path.join(".target", "secret.md"), "# Must not be reached\n");
    const linkPath = path.join(rootDirectory, "ignored-link");
    await fs.symlink(
      path.join(rootDirectory, ".target"),
      linkPath,
      process.platform === "win32" ? "junction" : "dir",
    );
    const linkUrl = pathToFileURL(linkPath).href;
    const statSpy = vi.spyOn(fs, "stat");

    try {
      const events = await scrape({
        respectGitignore: true,
        initialQueue: [{ url: linkUrl, depth: 1, pageId: 440 }],
      });

      expect(statSpy).not.toHaveBeenCalledWith(linkPath);
      expect(events).toContainEqual(
        expect.objectContaining({
          currentUrl: linkUrl,
          pageId: 440,
          result: null,
          deleted: true,
        }),
      );
    } finally {
      statSpy.mockRestore();
    }
  });

  // Git records a symlink as a blob, never a directory, so a directory-only
  // rule does not match one. Confirmed against `git check-ignore`: with
  // `notes.md/` in .gitignore, a `notes.md` symlink is reported as NOT
  // ignored whether it points at a file or at a real directory.
  it("keeps a symlink to a file that only a directory-only rule matches", async () => {
    await write(".gitignore", "notes.md/\n");
    await write("target.md", "# Keep\n");
    const linkPath = path.join(rootDirectory, "notes.md");
    await fs.symlink(path.join(rootDirectory, "target.md"), linkPath, "file");

    const events = await scrape({ respectGitignore: true });

    expect(events.map((event) => event.currentUrl)).toContain(
      pathToFileURL(linkPath).href,
    );
  });

  it("prunes the contents of a symlinked directory matched by a directory-only rule", async () => {
    await write(".gitignore", "linkdir/\n");
    await write(path.join(".target", "inner.md"), "# Must not be indexed\n");
    const linkPath = path.join(rootDirectory, "linkdir");
    await fs.symlink(
      path.join(rootDirectory, ".target"),
      linkPath,
      process.platform === "win32" ? "junction" : "dir",
    );
    const readdirSpy = vi.spyOn(fs, "readdir");

    try {
      const events = await scrape({ respectGitignore: true });

      // The link is not matched — Git would list it — so the crawler still
      // descends. Reading it is what distinguishes "kept, then pruned from
      // within" from "skipped as ignored"; neither indexes anything, so the
      // event list alone cannot tell them apart.
      expect(readdirSpy).toHaveBeenCalledWith(linkPath);
      expect(events.map((event) => event.currentUrl)).not.toContain(
        pathToFileURL(path.join(linkPath, "inner.md")).href,
      );
    } finally {
      readdirSpy.mockRestore();
    }
  });

  it("warns that rules above the indexed folder are not applied", async () => {
    const repositoryRoot = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), "gitignore-repo-")),
    );
    const previousRoot = rootDirectory;
    try {
      await fs.mkdir(path.join(repositoryRoot, ".git"));
      rootDirectory = path.join(repositoryRoot, "docs");
      await fs.mkdir(rootDirectory);
      await write("keep.md", "# Keep\n");
      vi.mocked(logger.warn).mockClear();

      await scrape({ respectGitignore: true });

      // The indexed folder is a path *under* repositoryRoot, so matching the
      // root alone would also match a message that only names the folder.
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(`is inside the Git repository at ${repositoryRoot}`),
      );
    } finally {
      rootDirectory = previousRoot;
      await fs.rm(repositoryRoot, { recursive: true, force: true });
    }
  });

  it("does not warn when the indexed folder is the repository root", async () => {
    await fs.mkdir(path.join(rootDirectory, ".git"));
    await write("keep.md", "# Keep\n");
    vi.mocked(logger.warn).mockClear();

    await scrape({ respectGitignore: true });

    expect(logger.warn).not.toHaveBeenCalledWith(
      expect.stringContaining("is inside the Git repository at"),
    );
  });

  it("never indexes repository metadata under .git", async () => {
    await write(".gitignore", "ignored.md\n");
    await write("keep.md", "# Keep\n");
    await write(path.join(".git", "config.md"), "# Must not be indexed\n");
    await write(path.join(".git", "objects", "info", "packs.md"), "# Nor this\n");

    const events = await scrape({ respectGitignore: true }, { includeHidden: true });

    expect(events.map((event) => event.currentUrl)).toEqual([
      pathToFileURL(path.join(rootDirectory, "keep.md")).href,
    ]);
  });

  it("reports archived pages as deleted after their physical archive becomes ignored", async () => {
    await write(".gitignore", "archive.zip\n");
    await fs.copyFile(FIXTURE_ARCHIVE, path.join(rootDirectory, "archive.zip"));
    const memberUrl = pathToFileURL(
      path.join(rootDirectory, "archive.zip", "archive-note.txt"),
    ).href;

    const events = await scrape({
      respectGitignore: true,
      initialQueue: [{ url: memberUrl, depth: 1, pageId: 439 }],
    });

    expect(events).toContainEqual(
      expect.objectContaining({
        currentUrl: memberUrl,
        pageId: 439,
        result: null,
        deleted: true,
      }),
    );
  });
});
