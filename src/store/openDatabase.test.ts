/**
 * Unit tests for opening the database. better-sqlite3 is mocked so a test can
 * stand in for a platform without a prebuilt binary; real databases are opened
 * by the DocumentStore tests.
 */

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NativeModuleUnavailableError, NodeApiUnsupportedError } from "./errors";
import { openDatabase } from "./openDatabase";

vi.mock("better-sqlite3", () => ({ default: vi.fn() }));

const OPEN_DATABASE = { open: true };

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

/** The error Node.js and Bun throw when no binary exists for the platform. */
function missingBinary(): Error {
  return Object.assign(
    new Error(
      "Cannot find module '/tmp/node_modules/better-sqlite3/build/Release/better_sqlite3.node'",
    ),
    { code: "MODULE_NOT_FOUND" },
  );
}

const MockDatabase = vi.mocked(Database);
const NODE_API = Object.getOwnPropertyDescriptor(process.versions, "napi");

/** Stands in for a runtime that provides the given Node-API version. */
function provideNodeApi(version: string | undefined): void {
  Object.defineProperty(process.versions, "napi", {
    value: version,
    configurable: true,
    enumerable: true,
  });
}

describe("openDatabase", () => {
  beforeEach(() => {
    MockDatabase.mockReset();
  });

  afterEach(() => {
    if (NODE_API) {
      Object.defineProperty(process.versions, "napi", NODE_API);
    }
  });

  it("refuses a runtime with an older Node-API version before loading the binary", () => {
    provideNodeApi("9");

    expect(() => openDatabase(":memory:")).toThrow(NodeApiUnsupportedError);
    expect(() => openDatabase(":memory:")).toThrow("Node.js to 22.14 or later");
    expect(MockDatabase).not.toHaveBeenCalled();
  });

  it("lets a runtime that reports no Node-API version try to load the binary", () => {
    provideNodeApi(undefined);
    MockDatabase.mockImplementation(opening());

    expect(openDatabase(":memory:")).toBe(OPEN_DATABASE);
  });

  it("opens the database with the given path and options", () => {
    MockDatabase.mockImplementation(opening());

    expect(openDatabase(":memory:", { readonly: true })).toBe(OPEN_DATABASE);
    expect(MockDatabase).toHaveBeenCalledWith(":memory:", { readonly: true });
  });

  it("reports a platform without a better-sqlite3 binary as unavailable", () => {
    MockDatabase.mockImplementation(throwing(missingBinary()));

    expect(() => openDatabase(":memory:")).toThrow(NativeModuleUnavailableError);
  });

  it("passes errors that are not about the binary through unchanged", () => {
    const cantOpen = new Error("SQLITE_CANTOPEN: unable to open database file");
    MockDatabase.mockImplementation(throwing(cantOpen));

    expect(() => openDatabase("/missing/documents.db")).toThrow(cantOpen);
  });
});
