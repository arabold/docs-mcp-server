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
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
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
const PRODUCTION_COMPOSE_PATH = path.join(
  PROJECT_ROOT,
  "deploy",
  "remote-grounded",
  "docker-compose.yml",
);
const PRODUCTION_WORKER_ENV_EXAMPLE_PATH = path.join(
  PROJECT_ROOT,
  "deploy",
  "remote-grounded",
  "worker.env.example",
);
const PRODUCTION_DEPLOYMENT_README_PATH = path.join(
  PROJECT_ROOT,
  "deploy",
  "remote-grounded",
  "README.md",
);
// Created by accepted base image 5ae5b7de against test/fixtures/json.json.
const EXISTING_RERANKER_DB_FIXTURE = path.join(
  PROJECT_ROOT,
  "test",
  "fixtures",
  "reranker-existing-documents.db.gz.base64",
);
const RERANKER_MOCK_FIXTURE = path.join(
  PROJECT_ROOT,
  "test",
  "fixtures",
  "mock-voyage-reranker.mjs",
);
const RERANKER_COMPOSE_OVERRIDE = path.join(
  PROJECT_ROOT,
  "test",
  "fixtures",
  "reranker-compose.override.yml",
);
const DOCKER_BUILD_TIMEOUT_MS = 1_200_000;

interface DockerResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

interface DatabaseSnapshot {
  userVersion: number;
  schema: string[];
  counts: { documents: number; libraries: number; pages: number; versions: number };
}

interface DistributedStackEvidence {
  before: DatabaseSnapshot;
  after: DatabaseSnapshot;
  composeStatus: string;
  webHealth: string;
  readOnlySearch: string;
  administrativeSearch: string;
  workerLogs: string;
}

interface ComposeTestContext {
  args: string[];
  environment: NodeJS.ProcessEnv;
}

// Runs `docker` asynchronously rather than via spawnSync. These commands can
// run for minutes (image build, Playwright scrapes); a synchronous call
// blocks Node's event loop for that whole time, which starves Vitest's
// worker <-> main-thread RPC heartbeat and trips its 60s "onTaskUpdate"
// timeout as a false-positive unhandled error.
function docker(
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeout?: number } = {},
): Promise<DockerResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, {
      cwd: opts.cwd,
      env: opts.env,
      timeout: opts.timeout,
    });
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

function snapshotDatabase(dbPath: string): DatabaseSnapshot {
  const db = new Database(dbPath, { readonly: true });
  try {
    const userVersion = db.pragma("user_version", { simple: true }) as number;
    const schema = db
      .prepare(
        "SELECT type || ':' || name || ':' || COALESCE(sql, '') AS entry FROM sqlite_master ORDER BY type, name",
      )
      .all()
      .map((row) => (row as { entry: string }).entry);
    const count = (table: string) =>
      (db.prepare(`SELECT COUNT(*) AS value FROM ${table}`).get() as { value: number })
        .value;
    return {
      userVersion,
      schema,
      counts: {
        documents: count("documents"),
        libraries: count("libraries"),
        pages: count("pages"),
        versions: count("versions"),
      },
    };
  } finally {
    db.close();
  }
}

async function waitForHttp(
  url: string,
  attempts = 60,
  requireOk = true,
): Promise<Response> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const response = await fetch(url, { signal: AbortSignal.timeout(1000) }).catch(
      () => null,
    );
    if (response && (!requireOk || response.ok)) return response;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`HTTP endpoint did not become ready: ${url}`);
}

async function mappedContainerUrl(containerId: string, port: number): Promise<string> {
  const result = await docker(["port", containerId, String(port)]);
  const match = result.stdout.match(/:(\d+)/);
  if (!match) {
    throw new Error(`Could not resolve mapped port: ${result.stdout || result.stderr}`);
  }
  return `http://127.0.0.1:${match[1]}`;
}

async function callSearchTool(baseUrl: string): Promise<string> {
  const transport = new SSEClientTransport(new URL("/sse", baseUrl), {
    fetch: async (input, init) => {
      const response = await fetch(input, init);
      if (response.body) {
        response.body.cancel = async () => undefined;
      }
      return response;
    },
  });
  const client = new Client({ name: "docker-e2e", version: "1.0.0" });
  try {
    const timeout = new Promise<never>((_resolve, reject) =>
      setTimeout(() => reject(new Error(`MCP search timed out: ${baseUrl}`)), 30_000),
    );
    await Promise.race([client.connect(transport), timeout]);
    const result = await Promise.race([
      client.callTool({
        name: "search_docs",
        arguments: {
          library: "docker-reranker",
          query: "WonderWidgets",
          limit: 2,
        },
      }),
      timeout,
    ]);
    return JSON.stringify(result);
  } finally {
    await client.close().catch(() => undefined);
  }
}

async function productionComposeServiceUrl(
  context: ComposeTestContext,
  service: string,
): Promise<string> {
  const result = await dockerCompose(context, ["port", service, "6280"]);
  const match = result.stdout.match(/:(\d+)/);
  if (result.status !== 0 || !match) {
    throw new Error(`Could not resolve ${service} port: ${result.stderr}`);
  }
  return `http://127.0.0.1:${match[1]}`;
}

function dockerCompose(
  context: ComposeTestContext,
  args: string[],
  options: { timeout?: number } = {},
): Promise<DockerResult> {
  return docker([...context.args, ...args], {
    env: context.environment,
    timeout: options.timeout,
  });
}

async function exerciseProductionComposeStack(): Promise<DistributedStackEvidence> {
  const suffix = `${process.pid}-${Date.now()}`;
  const projectName = `docs-mcp-reranker-${suffix}`;
  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "docs-mcp-compose-stack-"));
  const dataDir = path.join(testDir, "data");
  const workerEnvPath = path.join(testDir, "worker.env");
  fs.mkdirSync(dataDir);
  fs.chmodSync(dataDir, 0o777);
  const fixture = fs
    .readFileSync(EXISTING_RERANKER_DB_FIXTURE, "utf8")
    .replace(/\s/g, "");
  fs.writeFileSync(
    path.join(dataDir, "documents.db"),
    gunzipSync(Buffer.from(fixture, "base64")),
  );
  fs.writeFileSync(workerEnvPath, "VOYAGE_API_KEY=test-only-worker-key\n");

  const dbPath = path.join(dataDir, "documents.db");
  const before = snapshotDatabase(dbPath);
  const composeContext: ComposeTestContext = {
    args: [
      "compose",
      "--project-name",
      projectName,
      "-f",
      PRODUCTION_COMPOSE_PATH,
      "-f",
      RERANKER_COMPOSE_OVERRIDE,
    ],
    environment: {
      ...process.env,
      DOCS_MCP_IMAGE: IMAGE_TAG,
      TEST_DATA_DIR: dataDir,
      TEST_MOCK_PATH: RERANKER_MOCK_FIXTURE,
      TEST_WORKER_ENV: workerEnvPath,
    },
  };

  let runningEvidence: Omit<DistributedStackEvidence, "after"> | undefined;
  try {
    try {
      const up = await dockerCompose(
        composeContext,
        ["up", "-d", "--wait", "--wait-timeout", "120"],
        { timeout: 180_000 },
      );
      if (up.status !== 0) {
        throw new Error(`Production Compose startup failed: ${up.stderr}`);
      }
      const status = await dockerCompose(composeContext, [
        "ps",
        "--format",
        "json",
      ]);
      const webUrl = await productionComposeServiceUrl(composeContext, "web");
      const readOnlyUrl = await productionComposeServiceUrl(
        composeContext,
        "mcp-read",
      );
      const administrativeUrl = await productionComposeServiceUrl(
        composeContext,
        "mcp-admin",
      );
      const webHealth = await (
        await waitForHttp(`${webUrl}/api/getSystemHealth`)
      ).text();
      const readOnlySearch = await callSearchTool(readOnlyUrl);
      const administrativeSearch = await callSearchTool(administrativeUrl);
      const logs = await dockerCompose(composeContext, [
        "logs",
        "--no-color",
        "worker",
      ]);
      runningEvidence = {
        before,
        composeStatus: status.stdout,
        webHealth,
        readOnlySearch,
        administrativeSearch,
        workerLogs: logs.stdout + logs.stderr,
      };
    } finally {
      const down = await dockerCompose(
        composeContext,
        ["down", "--volumes", "--remove-orphans"],
        { timeout: 120_000 },
      );
      if (down.status !== 0) {
        throw new Error(`Production Compose cleanup failed: ${down.stderr}`);
      }
    }

    if (!runningEvidence) {
      throw new Error("Production Compose evidence was not captured");
    }
    return { ...runningEvidence, after: snapshotDatabase(dbPath) };
  } finally {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
}

describe("Production deployment documentation", () => {
  const instructions = fs.readFileSync(PRODUCTION_DEPLOYMENT_README_PATH, "utf8");

  it("creates the worker secret file without clobbering it and with mode 0600", () => {
    expect(instructions).toContain(
      "install -m 600 worker.env.example .env.worker",
    );
    expect(instructions).toContain("chmod 600 .env.worker");
    expect(instructions).not.toContain("cp -n worker.env.example .env.worker");
  });

  it("validates Compose without rendering its credential-bearing environment", () => {
    expect(instructions).toContain(
      "docker compose -f deploy/remote-grounded/docker-compose.yml config --quiet",
    );
    expect(instructions).not.toContain(
      "docker compose -f deploy/remote-grounded/docker-compose.yml config\n",
    );
  });

  it("documents publishing and deploying only an immutable registry digest", () => {
    expect(instructions).toContain(
      "registry.example/docs-mcp-server:issue-9-<git-sha>",
    );
    expect(instructions).toContain(
      "Set `DOCS_MCP_IMAGE` only to the recorded `name@sha256:...` digest",
    );
    expect(instructions).not.toContain("immutable tag or digest");
  });
});

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

  it("keeps the production reranker credential on the search worker", () => {
    const deployDir = fs.mkdtempSync(path.join(os.tmpdir(), "docs-mcp-compose-"));
    const composePath = path.join(deployDir, "docker-compose.yml");
    fs.copyFileSync(PRODUCTION_COMPOSE_PATH, composePath);
    const workerEnvironment = fs
      .readFileSync(PRODUCTION_WORKER_ENV_EXAMPLE_PATH, "utf8")
      .replace("<existing-openai-api-key>", "test-only-embedding-key")
      .replace("<voyage-api-key>", "test-only-key");
    fs.writeFileSync(path.join(deployDir, ".env.worker"), workerEnvironment);
    fs.mkdirSync(path.join(deployDir, "imports", "ONEC_ERP"), { recursive: true });

    try {
      const result = spawnSync(
        "docker",
        ["compose", "-f", composePath, "config", "--format", "json"],
        {
          cwd: deployDir,
          encoding: "utf8",
          env: {
            ...process.env,
            DOCS_MCP_IMAGE: "docs-mcp-server@sha256:test-only-immutable-digest",
          },
        },
      );
      expect(result.status, result.stderr).toBe(0);
      const config = JSON.parse(result.stdout) as {
        services: Record<
          string,
          { environment?: Record<string, string>; image?: string }
        >;
      };
      const worker = config.services.worker;
      expect(worker.image).toBe(
        "docs-mcp-server@sha256:test-only-immutable-digest",
      );
      expect(worker.environment?.DOCS_MCP_SEARCH_RERANKER_ENABLED).toBe("true");
      expect(worker.environment?.DOCS_MCP_SEARCH_RERANKER_CANDIDATE_LIMIT).toBe(
        "30",
      );
      expect(worker.environment?.DOCS_MCP_EMBEDDING_MODEL).toBe(
        "openai:baai/bge-m3",
      );
      expect(worker.environment?.DOCS_MCP_EMBEDDINGS_VECTOR_DIMENSION).toBe(
        "1024",
      );
      expect(worker.environment?.OPENAI_API_KEY).toBe("test-only-embedding-key");
      expect(worker.environment?.VOYAGE_API_KEY).toBe("test-only-key");

      for (const serviceName of ["web", "mcp-read", "mcp-admin"]) {
        const service = config.services[serviceName];
        expect(service.image).toBe(worker.image);
        expect(service.environment).not.toHaveProperty("VOYAGE_API_KEY");
        expect(service.environment).not.toHaveProperty(
          "DOCS_MCP_SEARCH_RERANKER_ENABLED",
        );
        expect(service.environment).not.toHaveProperty(
          "DOCS_MCP_SEARCH_RERANKER_CANDIDATE_LIMIT",
        );
        expect(service.environment).not.toHaveProperty("OPENAI_API_KEY");
      }
    } finally {
      fs.rmSync(deployDir, { recursive: true, force: true });
    }
  });

  it("fails an enabled local search process at startup without VOYAGE_API_KEY", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "docs-mcp-missing-key-"));
    fs.chmodSync(dataDir, 0o777);
    try {
      const result = await docker([
        "run",
        "--rm",
        "-v",
        `${dataDir}:/data`,
        "-e",
        "DOCS_MCP_TELEMETRY=false",
        "-e",
        "DOCS_MCP_SEARCH_RERANKER_ENABLED=true",
        IMAGE_TAG,
        "worker",
        "--host",
        "127.0.0.1",
        "--port",
        "8080",
      ]);
      const output = `${result.stdout}\n${result.stderr}`;
      expect(result.status).not.toBe(0);
      expect(output).toContain("VOYAGE_API_KEY");
      expect(output).toContain("Missing required environment variable");
      expect(output).not.toMatch(/api\.voyageai\.com|Bearer\s|sk-[A-Za-z0-9]/);
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  describe("production worker reranking Compose stack", () => {
    let evidence: DistributedStackEvidence;

    beforeAll(async () => {
      evidence = await exerciseProductionComposeStack();
    }, 300_000);

    it("starts every service healthy with remote web and MCP initialization", () => {
      expect(evidence.composeStatus).toContain('"Health":"healthy"');
      expect(evidence.webHealth).toContain('"mode":"remote"');
    });

    it("routes read-only and administrative MCP search through worker reranking", () => {
      expect(evidence.readOnlySearch).toContain("WonderWidgets");
      expect(evidence.administrativeSearch).toContain("WonderWidgets");
      expect(evidence.workerLogs.match(/TEST_RERANK_CALLED/g)).toHaveLength(2);
    });

    it("keeps the worker credential out of runtime logs", () => {
      expect(evidence.workerLogs).not.toContain("test-only-worker-key");
    });

    it("opens existing SQLite data without schema changes or reindexing", () => {
      expect(evidence.before.counts.documents).toBeGreaterThan(0);
      expect(evidence.after).toEqual(evidence.before);
    });
  });
  it("runs the entrypoint as a non-root user", async () => {
    const r = await docker(["run", "--rm", "--entrypoint", "id", IMAGE_TAG, "-u"]);
    expect(r.status, `id -u failed: ${r.stderr}`).toBe(0);
    const uid = r.stdout.trim();
    expect(uid).not.toBe("0");
    expect(uid).toBe("1000"); // the `node` user shipped by the base image
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
    // Make sure the host-side dir is writable by uid 1000 (the container user).
    fs.chmodSync(dataDir, 0o777);
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

  it("serves the web UI over HTTP (SPA shell, hashed asset, deep-link fallback, and API)", async () => {
    // Run the web server detached and let Docker pick a free host port (-P), so
    // the test never clashes with a port already bound on the CI host. The
    // image sets DOCS_MCP_STORE_PATH=/data (writable), so no mount is needed —
    // an empty store still serves the UI and system-health API.
    const run = await docker([
      "run",
      "-d",
      "--rm",
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
