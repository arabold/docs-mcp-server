/**
 * Unit tests for store-level version label and library name normalization.
 */

import { describe, expect, it } from "vitest";
import {
  describeLibraryNameProblem,
  normalizeLibraryDisplayName,
  normalizeLibraryName,
  normalizeVersionLabel,
  normalizeVersionRef,
} from "./types";

/** Version labels and their normalized form, shared by both version normalizers. */
const versionLabelCases: [
  label: string,
  input: string | null | undefined,
  expected: string,
][] = [
  ["surrounding whitespace is stripped", " 1.0.0 ", "1.0.0"],
  ["a tag is lowercased", "LATEST", "latest"],
  ["a prerelease is lowercased", "V2.0.0-Beta", "v2.0.0-beta"],
  ["an empty label is unversioned", "", ""],
  ["a whitespace-only label is unversioned", "   ", ""],
  ["null is unversioned", null, ""],
  ["undefined is unversioned", undefined, ""],
  // "1.20" must NOT become "1.20.0": they are distinct buckets
  ["a partial version is stored verbatim", "1.20", "1.20"],
  ["a full version is stored verbatim", "1.20.0", "1.20.0"],
  ["a tag is accepted", "stable", "stable"],
  ["a wildcard label is accepted", "1.x", "1.x"],
  ["a free-form label is accepted", "release-2024", "release-2024"],
];

describe("normalizeVersionLabel", () => {
  it("trims and lowercases a label, treating an empty one as unversioned", () => {
    for (const [label, input, expected] of versionLabelCases) {
      expect.soft(normalizeVersionLabel(input), label).toBe(expected);
    }
  });
});

describe("normalizeVersionRef", () => {
  it("normalizes the library like normalizeLibraryName and the version like normalizeVersionLabel", () => {
    expect(normalizeVersionRef({ library: " React ", version: " 1.0.0 " })).toEqual({
      library: "react",
      version: "1.0.0",
    });
    for (const [label, input, expected] of versionLabelCases) {
      expect
        .soft(
          normalizeVersionRef({ library: "lib", version: input ?? "" }).version,
          label,
        )
        .toBe(expected);
    }
  });
});

describe("normalizeLibraryName", () => {
  it("folds casing and surrounding whitespace to one key, without full case folding", () => {
    expect(normalizeLibraryName(" React ")).toBe(normalizeLibraryName("REACT"));
    expect(normalizeLibraryName("Straße")).not.toBe(normalizeLibraryName("STRASSE"));
  });
});

describe("normalizeLibraryDisplayName", () => {
  it("should trim only, preserving case, punctuation and inner spacing", () => {
    expect(normalizeLibraryDisplayName("  Next.js  Docs ")).toBe("Next.js  Docs");
  });
});

describe("describeLibraryNameProblem", () => {
  it("rejects empty, control-character and overlong names", () => {
    const cases: [label: string, name: string][] = [
      ["an empty name", ""],
      ["a whitespace-only name", "   "],
      ["a newline", "React\nDocs"],
      ["a tab", "React\tDocs"],
      ["a C1 control (U+0085)", "React\u0085Docs"],
      ["101 code points", "a".repeat(101)],
      ["101 astral characters", "😀".repeat(101)],
    ];
    for (const [label, name] of cases) {
      expect.soft(describeLibraryNameProblem(name), label).not.toBeNull();
    }
  });

  it("accepts names up to 100 code points and keeps them unchanged as the display name", () => {
    const cases: [label: string, name: string][] = [
      ["exactly 100 code points", "a".repeat(100)],
      ["100 astral characters, each counted once", "😀".repeat(100)],
      // Format characters are allowed
      ["an emoji ZWJ sequence", "Team 👩‍💻 Docs"],
      ["a name with a space", "Vue Router"],
      ["a name with punctuation", "C#"],
      ["a scoped package name", "@tanstack/query"],
      ["a name with an umlaut", "Über Lib"],
    ];
    for (const [label, name] of cases) {
      expect.soft(describeLibraryNameProblem(` ${name} `), label).toBeNull();
      expect.soft(normalizeLibraryDisplayName(` ${name} `), label).toBe(name);
    }
  });
});
