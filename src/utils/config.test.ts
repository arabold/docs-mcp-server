import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import yaml from "yaml";
import {
  type AppConfig,
  defaults,
  getConfigMappedCliKeys,
  getConfigValue,
  isValidConfigPath,
  isVectorDimensionExplicit,
  loadConfig,
  parseConfigValue,
} from "./config";

// env-paths names the directory of the managed default config. Each test points
// it at a throwaway directory of its own, so no test reads or writes the
// developer's config. loadConfig() reads `config` on every call, so the getter
// sees the current test's directory.
const managed = vi.hoisted(() => ({ dir: "" }));
vi.mock("env-paths", () => ({
  default: () => ({
    get config() {
      return managed.dir;
    },
  }),
}));

/** Environment variables without the DOCS_MCP_ prefix that loadConfig() reads. */
const UNPREFIXED_ENV = ["PORT", "HOST", "DOCS_MCP_CONFIG", "OPENAI_API_KEY"];

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "docs-mcp-config-test-"));
  managed.dir = path.join(tmpDir, "managed");
  // Start every test from the built-in defaults. This also drops the
  // DOCS_MCP_CONFIG that vite.config.ts sets, so the managed default path is
  // reachable.
  for (const name of Object.keys(process.env)) {
    if (name.startsWith("DOCS_MCP_") || UNPREFIXED_ENV.includes(name)) {
      vi.stubEnv(name, undefined);
    }
  }
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** The managed default config file, which loadConfig() writes back. */
const managedConfigPath = () => path.join(managed.dir, "config.yaml");

/** Writes a config file into the test's directory and returns its path. */
function writeConfigFile(name: string, content: string): string {
  const filePath = path.join(tmpDir, name);
  fs.writeFileSync(filePath, content);
  return filePath;
}

/** Loads with an explicit config path that does not exist, so no file applies. */
const loadWithoutFile = (cliArgs: Record<string, unknown> = {}) =>
  loadConfig(cliArgs, { configPath: path.join(tmpDir, "absent.yaml") });

/** Returns a deep copy of `config` with one dot-separated setting replaced. */
function withSetting(config: AppConfig, setting: string, value: unknown): AppConfig {
  const copy = structuredClone(config);
  const keys = setting.split(".");
  let node = copy as unknown as Record<string, unknown>;
  for (const key of keys.slice(0, -1)) {
    node = node[key] as Record<string, unknown>;
  }
  node[keys[keys.length - 1]] = value;
  return copy;
}

/** The YAML of a config file that sets only `setting`. */
function yamlWithSetting(setting: string, value: unknown): string {
  const root: Record<string, unknown> = {};
  const keys = setting.split(".");
  let node = root;
  for (const key of keys.slice(0, -1)) {
    const child: Record<string, unknown> = {};
    node[key] = child;
    node = child;
  }
  node[keys[keys.length - 1]] = value;
  return yaml.stringify(root);
}

describe("loadConfig", () => {
  it("writes the managed default config on first load, without instructions", () => {
    const config = loadConfig({}, {});

    expect(config.server.host).toBe("127.0.0.1");
    expect(config.server.publicOrigin).toBeUndefined();
    const saved = fs.readFileSync(managedConfigPath(), "utf8");
    expect(yaml.parse(saved).server.host).toBe("127.0.0.1");
    expect(saved).not.toMatch(/^\s*instructions:/m);
  });

  it("reads an explicit config file without writing to it", () => {
    const content = "app:\n  telemetryEnabled: false\n";
    const ways: Array<[label: string, load: (configPath: string) => AppConfig]> = [
      ["--config", (configPath) => loadConfig({ config: configPath })],
      ["configPath option", (configPath) => loadConfig({}, { configPath })],
      [
        "DOCS_MCP_CONFIG",
        (configPath) => {
          vi.stubEnv("DOCS_MCP_CONFIG", configPath);
          return loadConfig({});
        },
      ],
    ];

    for (const [index, [label, load]] of ways.entries()) {
      const configPath = writeConfigFile(`explicit-${index}.yaml`, content);
      expect.soft(load(configPath).app.telemetryEnabled, label).toBe(false);
      expect.soft(fs.readFileSync(configPath, "utf8"), label).toBe(content);
    }
    // Nor does it write the managed default config.
    expect(fs.existsSync(managed.dir)).toBe(false);
  });

  it("takes a setting from the CLI over the environment over the config file over the defaults", () => {
    const cases: Array<{
      setting: string;
      file: unknown;
      env: [name: string, value: string, parsed?: unknown];
      cli?: [key: string, value: unknown];
    }> = [
      {
        setting: "server.host",
        file: "file-host",
        env: ["DOCS_MCP_HOST", "env-host"],
        cli: ["host", "cli-host"],
      },
      {
        setting: "server.publicOrigin",
        file: "https://file.example.com",
        env: ["DOCS_MCP_SERVER_PUBLIC_ORIGIN", "https://env.example.com"],
        cli: ["publicOrigin", "https://cli.example.com"],
      },
      {
        setting: "server.publicUrl",
        file: "https://file.example.com/docs",
        env: ["DOCS_MCP_SERVER_PUBLIC_URL", "https://env.example.com/docs"],
        cli: ["publicUrl", "https://cli.example.com/tools"],
      },
      {
        setting: "server.name",
        file: "file-name",
        env: ["DOCS_MCP_SERVER_NAME", "env-name"],
        cli: ["serverName", "cli-name"],
      },
      {
        setting: "server.title",
        file: "File Title",
        env: ["DOCS_MCP_SERVER_TITLE", "Env Title"],
        cli: ["serverTitle", "CLI Title"],
      },
      {
        setting: "server.instructions",
        file: "from file",
        env: ["DOCS_MCP_SERVER_INSTRUCTIONS", "from env"],
        cli: ["serverInstructions", "from cli"],
      },
      {
        setting: "server.instructionsFile",
        file: "/from/file.md",
        env: ["DOCS_MCP_SERVER_INSTRUCTIONS_FILE", "/from/env.md"],
        cli: ["serverInstructionsFile", "/from/cli.md"],
      },
      {
        setting: "server.heartbeatMs",
        file: 15000,
        env: ["DOCS_MCP_SERVER_HEARTBEAT_MS", "20000", 20000],
      },
      {
        setting: "scraper.skipKnownTrackers",
        file: false,
        env: ["DOCS_MCP_SCRAPER_SKIP_KNOWN_TRACKERS", "true", true],
      },
      // A file written by an older release lacks newer keys; they keep their
      // defaults while the file's own values apply.
      {
        setting: "scraper.maxPages",
        file: 42,
        env: ["DOCS_MCP_SCRAPER_MAX_PAGES", "500", 500],
      },
    ];

    for (const [index, { setting, file, env, cli }] of cases.entries()) {
      const configPath = writeConfigFile(
        `precedence-${index}.yaml`,
        yamlWithSetting(setting, file),
      );
      // The file's value merges over the defaults, which fill in everything else.
      expect
        .soft(loadConfig({}, { configPath }), `${setting}: file over defaults`)
        .toEqual(withSetting(defaults, setting, file));

      const [envName, envValue, envParsed = envValue] = env;
      vi.stubEnv(envName, envValue);
      expect
        .soft(
          getConfigValue(loadConfig({}, { configPath }), setting),
          `${setting}: env over file`,
        )
        .toEqual(envParsed);

      if (cli) {
        const [cliKey, cliValue] = cli;
        expect
          .soft(
            getConfigValue(loadConfig({ [cliKey]: cliValue }, { configPath }), setting),
            `${setting}: CLI over env`,
          )
          .toEqual(cliValue);
      }
      vi.stubEnv(envName, undefined);
    }
  });

  it("treats a blank environment variable as unset", () => {
    const cases: Array<[name: string, setting: string, expected: unknown]> = [
      ["DOCS_MCP_SERVER_PUBLIC_ORIGIN", "server.publicOrigin", undefined],
      ["DOCS_MCP_SERVER_NAME", "server.name", "docs-mcp-server"],
      ["DOCS_MCP_SERVER_TITLE", "server.title", undefined],
      ["DOCS_MCP_SERVER_INSTRUCTIONS", "server.instructions", undefined],
      ["DOCS_MCP_SERVER_INSTRUCTIONS_FILE", "server.instructionsFile", undefined],
    ];

    for (const [name, setting, expected] of cases) {
      for (const blank of ["", "  "]) {
        vi.stubEnv(name, blank);
        expect
          .soft(getConfigValue(loadWithoutFile(), setting), `${name}="${blank}"`)
          .toEqual(expected);
      }
      vi.stubEnv(name, undefined);
    }
  });

  it("applies the built-in defaults", () => {
    // An empty file holds no settings at all.
    const config = loadConfig({}, { configPath: writeConfigFile("empty.yaml", "") });
    const cases: Array<[setting: string, expected: unknown]> = [
      ["server.host", "127.0.0.1"],
      ["server.name", "docs-mcp-server"],
      ["server.title", undefined],
      ["server.instructions", undefined],
      ["server.instructionsFile", undefined],
      ["server.publicOrigin", undefined],
      ["server.allowedOrigins", []],
      ["assembly.maxParentChainDepth", 10],
      ["scraper.fetcher.maxRetries", 3],
      ["scraper.abortOnFailureRate", 0.5],
      ["scraper.skipKnownTrackers", true],
      // The scraper's security settings start closed.
      ["scraper.security.network.allowPrivateNetworks", false],
      ["scraper.security.network.allowedHosts", []],
      ["scraper.security.network.allowedCidrs", []],
      ["scraper.security.network.allowInvalidTls", false],
      ["scraper.security.fileAccess.mode", "allowedRoots"],
      ["scraper.security.fileAccess.allowedRoots", ["$DOCUMENTS"]],
      ["scraper.security.fileAccess.followSymlinks", false],
      ["scraper.security.fileAccess.includeHidden", false],
    ];

    for (const [setting, expected] of cases) {
      expect.soft(getConfigValue(config, setting), setting).toEqual(expected);
    }
  });

  it("normalizes server.publicOrigin and server.publicUrl from the config file", () => {
    const configPath = writeConfigFile(
      "public.yaml",
      "server:\n  publicOrigin: https://docs.example.com/\n  publicUrl: https://example.com/docs/\n",
    );

    const config = loadConfig({}, { configPath });

    expect(config.server.publicOrigin).toBe("https://docs.example.com");
    expect(config.server.publicUrl).toBe("https://example.com/docs");
  });

  it("rejects an invalid public location setting instead of resetting to defaults", () => {
    // serverOrigin.test.ts covers the URL rules; these rows show that a broken
    // value stops loading wherever it comes from.
    const cases: Array<[source: "cli" | "file", setting: string, value: unknown]> = [
      ["cli", "publicOrigin", "ftp://docs.example.com"],
      ["cli", "publicOrigin", "https://docs.example.com/path"],
      ["cli", "publicOrigin", "https://docs.example.com?x=1"],
      ["cli", "publicOrigin", "https://docs.example.com#fragment"],
      ["cli", "publicUrl", "https://example.com/docs?x=1"],
      ["cli", "publicUrl", "ftp://example.com/docs"],
      ["cli", "publicUrl", "https://example.com/mcp"],
      ["file", "allowedOrigins", ["https://inspector.example.com/app"]],
    ];

    for (const [index, [source, setting, value]] of cases.entries()) {
      const load =
        source === "cli"
          ? () => loadWithoutFile({ [setting]: value })
          : () =>
              loadConfig(
                {},
                {
                  configPath: writeConfigFile(
                    `invalid-location-${index}.yaml`,
                    yamlWithSetting(`server.${setting}`, value),
                  ),
                },
              );
      expect.soft(load, `${source} ${setting} ${value}`).toThrow(`server.${setting}`);
    }
  });

  it("keeps both publicUrl and publicOrigin when both are set", () => {
    const configPath = writeConfigFile(
      "both.yaml",
      "server:\n  publicOrigin: https://old.example.com\n",
    );

    const config = loadConfig({ publicUrl: "https://example.com/docs" }, { configPath });

    expect(config.server.publicUrl).toBe("https://example.com/docs");
    expect(config.server.publicOrigin).toBe("https://old.example.com");
  });

  it("parses list settings from JSON array environment variables", () => {
    vi.stubEnv(
      "DOCS_MCP_SERVER_ALLOWED_ORIGINS",
      '["https://inspector.example.com/", "http://localhost:3000"]',
    );
    vi.stubEnv(
      "DOCS_MCP_SCRAPER_SECURITY_NETWORK_ALLOWED_HOSTS",
      '["docs.internal.example","wiki.corp.local"]',
    );
    vi.stubEnv(
      "DOCS_MCP_SCRAPER_SECURITY_FILE_ACCESS_ALLOWED_ROOTS",
      '["$DOCUMENTS", "/srv/docs"]',
    );

    const config = loadWithoutFile();

    // Allowed origins are normalized as origins.
    expect(config.server.allowedOrigins).toEqual([
      "https://inspector.example.com",
      "http://localhost:3000",
    ]);
    expect(config.scraper.security.network.allowedHosts).toEqual([
      "docs.internal.example",
      "wiki.corp.local",
    ]);
    expect(config.scraper.security.fileAccess.allowedRoots).toEqual([
      "$DOCUMENTS",
      "/srv/docs",
    ]);
  });

  it("reads every setting from a DOCS_MCP_ environment variable named after its path", () => {
    const cases: Array<
      [name: string, value: string, setting: string, expected: unknown]
    > = [
      ["DOCS_MCP_SCRAPER_MAX_PAGES", "500", "scraper.maxPages", 500],
      ["DOCS_MCP_SCRAPER_JOB_HEARTBEAT_MS", "250", "scraper.jobHeartbeatMs", 250],
      [
        "DOCS_MCP_SCRAPER_DOCUMENT_MAX_SIZE",
        "52428800",
        "scraper.document.maxSize",
        52428800,
      ],
      [
        "DOCS_MCP_SPLITTER_JSON_MAX_NESTING_DEPTH",
        "7",
        "splitter.json.maxNestingDepth",
        7,
      ],
      // A float
      [
        "DOCS_MCP_SCRAPER_ABORT_ON_FAILURE_RATE",
        "0.25",
        "scraper.abortOnFailureRate",
        0.25,
      ],
      // An enum, with each supported value
      [
        "DOCS_MCP_SCRAPER_HTML_EXTRACTOR",
        "defuddle",
        "scraper.htmlExtractor",
        "defuddle",
      ],
      ["DOCS_MCP_SCRAPER_HTML_EXTRACTOR", "cheerio", "scraper.htmlExtractor", "cheerio"],
      // A boolean turned off
      [
        "DOCS_MCP_SCRAPER_SKIP_KNOWN_TRACKERS",
        "false",
        "scraper.skipKnownTrackers",
        false,
      ],
      // Four levels deep, with camelCase segments
      [
        "DOCS_MCP_SCRAPER_SECURITY_NETWORK_ALLOW_INVALID_TLS",
        "true",
        "scraper.security.network.allowInvalidTls",
        true,
      ],
      [
        "DOCS_MCP_SCRAPER_SECURITY_FILE_ACCESS_FOLLOW_SYMLINKS",
        "true",
        "scraper.security.fileAccess.followSymlinks",
        true,
      ],
      [
        "DOCS_MCP_SCRAPER_SECURITY_FILE_ACCESS_INCLUDE_HIDDEN",
        "true",
        "scraper.security.fileAccess.includeHidden",
        true,
      ],
    ];

    for (const [name, value, setting, expected] of cases) {
      vi.stubEnv(name, value);
      expect
        .soft(getConfigValue(loadWithoutFile(), setting), `${name}=${value}`)
        .toEqual(expected);
      vi.stubEnv(name, undefined);
    }
  });

  it("prefers the generated variable over an alias for the same setting", () => {
    vi.stubEnv("PORT", "3000");
    vi.stubEnv("DOCS_MCP_SERVER_PORTS_DEFAULT", "4000");

    const config = loadWithoutFile();

    expect(config.server.ports.default).toBe(4000);
    expect(config.server.ports.worker).toBe(3000);
  });

  it("strips the quotes around environment variable values (GH-353)", () => {
    const cases: Array<
      [name: string, value: string, setting: string, expected: unknown]
    > = [
      [
        "DOCS_MCP_EMBEDDING_MODEL",
        '"openai:nomic-embed-text"',
        "app.embeddingModel",
        "openai:nomic-embed-text",
      ],
      [
        "DOCS_MCP_EMBEDDING_MODEL",
        "'openai:nomic-embed-text'",
        "app.embeddingModel",
        "openai:nomic-embed-text",
      ],
      // A generated variable
      ["DOCS_MCP_SCRAPER_MAX_PAGES", '"500"', "scraper.maxPages", 500],
    ];

    for (const [name, value, setting, expected] of cases) {
      vi.stubEnv(name, value);
      expect
        .soft(getConfigValue(loadWithoutFile(), setting), `${name}=${value}`)
        .toEqual(expected);
      vi.stubEnv(name, undefined);
    }
  });

  it("fails loading on an invalid environment value", () => {
    // Environment overrides are reapplied when the loader falls back, so an
    // invalid one fails loading outright rather than resetting to the default.
    const cases: Array<[name: string, value: string]> = [
      ["DOCS_MCP_SCRAPER_HTML_EXTRACTOR", "nonsense"],
      // The embedding dimension must be at least 1.
      ["DOCS_MCP_EMBEDDINGS_VECTOR_DIMENSION", "0"],
      ["DOCS_MCP_EMBEDDINGS_VECTOR_DIMENSION", "-1"],
    ];

    for (const [name, value] of cases) {
      vi.stubEnv(name, value);
      expect.soft(() => loadWithoutFile(), `${name}=${value}`).toThrow();
      vi.stubEnv(name, undefined);
    }
  });

  it("falls back to the defaults for an invalid explicit config file and leaves the file alone", () => {
    // A file-borne value that fails validation is not fatal: the loader warns
    // and rebuilds from the defaults, so a typo cannot select an unrecognised
    // extractor. A file passed explicitly is read-only, so the loader neither
    // rewrites nor moves it.
    const cases: Array<{ label: string; content: string; setting: string }> = [
      {
        label: "jobHeartbeatMs that is not positive",
        content: "scraper:\n  jobHeartbeatMs: 0\n",
        setting: "scraper.jobHeartbeatMs",
      },
      { label: "malformed YAML", content: ":", setting: "server.host" },
      {
        label: "unrecognised htmlExtractor",
        content: "scraper:\n  htmlExtractor: nonsense\n",
        setting: "scraper.htmlExtractor",
      },
      {
        label: "lists saved as objects",
        content: [
          "scraper:",
          "  security:",
          "    network:",
          "      allowedHosts: {}",
          "      allowedCidrs: {}",
          "    fileAccess:",
          '      allowedRoots: { "0": "$DOCUMENTS" }',
          "",
        ].join("\n"),
        setting: "scraper.security",
      },
    ];

    for (const [index, { label, content, setting }] of cases.entries()) {
      const configPath = writeConfigFile(`invalid-${index}.yaml`, content);
      const config = loadConfig({}, { configPath });

      expect
        .soft(getConfigValue(config, setting), label)
        .toEqual(getConfigValue(defaults, setting));
      expect.soft(fs.readFileSync(configPath, "utf8"), `${label}: file`).toBe(content);
    }
    expect(fs.readdirSync(tmpDir).filter((name) => name.includes(".invalid-"))).toEqual(
      [],
    );
  });

  it("moves an invalid managed config aside and starts a fresh one from the defaults", () => {
    // Array settings saved as objects by an older release would otherwise stop
    // every start. The loader keeps the settings in `config.yaml.invalid-<ts>`
    // so hand-edits are not lost.
    fs.mkdirSync(managed.dir, { recursive: true });
    fs.writeFileSync(
      managedConfigPath(),
      "scraper:\n  maxPages: 42\n  security:\n    network:\n      allowedHosts: {}\n",
    );

    const config = loadConfig({}, {});

    expect(config.scraper.maxPages).toBe(defaults.scraper.maxPages);
    expect(config.scraper.security.network.allowedHosts).toEqual([]);
    const quarantined = fs
      .readdirSync(managed.dir)
      .filter((name) => /^config\.yaml\.invalid-\d+$/.test(name));
    expect(quarantined).toHaveLength(1);
    const kept = yaml.parse(
      fs.readFileSync(path.join(managed.dir, quarantined[0]), "utf8"),
    );
    expect(kept.scraper.maxPages).toBe(42);
    expect(kept.scraper.security.network.allowedHosts).toEqual({});
    const fresh = yaml.parse(fs.readFileSync(managedConfigPath(), "utf8"));
    expect(fresh.scraper.maxPages).toBe(defaults.scraper.maxPages);
    expect(fresh.scraper.security.network.allowedHosts).toEqual([]);
  });

  it("reads back the list defaults it saved to the managed config", () => {
    // Regression: deepMerge used to recurse into arrays as if they were
    // objects, producing `{}` when an array default merged with the same
    // array read back from the saved YAML file. The loader then rejected and
    // quarantined the file it had written itself.
    loadConfig({}, {});
    const second = loadConfig({}, {});

    expect(fs.readdirSync(managed.dir)).toEqual(["config.yaml"]);
    expect(second.server.allowedOrigins).toEqual([]);
    expect(second.scraper.security.network.allowedHosts).toEqual([]);
    expect(second.scraper.security.network.allowedCidrs).toEqual([]);
    expect(second.scraper.security.fileAccess.allowedRoots).toEqual(["$DOCUMENTS"]);
  });

  describe("embeddings.vectorDimension explicitness", () => {
    it("omits generated default vectorDimension from the managed default config", () => {
      const config = loadConfig({}, {});
      const content = fs.readFileSync(managedConfigPath(), "utf8");
      const parsed = yaml.parse(content) as {
        embeddings?: { vectorDimension?: unknown };
      };

      expect(isVectorDimensionExplicit(config)).toBe(false);
      expect(parsed.embeddings?.vectorDimension).toBeUndefined();
      expect(content).toContain("docs-mcp-server-managed-vector-dimension-omitted");
    });

    it("treats a default vectorDimension in a managed config as explicit", () => {
      loadConfig({}, {});
      const generated = fs.readFileSync(managedConfigPath(), "utf8");
      const marker = generated
        .split("\n")
        .filter((line) => line.startsWith("#"))
        .join("\n");
      fs.writeFileSync(
        managedConfigPath(),
        `${marker}\nembeddings:\n  vectorDimension: ${defaults.embeddings.vectorDimension}\n`,
      );

      const config = loadConfig({}, {});

      expect(config.embeddings.vectorDimension).toBe(defaults.embeddings.vectorDimension);
      expect(isVectorDimensionExplicit(config)).toBe(true);
      expect(fs.readFileSync(managedConfigPath(), "utf8")).toContain("vectorDimension");
    });

    it("migrates legacy generated default vectorDimension to implicit omission", () => {
      fs.mkdirSync(managed.dir, { recursive: true });
      fs.writeFileSync(managedConfigPath(), yaml.stringify(defaults));

      const config = loadConfig({}, {});
      const content = fs.readFileSync(managedConfigPath(), "utf8");
      const parsed = yaml.parse(content) as {
        embeddings?: { vectorDimension?: unknown };
      };

      expect(isVectorDimensionExplicit(config)).toBe(false);
      expect(parsed.embeddings?.vectorDimension).toBeUndefined();
      expect(content).toContain("docs-mcp-server-managed-vector-dimension-omitted");
    });

    it("treats a user-authored default vectorDimension as explicit", () => {
      fs.mkdirSync(managed.dir, { recursive: true });
      fs.writeFileSync(
        managedConfigPath(),
        `embeddings:\n  vectorDimension: ${defaults.embeddings.vectorDimension}\n`,
      );

      const config = loadConfig({}, {});

      expect(config.embeddings.vectorDimension).toBe(defaults.embeddings.vectorDimension);
      expect(isVectorDimensionExplicit(config)).toBe(true);
    });
  });
});

describe("config CLI helpers", () => {
  it("lists the CLI options that map onto settings", () => {
    const keys = getConfigMappedCliKeys();

    expect(keys).toContain("authEnabled");
    expect(keys).toContain("readOnly");
    expect(keys).toContain("protocol");
  });

  it("accepts only paths of existing settings", () => {
    const cases: Array<[path: string, expected: boolean]> = [
      ["scraper.maxPages", true],
      ["scraper.document.maxSize", true],
      ["app.telemetryEnabled", true],
      ["server.publicOrigin", true],
      ["invalid.path", false],
      ["scraper.nonexistent", false],
      // Inherited object properties are not settings.
      ["toString", false],
      ["server.toString", false],
    ];

    for (const [settingPath, expected] of cases) {
      expect.soft(isValidConfigPath(settingPath), settingPath).toBe(expected);
    }
  });

  it("reads a setting or a group of settings by its dot path", () => {
    const cases: Array<[path: string, expected: unknown]> = [
      ["scraper.maxPages", 1000],
      ["scraper.document", { maxSize: 10485760 }],
      ["invalid.path", undefined],
    ];

    for (const [settingPath, expected] of cases) {
      expect.soft(getConfigValue(defaults, settingPath), settingPath).toEqual(expected);
    }
  });

  it("parses a value as a number, then a boolean, then a string", () => {
    const cases: Array<[value: string, expected: unknown]> = [
      ["1000", 1000],
      ["0", 0],
      ["3.14", 3.14],
      ["true", true],
      ["false", false],
      ["TRUE", true],
      ["FALSE", false],
      ["hello", "hello"],
      ["text-embedding-3-small", "text-embedding-3-small"],
      ["", ""],
    ];

    for (const [value, expected] of cases) {
      expect.soft(parseConfigValue(value), `"${value}"`).toEqual(expected);
    }
  });
});
