/**
 * Unit tests for the library conflict, naming and native module errors.
 */

import { describe, expect, it } from "vitest";
import {
  AmbiguousPageInStoreError,
  formatVersionLabel,
  InvalidLibraryNameError,
  isNativeModuleError,
  LibraryAlreadyExistsError,
  LibraryNotFoundInStoreError,
  NativeModuleUnavailableError,
  PageNotFoundInStoreError,
  VersionAlreadyExistsError,
  VersionNotFoundInStoreError,
} from "./errors";

describe("library identity errors", () => {
  it("names the version and the replace remedy when a version already exists", () => {
    const error = new VersionAlreadyExistsError("React", "19.0.0");
    expect(error.message).toBe(
      'Version "19.0.0" of library "React" already exists. To rebuild it, scrape again with --replace (CLI) or replace: true (MCP), or refresh it to update in place.',
    );
  });

  it("uses an unversioned wording when the version is empty", () => {
    const error = new VersionAlreadyExistsError("React", "");
    expect(error.message).toMatch(
      /^Unversioned documentation for library "React" already exists\. To rebuild it/,
    );
  });

  it("points an existing library at adding a version, without a replace remedy", () => {
    const error = new LibraryAlreadyExistsError("React");
    expect(error.message).toBe(
      'Library "React" already exists. Open it to add a version.',
    );
    expect(error.message).not.toContain("--replace");
  });

  it("states the broken rule for an invalid name", () => {
    const error = new InvalidLibraryNameError("", "is empty");
    expect(error.message).toBe('Invalid library name "": is empty.');
  });

  // C0 controls, DEL and C1 controls (Unicode Cc); JSON.stringify alone leaves the last two raw
  const NAME = "a\nb\t\u001bc\u007fd\u0085e";
  const ESCAPED = String.raw`a\nb\t\u001bc\u007fd\u0085e`;

  it("escapes every control character in names in every error", () => {
    const cases: [label: string, error: Error][] = [
      ["LibraryAlreadyExistsError", new LibraryAlreadyExistsError(NAME)],
      ["VersionAlreadyExistsError", new VersionAlreadyExistsError(NAME, "1\u00850")],
      [
        "InvalidLibraryNameError",
        new InvalidLibraryNameError(NAME, "contains a control character"),
      ],
      ["LibraryNotFoundInStoreError", new LibraryNotFoundInStoreError(NAME, [NAME])],
      [
        "VersionNotFoundInStoreError",
        new VersionNotFoundInStoreError(NAME, "1\u00850", [NAME]),
      ],
      [
        "PageNotFoundInStoreError",
        new PageNotFoundInStoreError(NAME, "1\u00850", NAME, [NAME]),
      ],
      [
        "AmbiguousPageInStoreError",
        new AmbiguousPageInStoreError(NAME, "1\u00850", NAME, [NAME]),
      ],
    ];
    for (const [label, error] of cases) {
      expect.soft(error.message, label).toContain(ESCAPED);
      expect.soft(error.message, label).not.toMatch(/\p{Cc}/u);
    }
  });

  it("escapes both the library and the version in a version label", () => {
    expect(formatVersionLabel(NAME, NAME)).toBe(`${ESCAPED}@${ESCAPED}`);
    expect(formatVersionLabel("React", "")).toBe("React@latest");
  });
});

describe("unavailable native module", () => {
  it("recognizes a better-sqlite3 binary that is missing or cannot load", () => {
    const missing = Object.assign(
      new Error(
        "Cannot find module '/tmp/node_modules/better-sqlite3/build/Release/better_sqlite3.node'",
      ),
      { code: "MODULE_NOT_FOUND" },
    );
    const unloadable = Object.assign(
      new Error(
        "C:\\app\\node_modules\\better-sqlite3\\prebuilds\\win32-x64.node: The specified module could not be found.",
      ),
      { code: "ERR_DLOPEN_FAILED" },
    );
    const otherPackage = Object.assign(
      new Error("Cannot find module 'missing-package'"),
      {
        code: "MODULE_NOT_FOUND",
      },
    );
    expect(isNativeModuleError(missing)).toBe(true);
    expect(isNativeModuleError(unloadable)).toBe(true);
    expect(isNativeModuleError(otherPackage)).toBe(false);
    expect(
      isNativeModuleError(new Error("SQLITE_CANTOPEN: unable to open database file")),
    ).toBe(false);
    expect(isNativeModuleError("better-sqlite3/build/Release/better_sqlite3.node")).toBe(
      false,
    );
  });

  it("names the platform and how to build the binary from source", () => {
    const { message } = new NativeModuleUnavailableError();
    expect(message).toContain(`on ${process.platform}-${process.arch}`);
    expect(message).toContain(
      "https://github.com/WiseLibs/better-sqlite3/blob/master/docs/compilation.md",
    );
    // Node-API binaries need neither an install script nor a matching Node.js version
    expect(message).not.toContain("allow-scripts");
    expect(message).not.toContain("Node.js version");
  });
});
