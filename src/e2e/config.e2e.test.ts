import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../utils/config";

describe("Configuration E2E", () => {
  let tmpDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Create temp directory for each test
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "docs-mcp-config-test-"));
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    // Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true });
    process.env = originalEnv;
  });

  it("should load defaults when no config provided", () => {
    const config = loadConfig({}, { searchDir: tmpDir });
    expect(config.server.host).toBe("127.0.0.1");
    expect(config.server.ports.default).toBe(6280);
    expect(config.scraper.maxPages).toBe(1000);
  });

  it("should load configuration from YAML file", () => {
    const configContent = `
server:
  host: "0.0.0.0"
  ports:
    mcp: 9000
    `;
    const configPath = path.join(tmpDir, "config.yaml");
    fs.writeFileSync(configPath, configContent);

    const config = loadConfig({}, { configPath });
    expect(config.server.host).toBe("0.0.0.0");
    expect(config.server.ports.mcp).toBe(9000);
    expect(config.server.ports.default).toBe(6280); // Default maintained
  });

  it("should load configuration from JSON file", () => {
    const configContent = JSON.stringify({
      server: {
        host: "10.0.0.1",
        ports: { web: 7000 },
      },
    });
    const configPath = path.join(tmpDir, "config.json");
    fs.writeFileSync(configPath, configContent);

    const config = loadConfig({}, { configPath });
    expect(config.server.host).toBe("10.0.0.1");
    expect(config.server.ports.web).toBe(7000);
  });

  it("should respect environment variables (Generic)", () => {
    process.env.DOCS_MCP_HOST = "env-host";
    process.env.DOCS_MCP_PORT = "1111"; // Should map to default, worker, mcp, web unless specific overrides

    const config = loadConfig({}, { searchDir: tmpDir });
    expect(config.server.host).toBe("env-host");
    // DOCS_MCP_PORT maps to multiple ports in mapping?
    // Let's check mapping in config.ts:
    // path: ["server", "ports", "default"], env: ["DOCS_MCP_PORT", "PORT"]
    // path: ["server", "ports", "worker"], env: ["DOCS_MCP_PORT", "PORT"]
    // path: ["server", "ports", "mcp"], env: ["DOCS_MCP_PORT", "PORT"]
    // path: ["server", "ports", "web"], env: ["DOCS_MCP_WEB_PORT", "DOCS_MCP_PORT", "PORT"]

    expect(config.server.ports.default).toBe(1111);
    expect(config.server.ports.worker).toBe(1111);
    expect(config.server.ports.mcp).toBe(1111);
    expect(config.server.ports.web).toBe(1111);
  });

  it("should respect legacy environment variables", () => {
    process.env.HOST = "legacy-host";
    process.env.PORT = "2222";

    const config = loadConfig({}, { searchDir: tmpDir });
    expect(config.server.host).toBe("legacy-host");
    expect(config.server.ports.default).toBe(2222);
  });

  it("should prioritize generic env over legacy env", () => {
    process.env.DOCS_MCP_HOST = "generic-host";
    process.env.HOST = "legacy-host";

    const config = loadConfig({}, { searchDir: tmpDir });
    expect(config.server.host).toBe("generic-host");
  });

  it("should prioritize CLI args over Env and Config File", () => {
    // File
    const configContent = `
server:
  host: "file-host"
    `;
    const configPath = path.join(tmpDir, "config.yaml");
    fs.writeFileSync(configPath, configContent);

    // Env
    process.env.DOCS_MCP_HOST = "env-host";

    // CLI
    const cliArgs = {
      host: "cli-host",
    };

    const config = loadConfig(cliArgs, { configPath });
    expect(config.server.host).toBe("cli-host");
  });

  it("should prioritize Env over Config File", () => {
    // File
    const configContent = `
server:
  host: "file-host"
     `;
    const configPath = path.join(tmpDir, "config.yaml");
    fs.writeFileSync(configPath, configContent);

    // Env
    process.env.DOCS_MCP_HOST = "env-host";

    const config = loadConfig({}, { configPath });
    expect(config.server.host).toBe("env-host");
  });

  it("should handle nested defaults correctly (Assembly)", () => {
    // Verify the fix for undefined defaults causing issues
    const config = loadConfig({}, { searchDir: tmpDir });
    expect(config.assembly).toBeDefined();
    expect(config.assembly.maxParentChainDepth).toBe(10); // The default I added
  });

  it("should handle nested defaults correctly (Splitter)", () => {
    const config = loadConfig({}, { searchDir: tmpDir });
    expect(config.splitter).toBeDefined();
    expect(config.splitter.json.maxNestingDepth).toBe(5);
  });
});
