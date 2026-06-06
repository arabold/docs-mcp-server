import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import yaml from "yaml";
import { expandConfiguredRoot } from "./accessPolicy";
import {
  camelToUpperSnake,
  collectLeafPaths,
  defaults,
  getConfigValue,
  isValidConfigPath,
  isVectorDimensionExplicit,
  loadConfig,
  parseConfigValue,
  pathToEnvVar,
} from "./config";
import { normalizeEnvValue } from "./env";

// Mock env-paths to return a controlled system path
vi.mock("env-paths", () => ({
  default: () => ({
    config: `${process.cwd()}/.vitest-config-mock`,
    data: `${process.cwd()}/.vitest-data-mock`,
  }),
}));

// Mock paths to control project root detection
vi.mock("./paths", () => ({
  getProjectRoot: vi.fn().mockReturnValue(undefined), // Default to undefined to rely on explicit searchDirs
}));

describe("Configuration Loading", () => {
  let tmpDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Create temp directory for each test
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "docs-mcp-config-test-"));
    originalEnv = { ...process.env };
    fs.rmSync(path.join(process.cwd(), ".vitest-config-mock"), {
      recursive: true,
      force: true,
    });

    // Clear relevant env vars
    delete process.env.DOCS_MCP_CONFIG;
    delete process.env.DOCS_MCP_TELEMETRY;
    delete process.env.DOCS_MCP_READ_ONLY;
    delete process.env.DOCS_MCP_STORE_PATH;
    delete process.env.DOCS_MCP_AUTH_ENABLED;
  });

  afterEach(() => {
    // Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(path.join(process.cwd(), ".vitest-config-mock"), {
      recursive: true,
      force: true,
    });
    process.env = originalEnv;
    vi.resetAllMocks();
  });

  describe("Integration & E2E Scenarios", () => {
    it("should load system defaults and WRITE back when no config provided", () => {
      const config = loadConfig({}, {}); // No args -> Default System Path

      expect(config.server.host).toBe("127.0.0.1");
      expect(
        fs.existsSync(path.join(process.cwd(), ".vitest-config-mock", "config.yaml")),
      ).toBe(true);
    });

    it("should load explicit config from --config and NOT write back", () => {
      const configPath = path.join(tmpDir, "read-only-config.yaml");
      const initialContent = "app:\n  telemetryEnabled: false\n";
      fs.writeFileSync(configPath, initialContent);

      // Verify file creation timestamp
      const statBefore = fs.statSync(configPath);

      // Wait a tick to ensure mtime diff if it were to write
      const start = Date.now();
      while (Date.now() - start < 10) {
        /* wait */
      }

      const config = loadConfig({ config: configPath });

      expect(config.app.telemetryEnabled).toBe(false);

      // Check it didn't write back defaults (like heartbeatMs)
      const contentAfter = fs.readFileSync(configPath, "utf8");
      // It should NOT contain default fields that weren't there
      expect(contentAfter).not.toContain("heartbeatMs");

      // Ensure file wasn't touched
      const statAfter = fs.statSync(configPath);
      expect(statAfter.mtimeMs).toBe(statBefore.mtimeMs);
    });

    it("should load explicit config from ENV and NOT write back", () => {
      const configPath = path.join(tmpDir, "env-config.yaml");
      const initialContent = "server:\n  port: 9999\n";
      fs.writeFileSync(configPath, initialContent);

      process.env.DOCS_MCP_CONFIG = configPath;

      const config = loadConfig({});

      expect(config.server.ports.default).toBe(6280); // Default for 'default' port
      // Wait, yaml was invalid? "port" vs "ports".
      // `loadConfig` merges defaults.

      const contentAfter = fs.readFileSync(configPath, "utf8");
      expect(contentAfter).not.toContain("heartbeatMs");
    });

    it("should priority: CLI > Env > Config File", () => {
      const configPath = path.join(tmpDir, "priority.yaml");
      fs.writeFileSync(configPath, "server:\n  host: file-host\n");

      process.env.DOCS_MCP_HOST = "env-host";

      const config = loadConfig({ host: "cli-host" }, { configPath });

      expect(config.server.host).toBe("cli-host");
    });
  });

  describe("Unit Logic & Edge Cases", () => {
    it("should handle nested defaults correctly (Assembly)", () => {
      const configPath = path.join(tmpDir, "defaults.yaml");
      fs.writeFileSync(configPath, "");
      const config = loadConfig({ config: configPath });
      expect(config.assembly.maxParentChainDepth).toBe(10);
    });

    it("should apply scraper retry and abort threshold defaults", () => {
      const configPath = path.join(tmpDir, "scraper-defaults.yaml");
      fs.writeFileSync(configPath, "");

      const config = loadConfig({ config: configPath });

      expect(config.scraper.fetcher.maxRetries).toBe(3);
      expect(config.scraper.abortOnFailureRate).toBe(0.5);
    });

    it("should recover from malformed config file by using defaults (Read-Only mode)", () => {
      // Should it overwrite? No, read-only mode should NOT overwrite even if invalid.
      const configPath = path.join(tmpDir, "malformed.yaml");
      fs.writeFileSync(configPath, ":");

      const config = loadConfig({ config: configPath });

      expect(config.server.host).toBe("127.0.0.1");

      // Verify file is UNTOUCHED
      const content = fs.readFileSync(configPath, "utf8");
      expect(content).toBe(":");
    });
  });
});

describe("Environment Variable Helpers", () => {
  describe("camelToUpperSnake", () => {
    it("converts simple camelCase", () => {
      expect(camelToUpperSnake("maxSize")).toBe("MAX_SIZE");
    });

    it("converts multiple humps", () => {
      expect(camelToUpperSnake("maxNestingDepth")).toBe("MAX_NESTING_DEPTH");
    });

    it("handles already uppercase", () => {
      expect(camelToUpperSnake("URL")).toBe("URL");
    });

    it("handles lowercase", () => {
      expect(camelToUpperSnake("host")).toBe("HOST");
    });
  });

  describe("pathToEnvVar", () => {
    it("converts simple path", () => {
      expect(pathToEnvVar(["scraper", "maxPages"])).toBe("DOCS_MCP_SCRAPER_MAX_PAGES");
    });

    it("converts deeply nested path", () => {
      expect(pathToEnvVar(["scraper", "document", "maxSize"])).toBe(
        "DOCS_MCP_SCRAPER_DOCUMENT_MAX_SIZE",
      );
    });

    it("converts path with camelCase segments", () => {
      expect(pathToEnvVar(["splitter", "json", "maxNestingDepth"])).toBe(
        "DOCS_MCP_SPLITTER_JSON_MAX_NESTING_DEPTH",
      );
    });

    it("converts nested security path", () => {
      expect(pathToEnvVar(["scraper", "security", "fileAccess", "followSymlinks"])).toBe(
        "DOCS_MCP_SCRAPER_SECURITY_FILE_ACCESS_FOLLOW_SYMLINKS",
      );
    });
  });

  describe("collectLeafPaths", () => {
    it("collects leaf paths from nested object", () => {
      const obj = {
        a: 1,
        b: {
          c: 2,
          d: { e: 3 },
        },
      };
      const paths = collectLeafPaths(obj);
      expect(paths).toContainEqual(["a"]);
      expect(paths).toContainEqual(["b", "c"]);
      expect(paths).toContainEqual(["b", "d", "e"]);
      expect(paths).toHaveLength(3);
    });

    it("handles empty object", () => {
      expect(collectLeafPaths({})).toEqual([]);
    });
  });
});

describe("Config CLI Helpers", () => {
  describe("isValidConfigPath", () => {
    it("returns true for valid paths", () => {
      expect(isValidConfigPath("scraper.maxPages")).toBe(true);
      expect(isValidConfigPath("scraper.document.maxSize")).toBe(true);
      expect(isValidConfigPath("app.telemetryEnabled")).toBe(true);
    });

    it("returns false for invalid paths", () => {
      expect(isValidConfigPath("invalid.path")).toBe(false);
      expect(isValidConfigPath("scraper.nonexistent")).toBe(false);
    });
  });

  describe("getConfigValue", () => {
    const mockConfig = {
      scraper: {
        maxPages: 1000,
        document: { maxSize: 10485760 },
      },
      app: { telemetryEnabled: true },
    };

    it("gets scalar value", () => {
      expect(getConfigValue(mockConfig as any, "scraper.maxPages")).toBe(1000);
    });

    it("gets nested object", () => {
      expect(getConfigValue(mockConfig as any, "scraper.document")).toEqual({
        maxSize: 10485760,
      });
    });

    it("returns undefined for invalid path", () => {
      expect(getConfigValue(mockConfig as any, "invalid.path")).toBeUndefined();
    });
  });

  describe("parseConfigValue", () => {
    it("parses integers", () => {
      expect(parseConfigValue("1000")).toBe(1000);
      expect(parseConfigValue("0")).toBe(0);
    });

    it("parses floats", () => {
      expect(parseConfigValue("3.14")).toBe(3.14);
    });

    it("parses booleans", () => {
      expect(parseConfigValue("true")).toBe(true);
      expect(parseConfigValue("false")).toBe(false);
      expect(parseConfigValue("TRUE")).toBe(true);
      expect(parseConfigValue("FALSE")).toBe(false);
    });

    it("returns strings for non-numeric/non-boolean", () => {
      expect(parseConfigValue("hello")).toBe("hello");
      expect(parseConfigValue("text-embedding-3-small")).toBe("text-embedding-3-small");
    });

    it("returns empty string as string", () => {
      expect(parseConfigValue("")).toBe("");
    });
  });
});

describe("normalizeEnvValue", () => {
  it("strips surrounding double quotes", () => {
    expect(normalizeEnvValue('"http://localhost:11434/v1"')).toBe(
      "http://localhost:11434/v1",
    );
  });

  it("strips surrounding single quotes", () => {
    expect(normalizeEnvValue("'http://localhost:11434/v1'")).toBe(
      "http://localhost:11434/v1",
    );
  });

  it("leaves unquoted strings unchanged", () => {
    expect(normalizeEnvValue("http://localhost:11434/v1")).toBe(
      "http://localhost:11434/v1",
    );
  });

  it("trims whitespace before checking quotes", () => {
    expect(normalizeEnvValue('  "http://localhost:11434/v1"  ')).toBe(
      "http://localhost:11434/v1",
    );
  });

  it("does not strip mismatched quotes", () => {
    expect(normalizeEnvValue("\"http://localhost:11434/v1'")).toBe(
      "\"http://localhost:11434/v1'",
    );
  });

  it("does not strip quotes that only appear on one side", () => {
    expect(normalizeEnvValue('"only-start')).toBe('"only-start');
    expect(normalizeEnvValue('only-end"')).toBe('only-end"');
  });

  it("handles empty string", () => {
    expect(normalizeEnvValue("")).toBe("");
  });

  it("handles string that is just quotes", () => {
    expect(normalizeEnvValue('""')).toBe("");
    expect(normalizeEnvValue("''")).toBe("");
  });
});

describe("Quoted configuration environment variable handling (GH-353)", () => {
  let originalEnv: NodeJS.ProcessEnv;
  let tmpDir: string;

  beforeEach(() => {
    originalEnv = { ...process.env };
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "docs-mcp-config-env-test-"));
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should strip double-quoted DOCS_MCP_EMBEDDING_MODEL", () => {
    process.env.DOCS_MCP_EMBEDDING_MODEL = '"openai:nomic-embed-text"';

    const config = loadConfig(
      {},
      { configPath: path.join(tmpDir, "quoted-config.yaml") },
    );

    expect(config.app.embeddingModel).toBe("openai:nomic-embed-text");
  });

  it("should strip single-quoted DOCS_MCP_EMBEDDING_MODEL", () => {
    process.env.DOCS_MCP_EMBEDDING_MODEL = "'openai:nomic-embed-text'";

    const config = loadConfig(
      {},
      { configPath: path.join(tmpDir, "quoted-config.yaml") },
    );

    expect(config.app.embeddingModel).toBe("openai:nomic-embed-text");
  });

  it("should strip double-quoted OPENAI_API_KEY", () => {
    process.env.OPENAI_API_KEY = '"ollama"';

    const config = loadConfig(
      {},
      { configPath: path.join(tmpDir, "quoted-config.yaml") },
    );

    // The key itself isn't in AppConfig, but the embedding model should default correctly
    // when OPENAI_API_KEY is truthy (even quoted)
    expect(config.app.embeddingModel).toBeTruthy();
  });

  it("should strip quotes from auto-generated env vars", () => {
    process.env.DOCS_MCP_SCRAPER_MAX_PAGES = '"500"';

    const config = loadConfig(
      {},
      { configPath: path.join(tmpDir, "quoted-config.yaml") },
    );

    expect(config.scraper.maxPages).toBe(500);
  });
});

describe("Auto-generated Environment Variable Overrides", () => {
  let originalEnv: NodeJS.ProcessEnv;
  let tmpDir: string;

  beforeEach(() => {
    originalEnv = { ...process.env };
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "docs-mcp-config-auto-env-test-"));
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("applies auto-generated env var override", () => {
    process.env.DOCS_MCP_SCRAPER_MAX_PAGES = "500";

    const config = loadConfig(
      {},
      { configPath: path.join(tmpDir, "auto-env-config.yaml") },
    );

    expect(config.scraper.maxPages).toBe(500);
  });

  it("auto-generated env var takes precedence over explicit alias", () => {
    process.env.PORT = "3000";
    process.env.DOCS_MCP_SERVER_PORTS_DEFAULT = "4000";

    const config = loadConfig(
      {},
      { configPath: path.join(tmpDir, "auto-env-config.yaml") },
    );

    expect(config.server.ports.default).toBe(4000);
  });

  it("applies deeply nested env var", () => {
    process.env.DOCS_MCP_SCRAPER_DOCUMENT_MAX_SIZE = "52428800";

    const config = loadConfig(
      {},
      { configPath: path.join(tmpDir, "auto-env-config.yaml") },
    );

    expect(config.scraper.document.maxSize).toBe(52428800);
  });

  it("applies scraper abort-on-failure-rate env var override", () => {
    process.env.DOCS_MCP_SCRAPER_ABORT_ON_FAILURE_RATE = "0.25";

    const config = loadConfig(
      {},
      { configPath: path.join(tmpDir, "auto-env-config.yaml") },
    );

    expect(config.scraper.abortOnFailureRate).toBe(0.25);
  });

  describe("scraper.skipKnownTrackers", () => {
    it("defaults to true when nothing is set", () => {
      const config = loadConfig(
        {},
        { configPath: path.join(tmpDir, "tracker-default.yaml") },
      );

      expect(config.scraper.skipKnownTrackers).toBe(true);
    });

    it("respects a file-set value", () => {
      const configPath = path.join(tmpDir, "tracker-file.yaml");
      fs.writeFileSync(configPath, "scraper:\n  skipKnownTrackers: false\n");

      const config = loadConfig({}, { configPath });

      expect(config.scraper.skipKnownTrackers).toBe(false);
    });

    it("respects env override", () => {
      process.env.DOCS_MCP_SCRAPER_SKIP_KNOWN_TRACKERS = "false";

      const config = loadConfig(
        {},
        { configPath: path.join(tmpDir, "tracker-env.yaml") },
      );

      expect(config.scraper.skipKnownTrackers).toBe(false);
    });

    it("env takes precedence over a conflicting file value", () => {
      const configPath = path.join(tmpDir, "tracker-precedence.yaml");
      fs.writeFileSync(configPath, "scraper:\n  skipKnownTrackers: true\n");
      process.env.DOCS_MCP_SCRAPER_SKIP_KNOWN_TRACKERS = "false";

      const config = loadConfig({}, { configPath });

      expect(config.scraper.skipKnownTrackers).toBe(false);
    });

    it("fills in the new key when reading a pre-existing config that lacks it", () => {
      // Simulate a config file written by a prior release that lacked the key.
      // Explicit configPath is read-only (no disk-rewrite), but the resolved
      // config still gains the new default.
      const configPath = path.join(tmpDir, "tracker-upgrade.yaml");
      fs.writeFileSync(configPath, "scraper:\n  maxPages: 42\n");

      const config = loadConfig({}, { configPath });

      expect(config.scraper.skipKnownTrackers).toBe(true);
      expect(config.scraper.maxPages).toBe(42);
    });
  });

  it("rejects vectorDimension of 0 or negative values", () => {
    // vectorDimension = 0 should fail Zod .min(1) validation
    process.env.DOCS_MCP_EMBEDDINGS_VECTOR_DIMENSION = "0";
    expect(() =>
      loadConfig({}, { configPath: path.join(tmpDir, "dim-zero.yaml") }),
    ).toThrow();

    // vectorDimension = -1 should also fail
    process.env.DOCS_MCP_EMBEDDINGS_VECTOR_DIMENSION = "-1";
    expect(() =>
      loadConfig({}, { configPath: path.join(tmpDir, "dim-neg.yaml") }),
    ).toThrow();
  });

  describe("embeddings.vectorDimension explicitness", () => {
    const systemConfigPath = () =>
      path.join(process.cwd(), ".vitest-config-mock", "config.yaml");

    it("omits generated default vectorDimension from the managed default config", () => {
      const config = loadConfig({}, {});
      const content = fs.readFileSync(systemConfigPath(), "utf8");
      const parsed = yaml.parse(content) as {
        embeddings?: { vectorDimension?: unknown };
      };

      expect(isVectorDimensionExplicit(config)).toBe(false);
      expect(parsed.embeddings?.vectorDimension).toBeUndefined();
      expect(content).toContain("docs-mcp-server-managed-vector-dimension-omitted");
    });

    it("treats a default vectorDimension in a managed config as explicit", () => {
      loadConfig({}, {});
      const generated = fs.readFileSync(systemConfigPath(), "utf8");
      const marker = generated
        .split("\n")
        .filter((line) => line.startsWith("#"))
        .join("\n");
      fs.writeFileSync(
        systemConfigPath(),
        `${marker}\nembeddings:\n  vectorDimension: ${defaults.embeddings.vectorDimension}\n`,
      );

      const config = loadConfig({}, {});

      expect(config.embeddings.vectorDimension).toBe(defaults.embeddings.vectorDimension);
      expect(isVectorDimensionExplicit(config)).toBe(true);
      expect(fs.readFileSync(systemConfigPath(), "utf8")).toContain("vectorDimension");
    });

    it("migrates legacy generated default vectorDimension to implicit omission", () => {
      fs.mkdirSync(path.dirname(systemConfigPath()), { recursive: true });
      fs.writeFileSync(systemConfigPath(), yaml.stringify(defaults));

      const config = loadConfig({}, {});
      const content = fs.readFileSync(systemConfigPath(), "utf8");
      const parsed = yaml.parse(content) as {
        embeddings?: { vectorDimension?: unknown };
      };

      expect(isVectorDimensionExplicit(config)).toBe(false);
      expect(parsed.embeddings?.vectorDimension).toBeUndefined();
      expect(content).toContain("docs-mcp-server-managed-vector-dimension-omitted");
    });

    it("treats a user-authored default vectorDimension as explicit", () => {
      fs.mkdirSync(path.dirname(systemConfigPath()), { recursive: true });
      fs.writeFileSync(
        systemConfigPath(),
        `embeddings:\n  vectorDimension: ${defaults.embeddings.vectorDimension}\n`,
      );

      const config = loadConfig({}, {});

      expect(config.embeddings.vectorDimension).toBe(defaults.embeddings.vectorDimension);
      expect(isVectorDimensionExplicit(config)).toBe(true);
    });
  });

  it("loads scraper security defaults", () => {
    const config = loadConfig(
      {},
      { configPath: path.join(tmpDir, "security-defaults.yaml") },
    );

    expect(config.scraper.security.network.allowPrivateNetworks).toBe(false);
    expect(config.scraper.security.network.allowedHosts).toEqual([]);
    expect(config.scraper.security.network.allowedCidrs).toEqual([]);
    expect(config.scraper.security.network.allowInvalidTls).toBe(false);
    expect(config.scraper.security.fileAccess.mode).toBe("allowedRoots");
    expect(config.scraper.security.fileAccess.allowedRoots).toEqual(["$DOCUMENTS"]);
    expect(config.scraper.security.fileAccess.followSymlinks).toBe(false);
    expect(config.scraper.security.fileAccess.includeHidden).toBe(false);
  });

  it("applies nested security env overrides", () => {
    process.env.DOCS_MCP_SCRAPER_SECURITY_NETWORK_ALLOW_INVALID_TLS = "true";
    process.env.DOCS_MCP_SCRAPER_SECURITY_FILE_ACCESS_FOLLOW_SYMLINKS = "true";
    process.env.DOCS_MCP_SCRAPER_SECURITY_FILE_ACCESS_INCLUDE_HIDDEN = "true";

    const config = loadConfig({}, { configPath: path.join(tmpDir, "security-env.yaml") });

    expect(config.scraper.security.network.allowInvalidTls).toBe(true);
    expect(config.scraper.security.fileAccess.followSymlinks).toBe(true);
    expect(config.scraper.security.fileAccess.includeHidden).toBe(true);
  });

  it("parses security arrays from env", () => {
    process.env.DOCS_MCP_SCRAPER_SECURITY_NETWORK_ALLOWED_HOSTS =
      '["docs.internal.example","wiki.corp.local"]';
    process.env.DOCS_MCP_SCRAPER_SECURITY_FILE_ACCESS_ALLOWED_ROOTS =
      '["$DOCUMENTS", "/srv/docs"]';

    const config = loadConfig(
      {},
      { configPath: path.join(tmpDir, "security-arrays.yaml") },
    );

    expect(config.scraper.security.network.allowedHosts).toEqual([
      "docs.internal.example",
      "wiki.corp.local",
    ]);
    expect(config.scraper.security.fileAccess.allowedRoots).toEqual([
      "$DOCUMENTS",
      "/srv/docs",
    ]);
  });

  it("recovers in-memory from a structurally invalid explicit config without touching the file", () => {
    // Read-only mode (explicit `configPath`): we still return a valid config
    // built from defaults rather than throwing, but we must not rewrite or
    // move the user's file because they passed it deliberately.
    const configPath = path.join(tmpDir, "invalid-shape.yaml");
    const original = [
      "scraper:",
      "  security:",
      "    network:",
      "      allowedHosts: {}",
      "      allowedCidrs: {}",
      "    fileAccess:",
      '      allowedRoots: { "0": "$DOCUMENTS" }',
      "",
    ].join("\n");
    fs.writeFileSync(configPath, original);

    const config = loadConfig({}, { configPath });

    expect(Array.isArray(config.scraper.security.network.allowedHosts)).toBe(true);
    expect(Array.isArray(config.scraper.security.fileAccess.allowedRoots)).toBe(true);
    // File contents preserved exactly in read-only mode.
    expect(fs.readFileSync(configPath, "utf8")).toBe(original);
    // No quarantine file in read-only mode either.
    const quarantined = fs
      .readdirSync(tmpDir)
      .filter((name) => name.startsWith("invalid-shape.yaml.invalid-"));
    expect(quarantined.length).toBe(0);
  });

  it("preserves array-valued defaults across a saved-then-reloaded config", () => {
    // Regression: deepMerge used to recurse into arrays as if they were
    // objects, producing `{}` when an array default merged with the same
    // array shape read back from the saved YAML file.
    const configPath = path.join(tmpDir, "roundtrip.yaml");
    loadConfig({}, { configPath });
    const second = loadConfig({}, { configPath });

    expect(Array.isArray(second.scraper.security.network.allowedHosts)).toBe(true);
    expect(Array.isArray(second.scraper.security.network.allowedCidrs)).toBe(true);
    expect(Array.isArray(second.scraper.security.fileAccess.allowedRoots)).toBe(true);
    expect(second.scraper.security.fileAccess.allowedRoots).toEqual(["$DOCUMENTS"]);
  });

  it("treats unresolved $DOCUMENTS as no access", async () => {
    const homedirSpy = vi.spyOn(os, "homedir").mockReturnValue("/missing-home");

    await expect(expandConfiguredRoot("$DOCUMENTS")).resolves.toBeNull();

    homedirSpy.mockRestore();
  });
});
