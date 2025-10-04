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
    mkdirSync: vi.fn((path: string, options?: any) => vol.mkdirSync(path, options)),
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

    it("should cache the result on subsequent calls", () => {
      const result1 = getProjectRoot();
      const result2 = getProjectRoot();

      expect(result1).toBe(projectRoot);
      expect(result2).toBe(projectRoot);
      expect(result1).toBe(result2);
    });

    it("should work with monorepo scenario (finds closest package.json)", () => {
      // This test verifies the function finds the package.json we created in our mock
      // In a real monorepo, it would find the closest one to import.meta.url
      const result = getProjectRoot();
      expect(result).toBe(projectRoot);
    });
  });

  describe("resolveStorePath", () => {
    it("should return provided storePath when given", () => {
      const customPath = "/custom/storage/path";
      const result = resolveStorePath(customPath);

      expect(result).toBe(customPath);
      // Should attempt to create the directory
      expect(vol.existsSync(customPath)).toBe(true);
    });

    it("should use legacy .store directory when documents.db exists", () => {
      // Add legacy store to our project structure
      const legacyStorePath = path.join(projectRoot, ".store");
      vol.mkdirSync(legacyStorePath, { recursive: true });
      vol.writeFileSync(
        path.join(legacyStorePath, "documents.db"),
        "legacy database file",
      );

      const result = resolveStorePath();
      expect(result).toBe(legacyStorePath);
    });

    it("should fallback to standard system path when legacy store doesn't exist", () => {
      // Our default project structure has no .store directory
      const result = resolveStorePath();

      // Should use env-paths result
      expect(result).toBe("/home/user/.local/share/docs-mcp-server");
      expect(mockEnvPaths).toHaveBeenCalledWith("docs-mcp-server", { suffix: "" });
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

    it("should create directories that don't exist", () => {
      const newPath = "/new/storage/location";

      expect(vol.existsSync(newPath)).toBe(false);

      const result = resolveStorePath(newPath);

      expect(result).toBe(newPath);
      expect(vol.existsSync(newPath)).toBe(true);
    });

    it("should handle complex legacy store detection scenario", () => {
      // Setup a more complex project structure with legacy store
      const legacyStorePath = path.join(projectRoot, ".store");
      vol.mkdirSync(legacyStorePath, { recursive: true });
      vol.writeFileSync(path.join(legacyStorePath, "documents.db"), "legacy db");
      vol.writeFileSync(path.join(legacyStorePath, "other-files.txt"), "other data");

      const result = resolveStorePath();
      expect(result).toBe(legacyStorePath);
    });

    it("should work with different env-paths configurations", () => {
      // Test with different env-paths return value
      mockEnvPaths.mockReturnValue({
        data: "/Users/testuser/Library/Application Support/docs-mcp-server",
        config: "/Users/testuser/Library/Preferences/docs-mcp-server",
        cache: "/Users/testuser/Library/Caches/docs-mcp-server",
        log: "/Users/testuser/Library/Logs/docs-mcp-server",
        temp: "/var/folders/tmp/docs-mcp-server",
      });

      // No legacy store in default setup
      const result = resolveStorePath();
      expect(result).toBe("/Users/testuser/Library/Application Support/docs-mcp-server");
    });

    it("should prioritize storePath over legacy store", () => {
      // Setup project with both custom path and legacy store
      const legacyStorePath = path.join(projectRoot, ".store");
      vol.mkdirSync(legacyStorePath, { recursive: true });
      vol.writeFileSync(path.join(legacyStorePath, "documents.db"), "legacy db");

      const customPath = "/explicit/custom/path";
      const result = resolveStorePath(customPath);

      // Should use explicit path, not legacy
      expect(result).toBe(customPath);
    });

    it("should handle relative paths in storePath", () => {
      const relativePath = "./relative/storage/path";
      const result = resolveStorePath(relativePath);

      expect(result).toBe(`${projectRoot}/relative/storage/path`);
      expect(vol.existsSync(relativePath)).toBe(true);
    });

    it("should prioritize custom storePath even when it doesn't exist yet", () => {
      // Setup project with legacy store
      const legacyStorePath = path.join(projectRoot, ".store");
      vol.mkdirSync(legacyStorePath, { recursive: true });
      vol.writeFileSync(path.join(legacyStorePath, "documents.db"), "legacy database");

      const customPath = "/non/existing/custom/path";
      const result = resolveStorePath(customPath);

      // Should use custom path, not legacy
      expect(result).toBe(customPath);
      expect(vol.existsSync(customPath)).toBe(true); // Should be created
    });

    it("should handle empty string storePath by falling back to normal logic", () => {
      // Setup project with legacy store
      const legacyStorePath = path.join(projectRoot, ".store");
      vol.mkdirSync(legacyStorePath, { recursive: true });
      vol.writeFileSync(path.join(legacyStorePath, "documents.db"), "legacy database");

      const result = resolveStorePath("");

      // Empty string should be treated as no storePath provided, so use legacy store
      expect(result).toBe(legacyStorePath);
    });
  });

  describe("integration scenarios", () => {
    it("should work together for complete workflow with legacy store", () => {
      // Add legacy store to our project structure
      const legacyStorePath = path.join(projectRoot, ".store");
      vol.mkdirSync(legacyStorePath, { recursive: true });
      vol.writeFileSync(path.join(legacyStorePath, "documents.db"), "existing legacy db");

      // Test getProjectRoot
      const foundProjectRoot = getProjectRoot();
      expect(foundProjectRoot).toBe(projectRoot);

      // Test resolveStorePath uses legacy store
      const storePath = resolveStorePath();
      expect(storePath).toBe(legacyStorePath);
    });

    it("should work together for complete workflow without legacy store", () => {
      // Default setup has no legacy store

      // Test getProjectRoot
      const foundProjectRoot = getProjectRoot();
      expect(foundProjectRoot).toBe(projectRoot);

      // Test resolveStorePath falls back to system path
      const storePath = resolveStorePath();
      expect(storePath).toBe("/home/user/.local/share/docs-mcp-server");
    });

    it("should handle scenario where project root exists but no legacy store", () => {
      // This tests the full workflow where getProjectRoot succeeds
      // but resolveStorePath falls back to system path
      const foundProjectRoot = getProjectRoot();
      expect(foundProjectRoot).toBe(projectRoot);

      const storePath = resolveStorePath();
      expect(storePath).toBe("/home/user/.local/share/docs-mcp-server");
      expect(mockEnvPaths).toHaveBeenCalledWith("docs-mcp-server", { suffix: "" });
    });

    it("should create system storage directory when it doesn't exist", () => {
      const systemPath = "/home/user/.local/share/docs-mcp-server";

      // Ensure the system path doesn't exist initially
      expect(vol.existsSync(systemPath)).toBe(false);

      const result = resolveStorePath();

      expect(result).toBe(systemPath);
      expect(vol.existsSync(systemPath)).toBe(true);
    });
  });
});
