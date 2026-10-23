import path from "node:path";
import { fileURLToPath } from "node:url";
import envPaths from "env-paths";
import { vol } from "memfs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetProjectRootCache, getProjectRoot, resolveStorePath } from "./paths";

// Mock fs to use memfs
vi.mock("node:fs", () => ({
  default: {
    existsSync: vi.fn((path: string) => vol.existsSync(path)),
    mkdirSync: vi.fn((path: string, options?: { recursive?: boolean }) =>
      vol.mkdirSync(path, options),
    ),
  },
}));

// Mock env-paths
vi.mock("env-paths", () => ({
  default: vi.fn(),
}));

// Get the mocked env-paths function
const mockEnvPaths = vi.mocked(envPaths);

describe("paths utilities", () => {
  // Get the actual project structure using import.meta.url
  const currentTestFile = fileURLToPath(import.meta.url);
  const currentDir = path.dirname(currentTestFile);
  const projectRoot = path.resolve(currentDir, "../..");

  beforeEach(() => {
    // Reset the virtual file system before each test
    vol.reset();

    // Reset all mocks
    vi.clearAllMocks();

    // Reset the project root cache
    _resetProjectRootCache();

    // Create a realistic project structure in memfs based on the actual project
    vol.fromJSON({
      // Create the main project structure
      [`${projectRoot}/package.json`]: JSON.stringify({
        name: "@arabold/docs-mcp-server",
        version: "1.25.2",
      }),
      [`${projectRoot}/src/utils/paths.ts`]: "// paths utility file",
      [`${projectRoot}/src/utils/paths.test.ts`]: "// this test file",
      [`${projectRoot}/src/index.ts`]: "// main file",
    });

    // Setup default env-paths mock
    mockEnvPaths.mockReturnValue({
      data: "/home/user/.local/share/docs-mcp-server",
      config: "/home/user/.config/docs-mcp-server",
      cache: "/home/user/.cache/docs-mcp-server",
      log: "/home/user/.local/share/docs-mcp-server/logs",
      temp: "/tmp/docs-mcp-server",
    });
  });

  afterEach(() => {
    vol.reset();
    _resetProjectRootCache();
  });

  describe("getProjectRoot", () => {
    it("should throw error when package.json is not found", () => {
      // Clear the mock file system so no package.json exists
      vol.reset();
      vol.fromJSON({
        "/some/file.txt": "no package.json anywhere",
      });

      expect(() => {
        getProjectRoot();
      }).toThrow("Could not find project root containing package.json.");
    });

    it("should find package.json in the project root", () => {
      const result = getProjectRoot();
      expect(result).toBe(projectRoot);
    });
  });

  describe("resolveStorePath", () => {
    /** Puts a legacy `.store/documents.db` into the project root. */
    function addLegacyStore(): string {
      const legacyStorePath = path.join(projectRoot, ".store");
      vol.mkdirSync(legacyStorePath, { recursive: true });
      vol.writeFileSync(path.join(legacyStorePath, "documents.db"), "legacy db");
      return legacyStorePath;
    }

    it("returns an explicit storePath over a legacy store and creates it", () => {
      addLegacyStore();
      const customPath = "/explicit/custom/path";
      expect(vol.existsSync(customPath)).toBe(false);

      const result = resolveStorePath(customPath);

      expect(result).toBe(customPath);
      expect(vol.existsSync(customPath)).toBe(true);
    });

    it("uses the legacy .store directory when it holds documents.db", () => {
      const legacyStorePath = addLegacyStore();
      vol.writeFileSync(path.join(legacyStorePath, "other-files.txt"), "other data");

      expect(resolveStorePath()).toBe(legacyStorePath);
    });

    it("falls back to the system data directory and creates it", () => {
      const systemPath = "/home/user/.local/share/docs-mcp-server";
      expect(vol.existsSync(systemPath)).toBe(false);

      const result = resolveStorePath();

      expect(result).toBe(systemPath);
      expect(vol.existsSync(systemPath)).toBe(true);
    });

    it("should check for documents.db file specifically, not just .store directory", () => {
      // Create .store directory but without documents.db file
      const storeDir = path.join(projectRoot, ".store");
      vol.mkdirSync(storeDir, { recursive: true });
      vol.writeFileSync(path.join(storeDir, "other-file.txt"), "not documents.db");

      const result = resolveStorePath();

      // Should not use .store directory since documents.db doesn't exist
      expect(result).toBe("/home/user/.local/share/docs-mcp-server");
    });

    it("should handle relative paths in storePath", () => {
      const relativePath = "./relative/storage/path";
      const result = resolveStorePath(relativePath);

      expect(result).toBe(`${projectRoot}/relative/storage/path`);
      expect(vol.existsSync(relativePath)).toBe(true);
    });

    it("should handle empty string storePath by falling back to normal logic", () => {
      const legacyStorePath = addLegacyStore();

      const result = resolveStorePath("");

      // Empty string should be treated as no storePath provided, so use legacy store
      expect(result).toBe(legacyStorePath);
    });
  });
});
