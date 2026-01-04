import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock env-paths before importing config
vi.mock("env-paths", () => ({
  default: () => ({
    config: "/system/config",
    data: "/system/data",
  }),
}));

// Mock fs
vi.mock("node:fs");

// Mock paths
vi.mock("./paths", () => ({
  getProjectRoot: vi.fn().mockReturnValue("/project/root"),
}));

// Import code under test
import { DEFAULT_CONFIG, loadConfig } from "./config";

describe("Configuration Loading", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetAllMocks();
    process.env = { ...originalEnv };
    delete process.env.DOCS_MCP_CONFIG;
    delete process.env.DOCS_MCP_TELEMETRY;
    delete process.env.DOCS_MCP_READ_ONLY;
    delete process.env.DOCS_MCP_STORE_PATH;
    delete process.env.DOCS_MCP_AUTH_ENABLED;

    // Default fs behavior: nothing exists
    vi.mocked(fs.existsSync).mockReturnValue(false);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should load default configuration and create config file in system path if none exists", () => {
    const expectedPath = path.join("/system/config", "config.yaml");

    // Setup: Directory does not exist, so mkdirSync should be called
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const config = loadConfig();

    // Verify validation
    expect(config.app.telemetryEnabled).toBe(true);
    expect(config).toEqual(DEFAULT_CONFIG);

    // Verify auto-save
    expect(fs.mkdirSync).toHaveBeenCalledWith("/system/config", { recursive: true });
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expectedPath,
      expect.stringContaining("telemetryEnabled: true"), // Simple check for YAML content
      "utf8",
    );
  });

  it("should load configuration from --config flag and update it", () => {
    const configPath = "/custom/config.yaml";
    const fileContent = "app:\n  telemetryEnabled: false\n";

    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(fileContent);

    const config = loadConfig({ config: configPath });

    expect(fs.existsSync).toHaveBeenCalledWith(configPath);
    expect(config.app.telemetryEnabled).toBe(false);

    // Verify update (it should write back the merged config)
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      configPath,
      expect.stringContaining("telemetryEnabled: false"),
      "utf8",
    );
    // Should also contain default values that were missing
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      configPath,
      expect.stringContaining("heartbeatMs: 30000"),
      "utf8",
    );
  });

  it("should prioritize generic System Config if no specific file found", () => {
    // Neither custom nor CWD nor Project root has config
    vi.mocked(fs.existsSync).mockReturnValue(false);

    loadConfig();

    // specific system path
    const systemConfigPath = path.join("/system/config", "config.yaml");
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      systemConfigPath,
      expect.any(String),
      "utf8",
    );
  });

  it("should prioritize CWD config if it exists", () => {
    const cwdConfigPath = path.join(process.cwd(), "config.yaml");

    // Mock CWD config exists
    vi.mocked(fs.existsSync).mockImplementation((p) => p === cwdConfigPath);
    vi.mocked(fs.readFileSync).mockReturnValue("app:\n  readOnly: true\n");

    const config = loadConfig();

    expect(config.app.readOnly).toBe(true);
    // Should update the CWD config
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      cwdConfigPath,
      expect.stringContaining("readOnly: true"),
      "utf8",
    );
  });

  describe("Precedence Rules", () => {
    it("should prioritize --config flag over DOCS_MCP_CONFIG env var", () => {
      const flagPath = "/flag/config.yaml";
      const envPath = "/env/config.yaml";
      process.env.DOCS_MCP_CONFIG = envPath;

      // Mock both files existing
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockImplementation((p) => {
        if (p === flagPath) return "app:\n  telemetryEnabled: false\n";
        if (p === envPath) return "app:\n  telemetryEnabled: true\n";
        return "";
      });

      const config = loadConfig({ config: flagPath });

      expect(config.app.telemetryEnabled).toBe(false);
      // Should save to flagPath
      expect(fs.writeFileSync).toHaveBeenCalledWith(flagPath, expect.any(String), "utf8");
    });

    it("should prioritize environment variables over config file (but save file based on file content only)", () => {
      // This is slightly tricky: The plan says "Write the *clean, merged* configuration back to the file... Apply Environment ... overrides ... (these are NOT written to disk)."
      // So we must verify fs.writeFileSync writes 'false' (from file), but returned config has 'true' (from env)

      const configPath = "/config.yaml";
      process.env.DOCS_MCP_CONFIG = configPath;
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue("app:\n  telemetryEnabled: false\n");

      // Env var override
      process.env.DOCS_MCP_TELEMETRY = "true";

      const config = loadConfig();

      // Memory config has Env override
      expect(config.app.telemetryEnabled).toBe(true);

      // Disk config should NOT have Env override (should stay false as per file)
      // But it Will have defaults.
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        configPath,
        expect.stringContaining("telemetryEnabled: false"),
        "utf8",
      );
    });

    it("should prioritize CLI flags over everything (runtime)", () => {
      const configPath = "/config.yaml";
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue("app:\n  readOnly: false\n");

      const config = loadConfig({ readOnly: true }, { configPath });

      expect(config.app.readOnly).toBe(true);

      // Verification that file on disk is NOT updated with CLI flag
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        configPath,
        expect.stringContaining("readOnly: false"),
        "utf8",
      );
    });
  });

  describe("Error Handling", () => {
    // If config file is malformed, we return default logic (empty obj -> defaults)
    // because loadConfigFile returns null on error in new impl?
    // No, returns null. loadConfig uses "|| {}".
    // So it silently recovers.
    it("should recover from malformed config file by using defaults", () => {
      const configPath = "/malformed.yaml";
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue("invalid: yaml: content");
      // yaml.parse might throw. mocked? No, we are using real yaml parser, but mocked fs.
      // "invalid: yaml: content" is actually valid YAML string?
      // "invalid: [tab] content" would throw.
      // Let's use something that throws in yaml.parse
      vi.mocked(fs.readFileSync).mockReturnValue(":");

      const config = loadConfig({ config: configPath });

      expect(config).toEqual(DEFAULT_CONFIG);
      // And it should overwrite the malformed file with fresh defaults!
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        configPath,
        expect.stringContaining("telemetryEnabled: true"),
        "utf8",
      );
    });
  });
});
