/**
 * Docker image integration tests.
 *
 * Exercises the actual production container end-to-end:
 *   1. Container starts and runs as a non-root user (security hardening).
 *   2. Chromium is installed where the runtime expects it (Playwright path).
 *   3. The Playwright-backed scrape pipeline can fetch a real web page.
 *   4. The Xberg-backed PDF pipeline can extract a PDF from a mounted volume.
 *   5. The web server serves the built admin UI (SPA shell, hashed assets,
 *      client-route fallback) and the tRPC API over HTTP.
 *
 * Skipped automatically when Docker is not available on the host.
 *
 * The image build is slow (~3-5 minutes on a clean machine). To skip it,
 * pre-build and set `DOCKER_IMAGE_TAG=<tag>` in the environment — the suite
 * will use that image instead of building one.
 */

import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
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
const ARBITRARY_UID = "1000710000";

interface DockerResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

// Runs `docker` asynchronously rather than via spawnSync. These commands can
// run for minutes (image build, Playwright scrapes); a synchronous call
// blocks Node's event loop for that whole time, which starves Vitest's
// worker <-> main-thread RPC heartbeat and trips its 60s "onTaskUpdate"
// timeout as a false-positive unhandled error.
function docker(args: string[], opts: { timeout?: number } = {}): Promise<DockerResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, { timeout: opts.timeout });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (status) => {
      resolve({ status, stdout, stderr });
    });
  });
}

// Same rationale as docker() above, but streams to the parent's stdio
// (for the live-scrolling `docker build` output) instead of capturing it.
function dockerBuild(args: string[], opts: { cwd?: string; timeout?: number } = {}): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, {
      cwd: opts.cwd,
      timeout: opts.timeout,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("close", (status) => resolve(status));
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
  beforeAll(async () => {
    if (PREBUILT_TAG) return;
    // Pass the tag as an argv element rather than building a shell string, so
    // a `DOCKER_IMAGE_TAG` containing spaces or metacharacters cannot be
    // interpreted by a shell.
    const status = await dockerBuild(["build", "-t", IMAGE_TAG, "."], {
      cwd: PROJECT_ROOT,
      timeout: DOCKER_BUILD_TIMEOUT_MS,
    });
    if (status !== 0) {
      throw new Error(`docker build failed with exit code ${status}`);
    }
  }, DOCKER_BUILD_TIMEOUT_MS);

  afterAll(() => {
    if (PREBUILT_TAG) return;
    // Best-effort cleanup; ignore failures (image may already be gone).
    spawnSync("docker", ["image", "rm", "-f", IMAGE_TAG], { stdio: "ignore" });
  });

  it("runs the entrypoint as a non-root user", async () => {
    const r = await docker(["run", "--rm", "--entrypoint", "id", IMAGE_TAG, "-u"]);
    expect(r.status, `id -u failed: ${r.stderr}`).toBe(0);
    const uid = r.stdout.trim();
    expect(uid).not.toBe("0");
    expect(uid).toBe("65534"); // nobody, matching the image USER directive
  });

  it.each([
    { name: "default user", userArgs: [], uid: "65534", gid: "65534" },
    { name: "explicit nobody", userArgs: ["--user", "65534:65534"], uid: "65534", gid: "65534" },
    { name: "arbitrary uid", userArgs: ["--user", `${ARBITRARY_UID}:0`], uid: ARBITRARY_UID, gid: "0" },
  ])("provides writable runtime paths for $name", async ({ userArgs, uid, gid }) => {
    const r = await docker([
      "run",
      "--rm",
      ...userArgs,
      "--entrypoint",
      "sh",
      IMAGE_TAG,
      "-c",
      [
        `test "$(id -u)" = "${uid}"`,
        `test "$(id -g)" = "${gid}"`,
        'test "$PWD" = "/app"',
        'test "$HOME" = "/app"',
        'test -w "$HOME"',
        "test -w /data",
        "test -w /config",
        "test -w /app",
        "test ! -w /usr/bin",
        "test ! -w /etc/passwd",
        "test -r /app/dist/index.js",
        "test -x /app",
        "for dir in /app /app/dist /app/public /app/db /app/node_modules /app/.cache /nonexistent /data /config /tmp; do touch \"$dir/permission-check\" || exit 1; done",
        "touch relative-runtime-cache",
        'mkdir -p "$XDG_CACHE_HOME" "$NPM_CONFIG_CACHE" && touch "$XDG_CACHE_HOME/runtime-cache" "$NPM_CONFIG_CACHE/npm-cache"',
        "touch /data/arbitrary-uid-data",
        "touch /config/arbitrary-uid-config",
        // Newly created files keep group 0 even when nobody's primary gid is
        // 65534, so a later arbitrary-uid run can reuse the same named volumes.
        'test "$(stat -c %g /data/arbitrary-uid-data)" = "0"',
        'test "$(stat -c %g /config/arbitrary-uid-config)" = "0"',
      ].join(" && "),
    ]);
    expect(r.status, `stdout=${r.stdout}\nstderr=${r.stderr}`).toBe(0);
  });

  it("fails clearly when a mounted store denies the arbitrary uid", async () => {
    const volumeName = `docs-mcp-denied-${randomUUID()}`;
    try {
      const created = await docker(["volume", "create", volumeName]);
      expect(created.status, created.stderr).toBe(0);
      const prepared = await docker([
        "run",
        "--rm",
        "--user",
        "0:0",
        "--mount",
        `type=volume,src=${volumeName},dst=/data,volume-nocopy`,
        "--entrypoint",
        "sh",
        IMAGE_TAG,
        "-c",
        "touch /data/initialized && chmod 0700 /data",
      ]);
      expect(prepared.status, prepared.stderr).toBe(0);

      const r = await docker([
        "run",
        "--rm",
        "--user",
        `${ARBITRARY_UID}:0`,
        "-v",
        `${volumeName}:/data`,
        "--entrypoint",
        "node",
        IMAGE_TAG,
        "-e",
        'require("node:fs").writeFileSync("/data/denied", "content")',
      ]);
      expect(r.status).not.toBe(0);
      expect(r.stdout + r.stderr).toMatch(/EACCES|permission denied/i);
    } finally {
      await docker(["volume", "rm", "-f", volumeName]);
    }
  });

  it("ships Chromium where the Playwright runtime expects it", async () => {
    const r = await docker([
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

  it("scrapes a live web page through the Playwright pipeline", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "docs-mcp-docker-web-"));
    // Make sure the host-side dir is writable by uid 65534 (the container user).
    fs.chmodSync(dataDir, 0o777);
    try {
      const r = await docker(
        [
          "run",
          "--rm",
          "--user",
          `${ARBITRARY_UID}:0`,
          "--cap-drop=ALL",
          "--security-opt=no-new-privileges",
          "--tmpfs",
          "/tmp:rw,nosuid,nodev,mode=1777",
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

  it("extracts a PDF from a mounted volume via Xberg", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "docs-mcp-docker-pdf-"));
    fs.chmodSync(dataDir, 0o777);
    const fixtureDir = path.join(PROJECT_ROOT, "test", "fixtures");
    try {
      const r = await docker(
        [
          "run",
          "--rm",
          "--user",
          `${ARBITRARY_UID}:0`,
          "--cap-drop=ALL",
          "--security-opt=no-new-privileges",
          "--tmpfs",
          "/tmp:rw,nosuid,nodev,mode=1777",
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
      expect(listIndexedUrls(dbPath)).toContain("file:///fixtures/sample.pdf");
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  }, 240_000);

  it("recursively indexes a bind-mounted local docs folder via file:///", async () => {
    // This is the actual workflow from issue #394: a user bind-mounts a host
    // directory into the container and points the scraper at the directory
    // (not a single file), expecting every supported file inside to be indexed.
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "docs-mcp-docker-dir-"));
    const docsDir = fs.mkdtempSync(path.join(os.tmpdir(), "docs-mcp-docker-docs-"));
    fs.chmodSync(dataDir, 0o777);
    // The container reads the docs mount, so it needs to be traversable by
    // the unprivileged runtime user (uid 65534); the writable /data mount
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

      const r = await docker(
        [
          "run",
          "--rm",
          "-v",
          `${dataDir}:/data`,
          "-v",
          `${docsDir}:/docs:ro`,
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
    }
  }, 240_000);

  it.each([
    { name: "default user", userArgs: [] },
    { name: "arbitrary uid", userArgs: ["--user", `${ARBITRARY_UID}:0`] },
  ])("serves the web UI with writable runtime paths as $name", async ({ userArgs }) => {
    // Run the web server detached and let Docker pick a free host port (-P), so
    // the test never clashes with a port already bound on the CI host. The
    // image sets DOCS_MCP_STORE_PATH=/data (writable), so no mount is needed —
    // an empty store still serves the UI and system-health API.
    const run = await docker([
      "run",
      "-d",
      "--rm",
      ...userArgs,
      "--cap-drop=ALL",
      "--security-opt=no-new-privileges",
      "--tmpfs",
      "/tmp:rw,nosuid,nodev,mode=1777",
      "-P",
      "-e",
      "DOCS_MCP_TELEMETRY=false",
      IMAGE_TAG,
      "web",
      "--host",
      "0.0.0.0",
      "--port",
      "6280",
    ]);
    expect(run.status, `docker run failed: ${run.stderr}`).toBe(0);
    const containerId = run.stdout.trim();
    try {
      // Resolve the mapped host port (e.g. "0.0.0.0:49153").
      const portRes = await docker(["port", containerId, "6280"]);
      const portMatch = portRes.stdout.match(/:(\d+)/);
      expect(portMatch, `could not resolve mapped port from: ${portRes.stdout}`).not.toBeNull();
      const base = `http://127.0.0.1:${portMatch?.[1]}`;

      // Poll until the server is listening (container boot + Fastify listen).
      let ready = false;
      for (let i = 0; i < 60 && !ready; i++) {
        const status = await fetch(`${base}/`)
          .then((r) => r.status)
          .catch(() => 0);
        if (status === 200) ready = true;
        else await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      expect(ready, "web server did not become ready within 60s").toBe(true);

      // 1. The SPA shell is served at the root.
      const root = await fetch(`${base}/`);
      expect(root.status).toBe(200);
      expect(root.headers.get("content-type")).toMatch(/text\/html/);
      const html = await root.text();
      expect(html, "root should return the SPA shell").toContain('<div id="root">');

      // 2. The hashed JS bundle referenced by the shell is served.
      const assetPath = html.match(/\/assets\/index-[\w-]+\.js/)?.[0];
      expect(assetPath, "index.html should reference a hashed JS asset").toBeTruthy();
      const asset = await fetch(`${base}${assetPath}`);
      expect(asset.status).toBe(200);
      expect(asset.headers.get("content-type")).toMatch(/javascript/);

      // 3. A client-side route falls back to the SPA shell (not a 404).
      const deep = await fetch(`${base}/libraries`);
      expect(deep.status).toBe(200);
      expect(await deep.text()).toContain('<div id="root">');

      // 4. The tRPC API is mounted under /api and returns real system health.
      const api = await fetch(`${base}/api/getSystemHealth`);
      expect(api.status).toBe(200);
      expect(api.headers.get("content-type")).toMatch(/application\/json/);
      const body = (await api.json()) as {
        result?: { data?: { json?: { worker?: { mode?: string } } } };
      };
      expect(body.result?.data?.json?.worker?.mode).toBe("embedded");
    } finally {
      // Best-effort stop (also triggers --rm cleanup); ignore if already gone.
      await docker(["rm", "-f", containerId]);
    }
  }, 120_000);
});
