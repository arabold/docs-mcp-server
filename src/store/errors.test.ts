/**
 * Unit tests for the library conflict, naming and native module errors.
 */

import { describe, expect, it } from "vitest";
import {
  AmbiguousPageInStoreError,
  formatVersionLabel,
  InvalidLibraryNameError,
  LibraryAlreadyExistsError,
  LibraryNotFoundInStoreError,
  NativeModuleUnavailableError,
  nativeModuleProblem,
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
  it("tells a missing binary from one built for another Node.js version", () => {
    const missing = new Error(
      "Could not locate the bindings file. Tried:\n → /tmp/node_modules/better-sqlite3/build/better_sqlite3.node",
    );
    const otherVersion = Object.assign(
      new Error(
        "The module '/tmp/better_sqlite3.node'\nwas compiled against a different Node.js version using\nNODE_MODULE_VERSION 127.",
      ),
      { code: "ERR_DLOPEN_FAILED" },
    );
    expect(nativeModuleProblem(missing)).toBe("missing");
    expect(nativeModuleProblem(otherVersion)).toBe("nodeVersion");
    expect(
      nativeModuleProblem(new Error("SQLITE_CANTOPEN: unable to open database file")),
    ).toBeUndefined();
    expect(nativeModuleProblem("Could not locate the bindings file")).toBeUndefined();
  });

  it("names the commands that allow the install script and clear the npx cache", () => {
    const { message } = new NativeModuleUnavailableError();
    expect(message).toContain(
      "npm config set allow-scripts=better-sqlite3 --location=user",
    );
    expect(message).toContain("npm cache npx rm --force");
  });

  it("names the running Node.js version when the binary was built for another", () => {
    const { message } = new NativeModuleUnavailableError({ problem: "nodeVersion" });
    expect(message).toContain(
      `built for a different Node.js version than ${process.version}`,
    );
  });

  it("names the one-off override when npm's ignore-scripts skipped the download", () => {
    const { message } = new NativeModuleUnavailableError({ ignoreScripts: true });
    expect(message).toContain(
      "npx --ignore-scripts=false @arabold/docs-mcp-server@latest",
    );
    // ignore-scripts overrides allow-scripts, so that remedy would not help
    expect(message).not.toContain("allow-scripts=better-sqlite3");
  });
});
