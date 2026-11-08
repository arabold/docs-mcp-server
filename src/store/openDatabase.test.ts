/**
 * Unit tests for opening the database when better-sqlite3's binary is missing.
 * The module and the download are mocked: one stands in for a missing binary,
 * the other for the network.
 */

import { execFileSync } from "node:child_process";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NativeModuleMissingError } from "./errors";
import { openDatabase } from "./openDatabase";

vi.mock("better-sqlite3", () => ({ default: vi.fn() }));
vi.mock("node:child_process", () => ({ execFileSync: vi.fn() }));

const OPEN_DATABASE = { open: true };

// `openDatabase` calls `new Database()`, and only a function can be constructed
function throwing(error: Error) {
  return function (): never {
    throw error;
  };
}

function missingBinding(): Error {
  return new Error(
    "Could not locate the bindings file. Tried:\n → /tmp/node_modules/better-sqlite3/build/better_sqlite3.node",
  );
}

describe("openDatabase", () => {
  const MockDatabase = vi.mocked(Database);
  const download = vi.mocked(execFileSync);

  beforeEach(() => {
    MockDatabase.mockReset();
    download.mockReset();
    vi.stubEnv("npm_config_ignore_scripts", undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("downloads the missing binary with better-sqlite3's prebuild-install and opens the database", () => {
    MockDatabase.mockImplementationOnce(
      throwing(missingBinding()),
    ).mockImplementationOnce(function () {
      return OPEN_DATABASE;
    });

    expect(openDatabase(":memory:")).toBe(OPEN_DATABASE);
    expect(download).toHaveBeenCalledOnce();
    const [executable, args, options] = download.mock.calls[0];
    expect(executable).toBe(process.execPath);
    expect(args).toEqual([expect.stringMatching(/prebuild-install[/\\]bin\.js$/)]);
    expect(options).toMatchObject({ cwd: expect.stringMatching(/better-sqlite3$/) });
  });

  it("reports how to allow the install script when the download fails", () => {
    MockDatabase.mockImplementation(throwing(missingBinding()));
    download.mockImplementation(() => {
      throw new Error("prebuild-install warn install No prebuilt binaries found");
    });

    expect(() => openDatabase(":memory:")).toThrow(NativeModuleMissingError);
    expect(MockDatabase).toHaveBeenCalledOnce();
  });

  it("downloads nothing when npm's ignore-scripts is set", () => {
    vi.stubEnv("npm_config_ignore_scripts", "true");
    MockDatabase.mockImplementation(throwing(missingBinding()));

    expect(() => openDatabase(":memory:")).toThrow(NativeModuleMissingError);
    expect(download).not.toHaveBeenCalled();
  });

  it("passes other errors through without downloading", () => {
    const cantOpen = new Error("unable to open database file");
    MockDatabase.mockImplementation(throwing(cantOpen));

    expect(() => openDatabase("/missing/dir/documents.db")).toThrow(cantOpen);
    expect(download).not.toHaveBeenCalled();
  });
});
