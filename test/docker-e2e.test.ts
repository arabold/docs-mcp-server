/**
 * OCI container image integration tests.
 *
 * Exercises the actual production container end-to-end:
 *   1. Container starts and runs as a non-root user (security hardening).
 *   2. Chromium is installed where the runtime expects it (Playwright path).
 *   3. The Playwright-backed scrape pipeline renders a page served from the
 *      host, running its JavaScript, and a live documentation site whose
 *      content only its scripts produce. It uses the image's Chromium and
 *      never downloads Playwright's own.
 *   4. The Xberg-backed PDF pipeline can extract a PDF from a mounted volume.
 *   5. The web server serves the built admin UI (SPA shell, hashed assets,
 *      client-route fallback) and the tRPC API over HTTP.
 *   6. No-argument startup serves HTTP, while transport and binding overrides work.
 *
 * Skipped automatically when the selected container engine is unavailable.
 *
 * The image build is slow (~3-5 minutes on a clean machine). To skip it,
 * pre-build and set `DOCKER_IMAGE_TAG=<tag>` in the environment — the suite
 * will use that image instead of building one.
 */

import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import Database from "better-sqlite3";
import { ZipArchive } from "archiver";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const CONTAINER_ENGINE = process.env.CONTAINER_ENGINE ?? "docker";
const CONTAINER_ENGINE_AVAILABLE = (() => {
  const r = spawnSync(CONTAINER_ENGINE, ["version"], {
    stdio: "ignore",
  });
  return r.status === 0;
})();

const PREBUILT_TAG = process.env.DOCKER_IMAGE_TAG;
const IMAGE_TAG = PREBUILT_TAG ?? "docs-mcp-server:e2e-test";
const PROJECT_ROOT = path.resolve(import.meta.dirname, "..");
const DOCKER_BUILD_TIMEOUT_MS = 1_200_000;
// Rootless Podman can only map ids from the invoking user's subordinate-id
// range. UID 12345 still exercises the OpenShift arbitrary-UID contract while
// remaining portable; Docker keeps the representative OpenShift-range value.
const ARBITRARY_UID =
  process.env.CONTAINER_ARBITRARY_UID ??
  (CONTAINER_ENGINE === "podman" ? "12345" : "1000710000");
const ARBITRARY_GID = process.env.CONTAINER_ARBITRARY_GID ?? ARBITRARY_UID;
const REPLACEMENT_UID = CONTAINER_ENGINE === "podman" ? "12346" : "1000710001";
const REPLACEMENT_GID = REPLACEMENT_UID;

interface DockerResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

interface HttpResult {
  status: number;
  contentType: string;
  body: string;
}

async function containerFetch(
  containerId: string,
  hostUrl: string,
  requestPath: string,
): Promise<HttpResult> {
  if (CONTAINER_ENGINE !== "podman") {
    const response = await fetch(`${hostUrl}${requestPath}`);
    return {
      status: response.status,
      contentType: response.headers.get("content-type") ?? "",
      body: await response.text(),
    };
  }

  // On Windows, rootless Podman's gvproxy port can be reachable by curl while
  // Node's host-side TCP connection is rejected. Probe from inside the running
  // container so this remains a test of the image rather than gvproxy.
  const script = [
    `const response = await fetch(${JSON.stringify(`http://127.0.0.1:6280${requestPath}`)});`,
    "const body = await response.text();",
    'console.log(JSON.stringify({ status: response.status, contentType: response.headers.get("content-type") ?? "", body }));',
  ].join("");
  const result = await docker([
    "exec",
    containerId,
    "node",
    "--input-type=module",
    "-e",
    script,
  ]);
  if (result.status !== 0) throw new Error(result.stderr);
  return JSON.parse(result.stdout) as HttpResult;
}

// Runs `docker` asynchronously rather than via spawnSync. These commands can
// run for minutes (image build, Playwright scrapes); a synchronous call
// blocks Node's event loop for that whole time, which starves Vitest's
// worker <-> main-thread RPC heartbeat and trips its 60s "onTaskUpdate"
// timeout as a false-positive unhandled error.
function docker(args: string[], opts: { timeout?: number } = {}): Promise<DockerResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(CONTAINER_ENGINE, args, { timeout: opts.timeout });
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
function dockerBuild(
  args: string[],
  opts: { cwd?: string; timeout?: number } = {},
): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const child = spawn(CONTAINER_ENGINE, args, {
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

/** The text only the page's script writes, so finding it proves a browser ran the page. */
const RENDERED_TEXT = "Text written by JavaScript";

/**
 * Serves a page whose only text is written by its script, on a port the
 * container reaches as `host.docker.internal`.
 *
 * Docker Desktop forwards that name to the host's loopback. On Linux it is the
 * bridge gateway, so the server listens on every interface there.
 *
 * @returns The page's port and a function that stops the server.
 */
async function startScriptedPage(): Promise<{
  port: number;
  close: () => Promise<void>;
}> {
  const words = JSON.stringify(RENDERED_TEXT.split(" "));
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end(
      `<html><head><title>Scripted page</title></head><body><main id="content"></main><script>document.getElementById("content").textContent = ${words}.join(" ");</script></body></html>`,
    );
  });
  const host = process.platform === "linux" ? "0.0.0.0" : "127.0.0.1";
  await new Promise<void>((resolve) => server.listen(0, host, resolve));
  return {
    port: (server.address() as AddressInfo).port,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** The stored text of `url`, its chunks joined in order. */
function indexedContent(dbPath: string, url: string): string {
  const db = new Database(dbPath, { readonly: true });
  try {
    const rows = db
      .prepare(
        "SELECT d.content FROM documents d JOIN pages p ON d.page_id = p.id WHERE p.url = ? ORDER BY d.sort_order",
      )
      .all(url) as { content: string }[];
    return rows.map((row) => row.content).join("\n");
  } finally {
    db.close();
  }
}

function listIndexedUrls(dbPath: string): string[] {
  const db = new Database(dbPath, { readonly: true });
  try {
    const rows = db.prepare("SELECT url FROM pages ORDER BY url").all() as {
      url: string;
    }[];
    return rows.map((row) => row.url);
  } finally {
    db.close();
  }
}

describe.skipIf(!CONTAINER_ENGINE_AVAILABLE)(`${CONTAINER_ENGINE} image`, () => {
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
    spawnSync(CONTAINER_ENGINE, ["image", "rm", "-f", IMAGE_TAG], { stdio: "ignore" });
  });

  it("runs the entrypoint as a non-root user", async () => {
    const r = await docker(["run", "--rm", "--entrypoint", "id", IMAGE_TAG, "-u"]);
    expect(r.status, `id -u failed: ${r.stderr}`).toBe(0);
    const uid = r.stdout.trim();
    expect(uid).not.toBe("0");
    expect(uid).toBe("10001"); // dedicated docs-mcp user
  });

  it.each([
    { name: "default user", userArgs: [], uid: "10001", gid: "10001" },
    {
      name: "explicit runtime user",
      userArgs: ["--user", "10001:10001"],
      uid: "10001",
      gid: "10001",
    },
    {
      name: "arbitrary uid and gid",
      userArgs: ["--user", `${ARBITRARY_UID}:${ARBITRARY_GID}`],
      uid: ARBITRARY_UID,
      gid: ARBITRARY_GID,
    },
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
        'test "$HOME" = "/app/.runtime"',
        'test -w "$HOME"',
        "test -w /data",
        "test -w /config",
        "test ! -w /app/dist",
        "test ! -w /app/public",
        "test ! -w /app/db",
        "test ! -w /app/node_modules",
        "test ! -w /usr/bin",
        "test ! -w /etc/passwd",
        "test -r /app/dist/index.js",
        "test -x /app",
        'for dir in /app/.runtime /app/.runtime/cache /nonexistent /data /config /tmp; do touch "$dir/permission-check" || exit 1; done',
        'mkdir -p "$XDG_CACHE_HOME" "$NPM_CONFIG_CACHE" && touch "$XDG_CACHE_HOME/runtime-cache" "$NPM_CONFIG_CACHE/npm-cache"',
        "touch /data/arbitrary-uid-data",
        "touch /config/arbitrary-uid-config",
        `test "$(stat -c %g /data/arbitrary-uid-data)" = "${gid}"`,
        `test "$(stat -c %g /config/arbitrary-uid-config)" = "${gid}"`,
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
        `type=volume,src=${volumeName},dst=/data`,
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
        `${ARBITRARY_UID}:${ARBITRARY_GID}`,
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

  it("reopens a persisted SQLite store after both uid and gid change", async () => {
    const volumeName = `docs-mcp-identity-change-${randomUUID()}`;
    try {
      const created = await docker(["volume", "create", volumeName]);
      expect(created.status, created.stderr).toBe(0);

      const initialized = await docker([
        "run",
        "--rm",
        "--user",
        `${ARBITRARY_UID}:${ARBITRARY_GID}`,
        "-v",
        `${volumeName}:/data`,
        "--entrypoint",
        "node",
        IMAGE_TAG,
        "-e",
        [
          'const fs = require("node:fs");',
          'const Database = require("better-sqlite3");',
          'new Database("/data/documents.db").close();',
          'console.log((fs.statSync("/data/documents.db").mode & 0o777).toString(8));',
        ].join(""),
      ]);
      expect(initialized.status, initialized.stderr).toBe(0);
      expect(initialized.stdout.trim()).toBe("644");

      const migrated = await docker([
        "run",
        "--rm",
        "--user",
        `${REPLACEMENT_UID}:${REPLACEMENT_GID}`,
        "-v",
        `${volumeName}:/data`,
        IMAGE_TAG,
        "--version",
      ]);
      expect(migrated.status, migrated.stderr).toBe(0);

      const reopened = await docker([
        "run",
        "--rm",
        "--user",
        `${REPLACEMENT_UID}:${REPLACEMENT_GID}`,
        "-v",
        `${volumeName}:/data`,
        "--entrypoint",
        "node",
        IMAGE_TAG,
        "-e",
        'const Database = require("better-sqlite3"); const db = new Database("/data/documents.db"); db.exec("CREATE TABLE identity_test (id INTEGER)"); db.close();',
      ]);
      expect(reopened.status, reopened.stderr).toBe(0);
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

  it("renders a page's JavaScript through the Playwright pipeline", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "docs-mcp-docker-web-"));
    // Make sure the host-side dir is writable by the container user.
    fs.chmodSync(dataDir, 0o777);
    const page = await startScriptedPage();
    const pageUrl = `http://host.docker.internal:${page.port}/`;
    try {
      const r = await docker(
        [
          "run",
          "--rm",
          "--user",
          `${ARBITRARY_UID}:${ARBITRARY_GID}`,
          "--cap-drop=ALL",
          "--security-opt=no-new-privileges",
          "--tmpfs",
          "/tmp:rw,nosuid,nodev,mode=1777",
          "--add-host=host.docker.internal:host-gateway",
          "-v",
          `${dataDir}:/data`,
          "-e",
          "DOCS_MCP_TELEMETRY=false",
          // The host is a private address, which the scraper refuses by default.
          "-e",
          "DOCS_MCP_SCRAPER_SECURITY_NETWORK_ALLOW_PRIVATE_NETWORKS=true",
          IMAGE_TAG,
          "scrape",
          "docker-e2e-web",
          pageUrl,
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
      expect(indexedContent(dbPath, pageUrl)).toContain(RENDERED_TEXT);
    } finally {
      await page.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  }, 240_000);

  it("renders with the image's Chromium instead of downloading Playwright's", async () => {
    const page = await startScriptedPage();
    const pageUrl = `http://host.docker.internal:${page.port}/`;
    try {
      // fetch-url makes sure a browser is installed before it renders. A
      // download would land in Playwright's cache in the user's home.
      const r = await docker(
        [
          "run",
          "--rm",
          "--add-host=host.docker.internal:host-gateway",
          "-e",
          "DOCS_MCP_TELEMETRY=false",
          "-e",
          "DOCS_MCP_SCRAPER_SECURITY_NETWORK_ALLOW_PRIVATE_NETWORKS=true",
          "--entrypoint",
          "sh",
          IMAGE_TAG,
          "-c",
          `node dist/index.js fetch-url ${pageUrl} --scrape-mode playwright && test ! -e "$HOME/.cache/ms-playwright"`,
        ],
        { timeout: 180_000 },
      );
      expect(r.status, `stdout=${r.stdout}\nstderr=${r.stderr}`).toBe(0);
      expect(r.stdout).toContain(RENDERED_TEXT);
    } finally {
      await page.close();
    }
  }, 240_000);

  it("renders a live JavaScript documentation site through the Playwright pipeline", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "docs-mcp-docker-live-"));
    fs.chmodSync(dataDir, 0o777);
    // Docsify serves an empty `<div id="app">`. Its scripts, loaded from a CDN,
    // fetch README.md and render it, so the tagline below reaches the store only
    // when Chromium ran them; the shell's meta description lacks "site". A
    // Chromium that starts but cannot load the scripts renders an empty app,
    // which only the content check catches.
    const siteUrl = "https://docsify.js.org/";
    try {
      const r = await docker(
        [
          "run",
          "--rm",
          "-v",
          `${dataDir}:/data`,
          "-e",
          "DOCS_MCP_TELEMETRY=false",
          IMAGE_TAG,
          "scrape",
          "docker-e2e-live",
          siteUrl,
          "--max-pages",
          "1",
          "--max-depth",
          "0",
          "--scrape-mode",
          "playwright",
        ],
        { timeout: 180_000 },
      );
      const output = `stdout=${r.stdout}\nstderr=${r.stderr}`;
      expect(r.status, output).toBe(0);
      expect(
        indexedContent(path.join(dataDir, "documents.db"), siteUrl),
        output,
      ).toContain("A magical documentation site generator");
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
          `${ARBITRARY_UID}:${ARBITRARY_GID}`,
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
    // the unprivileged runtime user; the writable /data mount
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

  it.each(
    [
      { name: "no-argument startup", args: [], mcp: true },
      { name: "startup with only --verbose", args: ["--verbose"], mcp: true },
      {
        name: "the explicit web subcommand",
        args: ["web", "--host", "0.0.0.0", "--port", "6280"],
        mcp: false,
      },
    ].flatMap((startup) =>
      [
        { identity: "default user", userArgs: [] },
        {
          identity: "arbitrary uid and gid",
          userArgs: ["--user", `${ARBITRARY_UID}:${ARBITRARY_GID}`],
        },
      ].map((identity) => ({ ...startup, ...identity })),
    ),
  )(
    "serves HTTP through $name with a read-only root filesystem as $identity",
    async ({ args, mcp, userArgs }) => {
      // Run the web server detached and let Docker pick a free host port (-P), so
      // the test never clashes with a port already bound on the CI host. The
      // image sets DOCS_MCP_STORE_PATH=/data (writable), so no mount is needed —
      // an empty store still serves the UI and system-health API.
      const run = await docker([
        "run",
        "-d",
        "--rm",
        ...userArgs,
        "--read-only",
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges",
        "--tmpfs",
        "/tmp:rw,nosuid,nodev,mode=1777",
        "--tmpfs",
        "/app/.runtime:rw,nosuid,nodev,mode=1777",
        "-P",
        "-e",
        "DOCS_MCP_TELEMETRY=false",
        IMAGE_TAG,
        ...args,
      ]);
      expect(run.status, `docker run failed: ${run.stderr}`).toBe(0);
      const containerId = run.stdout.trim();
      try {
        // Resolve the mapped host port (e.g. "0.0.0.0:49153").
        const portRes = await docker(["port", containerId, "6280"]);
        const portMatch = portRes.stdout.match(/:(\d+)/);
        expect(
          portMatch,
          `could not resolve mapped port from: ${portRes.stdout}`,
        ).not.toBeNull();
        const base = `http://127.0.0.1:${portMatch?.[1]}`;

        // Poll until the server is listening (container boot + Fastify listen).
        let ready = false;
        for (let i = 0; i < 60 && !ready; i++) {
          const status = await containerFetch(containerId, base, "/")
            .then((r) => r.status)
            .catch(() => 0);
          if (status === 200) ready = true;
          else await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        if (!ready) {
          const logs = await docker(["logs", containerId]);
          throw new Error(
            `HTTP server did not become ready within 60s:\n${logs.stdout}\n${logs.stderr}`,
          );
        }

        // 1. The SPA shell is served at the root.
        const root = await containerFetch(containerId, base, "/");
        expect(root.status).toBe(200);
        expect(root.contentType).toMatch(/text\/html/);
        const html = root.body;
        expect(html, "root should return the SPA shell").toContain('<div id="root">');

        // 2. The hashed JS bundle referenced by the shell is served.
        const assetPath = html.match(/\/assets\/index-[\w-]+\.js/)?.[0];
        expect(assetPath, "index.html should reference a hashed JS asset").toBeTruthy();
        const asset = await containerFetch(containerId, base, assetPath ?? "");
        expect(asset.status).toBe(200);
        expect(asset.contentType).toMatch(/javascript/);

        // 3. A client-side route falls back to the SPA shell (not a 404).
        const deep = await containerFetch(containerId, base, "/libraries");
        expect(deep.status).toBe(200);
        expect(deep.body).toContain('<div id="root">');

        // 4. The tRPC API is mounted under /api and returns real system health.
        const api = await containerFetch(containerId, base, "/api/getSystemHealth");
        expect(api.status).toBe(200);
        expect(api.contentType).toMatch(/application\/json/);
        const body = JSON.parse(api.body) as {
          result?: {
            data?: {
              json?: {
                worker?: { mode?: string };
                services?: {
                  web?: boolean;
                  api?: boolean;
                  mcp?: boolean;
                  worker?: boolean;
                };
              };
            };
          };
        };
        expect(body.result?.data?.json?.worker?.mode).toBe("embedded");
        expect(body.result?.data?.json?.services).toEqual({
          web: true,
          api: true,
          mcp,
          worker: true,
        });
        if (mcp && CONTAINER_ENGINE === "podman") {
          // Use the container network for the same gvproxy limitation as containerFetch.
          const script = [
            'import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";',
            'const client = new Client({ name: "docker-http-test", version: "1.0.0" });',
            'try { await client.connect(new StreamableHTTPClientTransport(new URL("http://127.0.0.1:6280/mcp")));',
            "console.log(JSON.stringify((await client.listTools()).tools.map((tool) => tool.name)));",
            "} finally { await client.close(); }",
          ].join("");
          const result = await docker([
            "exec",
            containerId,
            "node",
            "--input-type=module",
            "-e",
            script,
          ]);
          expect(result.status, result.stderr).toBe(0);
          expect(JSON.parse(result.stdout)).toContain("search_docs");
        } else if (mcp) {
          const client = new Client({ name: "docker-http-test", version: "1.0.0" });
          try {
            await client.connect(
              new StreamableHTTPClientTransport(new URL("/mcp", base)),
            );
            const tools = await client.listTools();
            expect(tools.tools.map((tool) => tool.name)).toContain("search_docs");
          } finally {
            await client.close();
          }
        }
      } finally {
        await docker(["rm", "-f", "-v", containerId]);
      }
    },
    120_000,
  );

  it.each([
    {
      name: "generic runtime environment over the protocol alias",
      envArgs: ["-e", "DOCS_MCP_SERVER_PROTOCOL=stdio"],
      cliArgs: [],
    },
    {
      name: "runtime protocol alias",
      envArgs: ["-e", "DOCS_MCP_PROTOCOL=stdio"],
      cliArgs: [],
    },
    {
      name: "CLI arguments over an HTTP environment override",
      envArgs: ["-e", "DOCS_MCP_SERVER_PROTOCOL=http"],
      cliArgs: ["--protocol", "stdio"],
    },
  ])(
    "serves MCP over stdio selected by $name",
    async ({ envArgs, cliArgs }) => {
      const containerName = `docs-mcp-stdio-${randomUUID()}`;
      const transport = new StdioClientTransport({
        command: CONTAINER_ENGINE,
        args: [
          "run",
          "-i",
          "--name",
          containerName,
          "-e",
          "DOCS_MCP_TELEMETRY=false",
          ...envArgs,
          IMAGE_TAG,
          ...cliArgs,
        ],
      });
      const client = new Client({ name: "docker-stdio-test", version: "1.0.0" });
      try {
        await client.connect(transport);
        const tools = await client.listTools();
        expect(tools.tools.map((tool) => tool.name)).toContain("search_docs");
      } finally {
        try {
          await client.close();
        } finally {
          try {
            await transport.close();
          } finally {
            await docker(["rm", "-f", "-v", containerName]);
          }
        }
      }
    },
    60_000,
  );

  it.each([
    {
      name: "image defaults",
      envArgs: [],
      expected: { protocol: "http", host: "0.0.0.0", port: 6280 },
    },
    {
      name: "generic runtime host override over aliases",
      envArgs: [
        "-e",
        "DOCS_MCP_SERVER_HOST=127.0.0.1",
        "-e",
        "DOCS_MCP_HOST=0.0.0.0",
        "-e",
        "HOST=0.0.0.0",
      ],
      expected: { protocol: "http", host: "127.0.0.1", port: 6280 },
    },
    {
      name: "runtime DOCS_MCP_HOST alias",
      envArgs: ["-e", "DOCS_MCP_HOST=127.0.0.1"],
      expected: { protocol: "http", host: "127.0.0.1", port: 6280 },
    },
    {
      name: "runtime HOST alias",
      envArgs: ["-e", "HOST=127.0.0.1"],
      expected: { protocol: "http", host: "127.0.0.1", port: 6280 },
    },
    {
      name: "runtime port override",
      envArgs: ["-e", "DOCS_MCP_SERVER_PORTS_DEFAULT=6380"],
      expected: { protocol: "http", host: "0.0.0.0", port: 6380 },
    },
  ])("resolves server configuration from $name", async ({ envArgs, expected }) => {
    const r = await docker([
      "run",
      "--rm",
      "-e",
      "DOCS_MCP_TELEMETRY=false",
      ...envArgs,
      IMAGE_TAG,
      "config",
      "get",
      "server",
    ]);
    expect(r.status, `config get failed: ${r.stderr}`).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({
      protocol: expected.protocol,
      host: expected.host,
      ports: { default: expected.port },
    });
  });
});
