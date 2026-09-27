/**
 * Unit tests for the library conflict and naming errors.
 */

import { describe, expect, it } from "vitest";
import {
  InvalidLibraryNameError,
  LibraryAlreadyExistsError,
  VersionAlreadyExistsError,
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

  it.each([
    ["LibraryAlreadyExistsError", new LibraryAlreadyExistsError("a\nb\t\u001bc")],
    ["VersionAlreadyExistsError", new VersionAlreadyExistsError("a\nb\t\u001bc", "1\n0")],
    [
      "InvalidLibraryNameError",
      new InvalidLibraryNameError("a\nb\t\u001bc", "contains a control character"),
    ],
  ])("%s escapes control characters in names", (_label, error) => {
    expect(error.message).toContain(String.raw`a\nb\t\u001bc`);
    // biome-ignore lint/suspicious/noControlCharactersInRegex: asserting their absence
    expect(error.message).not.toMatch(/[\u0000-\u001f]/);
  });
});
