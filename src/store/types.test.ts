/**
 * Unit tests for store-level version label normalization.
 */

import { describe, expect, it } from "vitest";
import { normalizeVersionLabel, normalizeVersionRef } from "./types";

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
