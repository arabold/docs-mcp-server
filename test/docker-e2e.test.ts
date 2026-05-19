/**
 * Docker image integration tests.
 *
 * Exercises the actual production container end-to-end:
 *   1. Container starts and runs as a non-root user (security hardening).
 *   2. Chromium is installed where the runtime expects it (Playwright path).
 *   3. The Playwright-backed scrape pipeline can fetch a real web page.
 *   4. The Kreuzberg-backed PDF pipeline can extract a PDF from a mounted volume.
 *
 * Skipped automatically when Docker is not available on the host.
 *
 * The image build is slow (~3-5 minutes on a clean machine). To skip it,
 * pre-build and set `DOCKER_IMAGE_TAG=<tag>` in the environment — the suite
 * will use that image instead of building one.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
// @ts-expect-error -- @types/archiver@7 lags behind archiver@8's named ESM exports.
import { ZipArchive } from "archiver";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DOCKER_AVAILABLE = (() => {
  const r = spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], {
    stdio: "ignore",
  });
  return r.status === 0;
})();

const PREBUILT_TAG = process.env.DOCKER_IMAGE_TAG;
const IMAGE_TAG = PREBUILT_TAG ?? "docs-mcp-server:e2e-test";
const PROJECT_ROOT = path.resolve(import.meta.dirname, "..");
const DOCKER_BUILD_TIMEOUT_MS = 1_200_000;

function docker(args: string[], opts: { timeout?: number } = {}) {
  return spawnSync("docker", args, {
    encoding: "utf8",
    timeout: opts.timeout,
  });
}

async function createZipFixture(zipPath: string): Promise<void> {
  const output = fs.createWriteStream(zipPath);
  const archive = new ZipArchive({ zlib: { level: 9 } });

  await new Promise<void>((resolve, reject) => {
    output.on("close", resolve);
    archive.on("error", reject);
    archive.pipe(output);
    archive.append("archive note from mounted docs", { name: "archive-note.txt" });
    archive.append("# Archive Guide\n\nNested archive content", {
      name: "nested/guide.md",
    });
    archive.finalize();
  });
}

function listIndexedUrls(dbPath: string): string[] {
  const db = new Database(dbPath, { readonly: true });
  try {
    const rows = db
      .prepare("SELECT url FROM pages ORDER BY url")
      .all() as { url: string }[];
    return rows.map((row) => row.url);
  } finally {
    db.close();
  }
}

describe.skipIf(!DOCKER_AVAILABLE)("Docker image", () => {
  beforeAll(() => {
    if (PREBUILT_TAG) return;
    // Pass the tag as an argv element rather than building a shell string, so
    // a `DOCKER_IMAGE_TAG` containing spaces or metacharacters cannot be
    // interpreted by a shell.
    const r = spawnSync("docker", ["build", "-t", IMAGE_TAG, "."], {
      cwd: PROJECT_ROOT,
      stdio: "inherit",
    });
    if (r.status !== 0) {
      throw new Error(`docker build failed with exit code ${r.status}`);
    }
  }, DOCKER_BUILD_TIMEOUT_MS);

  afterAll(() => {
    if (PREBUILT_TAG) return;
    // Best-effort cleanup; ignore failures (image may already be gone).
    spawnSync("docker", ["image", "rm", "-f", IMAGE_TAG], { stdio: "ignore" });
  });

  it("runs the entrypoint as a non-root user", () => {
    const r = docker(["run", "--rm", "--entrypoint", "id", IMAGE_TAG, "-u"]);
    expect(r.status, `id -u failed: ${r.stderr}`).toBe(0);
    const uid = r.stdout.trim();
    expect(uid).not.toBe("0");
    expect(uid).toBe("1000"); // the `node` user shipped by the base image
  });

  it("ships Chromium where the Playwright runtime expects it", () => {
    const r = docker([
      "run",
      "--rm",
      "--entrypoint",
      "sh",
      IMAGE_TAG,
      "-c",
      "test -x /usr/bin/chromium && echo OK",
    ]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("OK");
  });

  it("scrapes a live web page through the Playwright pipeline", () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "docs-mcp-docker-web-"));
    // Make sure the host-side dir is writable by uid 1000 (the container user).
    fs.chmodSync(dataDir, 0o777);
    try {
      const r = docker(
        [
          "run",
          "--rm",
          "-v",
          `${dataDir}:/data`,
          "-e",
          "DOCS_MCP_TELEMETRY=false",
          IMAGE_TAG,
          "scrape",
          "docker-e2e-web",
          "https://example.com/",
          "--max-pages",
          "1",
          "--max-depth",
          "0",
          "--scrape-mode",
          "playwright",
        ],
        { timeout: 180_000 },
      );
      expect(r.status, `stdout=${r.stdout}\nstderr=${r.stderr}`).toBe(0);
      expect(
        r.stdout + r.stderr,
        "expected at least one page to be scraped via Playwright",
      ).toMatch(/Successfully scraped\s+([1-9]\d*)\s+pages?/);
      const dbPath = path.join(dataDir, "documents.db");
      expect(fs.existsSync(dbPath), "documents.db should be written").toBe(true);
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  }, 240_000);

  it("extracts a PDF from a mounted volume via Kreuzberg", () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "docs-mcp-docker-pdf-"));
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "docs-mcp-docker-tmp-"));
    fs.chmodSync(dataDir, 0o777);
    fs.chmodSync(tmpDir, 0o777);
    const fixtureDir = path.join(PROJECT_ROOT, "test", "fixtures");
    try {
      const r = docker(
        [
          "run",
          "--rm",
          "-v",
          `${dataDir}:/data`,
          "-v",
          `${fixtureDir}:/fixtures:ro`,
          "-v",
          `${tmpDir}:/tmp`,
          "-e",
          "DOCS_MCP_TELEMETRY=false",
          // Permit /fixtures as a file-access root inside the container, so
          // the default `allowedRoots` policy doesn't reject the PDF path.
          "-e",
          "DOCS_MCP_SCRAPER_SECURITY_FILE_ACCESS_ALLOWED_ROOTS=/fixtures",
          IMAGE_TAG,
          "scrape",
          "docker-e2e-pdf",
          "file:///fixtures/sample.pdf",
          "--max-pages",
          "1",
          "--max-depth",
          "0",
        ],
        { timeout: 180_000 },
      );
      expect(r.status, `stdout=${r.stdout}\nstderr=${r.stderr}`).toBe(0);
      // The scrape pipeline must actually process the PDF — issue #394 was a
      // silent skip where the run "succeeded" but indexed zero pages.
      expect(
        r.stdout + r.stderr,
        "expected at least one page to be scraped (PDF not silently skipped)",
      ).toMatch(/Successfully scraped\s+([1-9]\d*)\s+pages?/);
      const dbPath = path.join(dataDir, "documents.db");
      expect(fs.existsSync(dbPath), "documents.db should be written").toBe(true);
      expect(listIndexedUrls(dbPath)).toContain("file:///fixtures/sample.pdf");
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 240_000);

  it("recursively indexes a bind-mounted local docs folder via file:///", async () => {
    // This is the actual workflow from issue #394: a user bind-mounts a host
    // directory into the container and points the scraper at the directory
    // (not a single file), expecting every supported file inside to be indexed.
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "docs-mcp-docker-dir-"));
    const docsDir = fs.mkdtempSync(path.join(os.tmpdir(), "docs-mcp-docker-docs-"));
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "docs-mcp-docker-tmp-"));
    fs.chmodSync(dataDir, 0o777);
    fs.chmodSync(tmpDir, 0o777);
    // The container reads the docs mount, so it needs to be traversable by
    // the unprivileged runtime user (uid 1000); the writable /data mount
    // above is the only place the app actually writes.
    fs.chmodSync(docsDir, 0o755);
    try {
      // Mirror the common Docker workflow: a user bind-mounts a local docs
      // folder that contains regular files, binary documents, and archives.
      fs.copyFileSync(
        path.join(PROJECT_ROOT, "test", "fixtures", "sample.pdf"),
        path.join(docsDir, "sample.pdf"),
      );
      fs.writeFileSync(path.join(docsDir, "notes.txt"), "plain text note");
      fs.writeFileSync(path.join(docsDir, "readme.md"), "# Readme\n\nbody");
      await createZipFixture(path.join(docsDir, "archive.zip"));

      const r = docker(
        [
          "run",
          "--rm",
          "-v",
          `${dataDir}:/data`,
          "-v",
          `${docsDir}:/docs:ro`,
          "-v",
          `${tmpDir}:/tmp`,
          "-e",
          "DOCS_MCP_TELEMETRY=false",
          "-e",
          "DOCS_MCP_SCRAPER_SECURITY_FILE_ACCESS_ALLOWED_ROOTS=/docs",
          IMAGE_TAG,
          "scrape",
          "docker-e2e-dir",
          "file:///docs",
          "--max-pages",
          "10",
          "--max-depth",
          "2",
          "--max-concurrency",
          "1",
        ],
        { timeout: 180_000 },
      );
      expect(r.status, `stdout=${r.stdout}\nstderr=${r.stderr}`).toBe(0);
      // All regular files and archive members must land — anything less means
      // a silent skip slipped back in for one of the file types.
      const m = (r.stdout + r.stderr).match(/Successfully scraped\s+(\d+)\s+pages?/);
      expect(m, "expected scrape summary line in CLI output").not.toBeNull();
      expect(Number(m?.[1] ?? 0)).toBeGreaterThanOrEqual(5);

      const dbPath = path.join(dataDir, "documents.db");
      expect(fs.existsSync(dbPath)).toBe(true);

      const indexedUrls = listIndexedUrls(dbPath);
      const formattedUrls = JSON.stringify(indexedUrls, null, 2);
      expect(indexedUrls, formattedUrls).toContain("file:///docs/sample.pdf");
      expect(indexedUrls, formattedUrls).toContain("file:///docs/notes.txt");
      expect(indexedUrls, formattedUrls).toContain("file:///docs/readme.md");
      expect(indexedUrls, formattedUrls).toContain(
        "file:///docs/archive.zip/archive-note.txt",
      );
      expect(indexedUrls, formattedUrls).toContain(
        "file:///docs/archive.zip/nested/guide.md",
      );
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
      fs.rmSync(docsDir, { recursive: true, force: true });
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 240_000);
});
