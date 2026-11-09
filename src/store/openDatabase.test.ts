/**
 * Unit tests for opening the database when better-sqlite3's own binary does
 * not load. The module and the download are mocked: one stands in for a binary
 * that is missing or built for another Node.js version, the other for the
 * network. The cache folder is a temporary folder.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NativeModuleUnavailableError } from "./errors";
import { openDatabase } from "./openDatabase";

const cache = vi.hoisted(() => ({ dir: "" }));

vi.mock("better-sqlite3", () => ({ default: vi.fn() }));
vi.mock("node:child_process", () => ({ execFileSync: vi.fn() }));
vi.mock("env-paths", () => ({ default: () => ({ cache: cache.dir }) }));

const OPEN_DATABASE = { open: true };
const BINARY = path.join("build", "Release", "better_sqlite3.node");

// `openDatabase` calls `new Database()`, and only a function can be constructed
function throwing(error: Error) {
  return function (): never {
    throw error;
  };
}

function opening() {
  return function () {
    return OPEN_DATABASE;
  };
}

function missingBinary(): Error {
  return new Error(
    "Could not locate the bindings file. Tried:\n → /tmp/node_modules/better-sqlite3/build/better_sqlite3.node",
  );
}

function otherNodeVersion(): Error {
  return Object.assign(
    new Error(
      "The module '/tmp/node_modules/better-sqlite3/build/Release/better_sqlite3.node'\n" +
        "was compiled against a different Node.js version using\n" +
        "NODE_MODULE_VERSION 127. This version of Node.js requires\n" +
        "NODE_MODULE_VERSION 137.",
    ),
    { code: "ERR_DLOPEN_FAILED" },
  );
}

/** Writes a binary into the folder prebuild-install runs in, as a download does. */
function writeBinary(folder: string): void {
  fs.mkdirSync(path.join(folder, path.dirname(BINARY)), { recursive: true });
  fs.writeFileSync(path.join(folder, BINARY), "binary");
}

/** The download folder of an `execFileSync` call. */
function downloadFolder(args: unknown[]): string {
  return (args[2] as { cwd: string }).cwd;
}

describe("openDatabase", () => {
  const MockDatabase = vi.mocked(Database);
  const download = vi.mocked(execFileSync);

  /** The binary a `new Database()` call was told to load, if any. */
  function binaryOfCall(index: number): string | undefined {
    return MockDatabase.mock.calls[index][1]?.nativeBinding;
  }

  beforeEach(() => {
    MockDatabase.mockReset();
    download.mockReset();
    download.mockImplementation((...args: unknown[]) => {
      writeBinary(downloadFolder(args));
      return Buffer.alloc(0);
    });
    vi.stubEnv("npm_config_ignore_scripts", undefined);
    cache.dir = fs.mkdtempSync(path.join(os.tmpdir(), "docs-mcp-sqlite-cache-"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(cache.dir, { recursive: true, force: true });
  });

  it.each([
    ["is missing", missingBinary],
    ["was built for another Node.js version", otherNodeVersion],
  ])(
    "downloads a binary for this Node.js when the package's %s, and opens the database with it",
    (_, error) => {
      MockDatabase.mockImplementationOnce(throwing(error())).mockImplementationOnce(
        opening(),
      );

      expect(openDatabase(":memory:", { readonly: true })).toBe(OPEN_DATABASE);
      expect(download).toHaveBeenCalledOnce();
      const [executable, args] = download.mock.calls[0];
      expect(executable).toBe(process.execPath);
      expect(args).toEqual([expect.stringMatching(/prebuild-install[/\\]bin\.js$/)]);
      expect(MockDatabase.mock.calls[1][1]).toMatchObject({ readonly: true });
      const binary = binaryOfCall(1) ?? "";
      expect(binary).toContain(`node-v${process.versions.modules}-${process.platform}`);
      expect(fs.existsSync(binary)).toBe(true);
    },
  );

  it("opens later databases with the downloaded binary, without trying the package's again", () => {
    MockDatabase.mockImplementationOnce(throwing(otherNodeVersion())).mockImplementation(
      opening(),
    );
    openDatabase(":memory:");
    MockDatabase.mockClear();
    download.mockClear();

    expect(openDatabase(":memory:")).toBe(OPEN_DATABASE);
    expect(MockDatabase).toHaveBeenCalledOnce();
    expect(binaryOfCall(0)).toContain(cache.dir);
    expect(download).not.toHaveBeenCalled();
  });

  it("uses the binary of a server that finished the same download first", () => {
    MockDatabase.mockImplementationOnce(throwing(missingBinary())).mockImplementationOnce(
      opening(),
    );
    download.mockImplementation((...args: unknown[]) => {
      const folder = downloadFolder(args);
      writeBinary(folder);
      writeBinary(folder.replace(/\.download-[^/\\]+$/, ""));
      return Buffer.alloc(0);
    });

    expect(openDatabase(":memory:")).toBe(OPEN_DATABASE);
    expect(fs.existsSync(binaryOfCall(1) ?? "")).toBe(true);
    // Only the finished folder is left, without the second download
    expect(fs.readdirSync(path.join(cache.dir, "better-sqlite3"))).toHaveLength(1);
  });

  it("reports how to allow the install script when the download fails, and keeps nothing of it", () => {
    MockDatabase.mockImplementation(throwing(missingBinary()));
    download.mockImplementation(() => {
      throw new Error("prebuild-install warn install No prebuilt binaries found");
    });

    expect(() => openDatabase(":memory:")).toThrow(NativeModuleUnavailableError);
    expect(MockDatabase).toHaveBeenCalledOnce();
    expect(fs.readdirSync(path.join(cache.dir, "better-sqlite3"))).toEqual([]);
  });

  it("downloads nothing when npm's ignore-scripts is set, and says how to turn it off", () => {
    vi.stubEnv("npm_config_ignore_scripts", "true");
    MockDatabase.mockImplementation(throwing(otherNodeVersion()));

    expect(() => openDatabase(":memory:")).toThrow(/--ignore-scripts=false/);
    expect(download).not.toHaveBeenCalled();
  });

  it("passes other errors through without downloading", () => {
    const cantOpen = new Error("unable to open database file");
    MockDatabase.mockImplementation(throwing(cantOpen));

    expect(() => openDatabase("/missing/dir/documents.db")).toThrow(cantOpen);
    expect(download).not.toHaveBeenCalled();
  });
});
