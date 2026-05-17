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

import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DOCKER_AVAILABLE = (() => {
  try {
    execSync("docker version --format '{{.Server.Version}}'", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const PREBUILT_TAG = process.env.DOCKER_IMAGE_TAG;
const IMAGE_TAG = PREBUILT_TAG ?? "docs-mcp-server:e2e-test";
const PROJECT_ROOT = path.resolve(import.meta.dirname, "..");

function docker(args: string[], opts: { timeout?: number } = {}) {
  return spawnSync("docker", args, {
    encoding: "utf8",
    timeout: opts.timeout,
  });
}

describe.skipIf(!DOCKER_AVAILABLE)("Docker image", () => {
  beforeAll(() => {
    if (PREBUILT_TAG) return;
    execSync(`docker build -t ${IMAGE_TAG} .`, {
      cwd: PROJECT_ROOT,
      stdio: "inherit",
    });
  }, 600_000);

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
    fs.chmodSync(dataDir, 0o777);
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
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  }, 240_000);
});
