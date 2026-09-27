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

describe("normalizeVersionLabel", () => {
  it("should strip surrounding whitespace", () => {
    expect(normalizeVersionLabel(" 1.0.0 ")).toBe("1.0.0");
  });

  it("should lowercase the label", () => {
    expect(normalizeVersionLabel("LATEST")).toBe("latest");
    expect(normalizeVersionLabel("V2.0.0-Beta")).toBe("v2.0.0-beta");
  });

  it("should treat empty, whitespace-only, null and undefined as unversioned", () => {
    expect(normalizeVersionLabel("")).toBe("");
    expect(normalizeVersionLabel("   ")).toBe("");
    expect(normalizeVersionLabel(null)).toBe("");
    expect(normalizeVersionLabel(undefined)).toBe("");
  });

  it("should store a partial version verbatim rather than coercing it", () => {
    // "1.20" must NOT become "1.20.0" — they are distinct buckets.
    expect(normalizeVersionLabel("1.20")).toBe("1.20");
    expect(normalizeVersionLabel("1.20.0")).toBe("1.20.0");
  });

  it("should accept a non-version label without rejecting it", () => {
    expect(normalizeVersionLabel("stable")).toBe("stable");
    expect(normalizeVersionLabel("1.x")).toBe("1.x");
    expect(normalizeVersionLabel("release-2024")).toBe("release-2024");
  });
});

describe("normalizeVersionRef", () => {
  it("should normalize library and version consistently", () => {
    expect(normalizeVersionRef({ library: " React ", version: " 1.0.0 " })).toEqual({
      library: "react",
      version: "1.0.0",
    });
  });

  it("should use the same version rules as normalizeVersionLabel", () => {
    for (const version of [" 1.0.0 ", "LATEST", "   ", "1.20", "stable"]) {
      expect(normalizeVersionRef({ library: "lib", version }).version).toBe(
        normalizeVersionLabel(version),
      );
    }
  });
});

describe("normalizeLibraryName", () => {
  it("should not apply full case folding", () => {
    expect(normalizeLibraryName("Straße")).not.toBe(normalizeLibraryName("STRASSE"));
  });

  it("should fold casing and surrounding whitespace to one key", () => {
    expect(normalizeLibraryName(" React ")).toBe(normalizeLibraryName("REACT"));
  });
});

describe("normalizeLibraryDisplayName", () => {
  it("should trim only, preserving case, punctuation and inner spacing", () => {
    expect(normalizeLibraryDisplayName("  Next.js  Docs ")).toBe("Next.js  Docs");
  });
});

describe("describeLibraryNameProblem", () => {
  it.each([
    ["an empty name", ""],
    ["a whitespace-only name", "   "],
    ["a newline", "React\nDocs"],
    ["a tab", "React\tDocs"],
    ["a C1 control (U+0085)", "React\u0085Docs"],
    ["101 code points", "a".repeat(101)],
  ])("should reject %s", (_label, name) => {
    expect(describeLibraryNameProblem(name)).not.toBeNull();
  });

  it("should accept exactly 100 code points, counting astral characters once", () => {
    expect(describeLibraryNameProblem("a".repeat(100))).toBeNull();
    expect(describeLibraryNameProblem("😀".repeat(100))).toBeNull();
    expect(describeLibraryNameProblem("😀".repeat(101))).not.toBeNull();
  });

  it("should accept an emoji ZWJ sequence, since format characters are allowed", () => {
    expect(describeLibraryNameProblem("Team 👩‍💻 Docs")).toBeNull();
  });

  it.each(["Vue Router", "C#", "@tanstack/query", "Über Lib"])(
    "should accept %s and keep it unchanged as the display name",
    (name) => {
      expect(describeLibraryNameProblem(` ${name} `)).toBeNull();
      expect(normalizeLibraryDisplayName(` ${name} `)).toBe(name);
    },
  );
});
