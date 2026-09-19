/**
 * Unit tests for version comparison utilities.
 */

import { describe, expect, it } from "vitest";
import {
  compareVersionsDescending,
  sortVersionsDescending,
  toVersionCandidate,
  toVersionCandidates,
} from "./version";

describe("compareVersionsDescending", () => {
  it("should place unversioned (empty string) first", () => {
    expect(compareVersionsDescending("", "1.0.0")).toBeLessThan(0);
    expect(compareVersionsDescending("1.0.0", "")).toBeGreaterThan(0);
    expect(compareVersionsDescending("", "")).toBe(0);
  });

  it("should place unversioned (null) first", () => {
    expect(compareVersionsDescending(null, "1.0.0")).toBeLessThan(0);
    expect(compareVersionsDescending("1.0.0", null)).toBeGreaterThan(0);
    expect(compareVersionsDescending(null, null)).toBe(0);
  });

  it("should place unversioned (undefined) first", () => {
    expect(compareVersionsDescending(undefined, "1.0.0")).toBeLessThan(0);
    expect(compareVersionsDescending("1.0.0", undefined)).toBeGreaterThan(0);
    expect(compareVersionsDescending(undefined, undefined)).toBe(0);
  });

  it("should sort semver versions in descending order (latest first)", () => {
    expect(compareVersionsDescending("2.0.0", "1.0.0")).toBeLessThan(0);
    expect(compareVersionsDescending("1.0.0", "2.0.0")).toBeGreaterThan(0);
    expect(compareVersionsDescending("1.0.0", "1.0.0")).toBe(0);
  });

  it("should handle semver with different patch versions", () => {
    expect(compareVersionsDescending("1.0.2", "1.0.1")).toBeLessThan(0);
    expect(compareVersionsDescending("1.0.1", "1.0.2")).toBeGreaterThan(0);
  });

  it("should handle semver with prerelease tags", () => {
    // 1.0.0 > 1.0.0-alpha, so 1.0.0 should come first in descending order
    expect(compareVersionsDescending("1.0.0", "1.0.0-alpha")).toBeLessThan(0);
    expect(compareVersionsDescending("1.0.0-alpha", "1.0.0")).toBeGreaterThan(0);
  });

  it("should coerce loose version strings", () => {
    // "v1.0.0" should be coerced to "1.0.0"
    expect(compareVersionsDescending("v2.0.0", "v1.0.0")).toBeLessThan(0);
  });

  it("should fallback to string comparison for invalid semver", () => {
    // "xyz" and "abc" - descending alphabetical order
    expect(compareVersionsDescending("xyz", "abc")).toBeLessThan(0);
    expect(compareVersionsDescending("abc", "xyz")).toBeGreaterThan(0);
  });
});

describe("sortVersionsDescending", () => {
  it("should sort an array of versions in descending order", () => {
    const versions = ["1.0.0", "3.0.0", "2.0.0"];
    const sorted = sortVersionsDescending(versions);
    expect(sorted).toEqual(["3.0.0", "2.0.0", "1.0.0"]);
  });

  it("should place empty string (unversioned) first", () => {
    const versions = ["1.0.0", "", "2.0.0"];
    const sorted = sortVersionsDescending(versions);
    expect(sorted).toEqual(["", "2.0.0", "1.0.0"]);
  });

  it("should not mutate the original array", () => {
    const versions = ["1.0.0", "3.0.0", "2.0.0"];
    const sorted = sortVersionsDescending(versions);
    expect(versions).toEqual(["1.0.0", "3.0.0", "2.0.0"]);
    expect(sorted).not.toBe(versions);
  });

  it("should handle real-world version lists", () => {
    const versions = ["18.2.0", "17.0.2", "", "18.0.0", "19.0.0-rc.1"];
    const sorted = sortVersionsDescending(versions);
    // Expected: unversioned first, then 19.0.0-rc.1, 18.2.0, 18.0.0, 17.0.2
    expect(sorted).toEqual(["", "19.0.0-rc.1", "18.2.0", "18.0.0", "17.0.2"]);
  });
});

describe("toVersionCandidate", () => {
  it("should keep strict semver verbatim", () => {
    expect(toVersionCandidate("1.2.3")).toEqual({
      stored: "1.2.3",
      normalized: "1.2.3",
      strict: true,
    });
  });

  it("should coerce partial versions to full semver", () => {
    expect(toVersionCandidate("1.20")).toEqual({
      stored: "1.20",
      normalized: "1.20.0",
      strict: false,
    });
    expect(toVersionCandidate("5")).toEqual({
      stored: "5",
      normalized: "5.0.0",
      strict: false,
    });
  });

  it("should preserve prerelease and build metadata instead of collapsing it", () => {
    expect(toVersionCandidate("2.0.0-beta")).toEqual({
      stored: "2.0.0-beta",
      normalized: "2.0.0-beta",
      strict: true,
    });
    // The "v" prefix is still strict semver, and the tag must survive.
    expect(toVersionCandidate("v2.0.0-beta.1")).toEqual({
      stored: "v2.0.0-beta.1",
      normalized: "2.0.0-beta.1",
      strict: true,
    });
  });

  it("should accept a 'v' prefix on partial versions", () => {
    expect(toVersionCandidate("v1.20")).toEqual({
      stored: "v1.20",
      normalized: "1.20.0",
      strict: false,
    });
  });

  it("should reject strings that are not versions", () => {
    expect(toVersionCandidate("")).toBeNull();
    expect(toVersionCandidate("stable")).toBeNull();
    expect(toVersionCandidate("latest")).toBeNull();
  });

  it("should reject labels that merely contain a number", () => {
    // semver.coerce() on its own pulls the first number out of arbitrary text
    // ("stable-2024" -> 2024.0.0), which would let a branch or channel name
    // sort and match as if it were a release. Only bare major[.minor] shapes
    // may fall back to coercion.
    expect(toVersionCandidate("stable-2024")).toBeNull();
    expect(toVersionCandidate("release-2024")).toBeNull();
    expect(toVersionCandidate("docs-v3")).toBeNull();
    expect(toVersionCandidate("node18")).toBeNull();
    expect(toVersionCandidate("alpha-1")).toBeNull();
    expect(toVersionCandidate("2024-01-15")).toBeNull();
  });

  it("should reject range syntax, which is a query and not a stored version", () => {
    expect(toVersionCandidate("1.x")).toBeNull();
    expect(toVersionCandidate("1.2.x")).toBeNull();
  });
});

describe("toVersionCandidates", () => {
  it("should drop non-versions and keep input order", () => {
    expect(toVersionCandidates(["1.20", "stable", "2.0.0"]).map((c) => c.stored)).toEqual(
      ["1.20", "2.0.0"],
    );
  });

  it("should keep both forms when a partial and its full version coexist", () => {
    const candidates = toVersionCandidates(["1.20", "1.20.0"]);
    expect(candidates).toHaveLength(2);
    expect(candidates.every((c) => c.normalized === "1.20.0")).toBe(true);
    expect(candidates.map((c) => c.strict)).toEqual([false, true]);
  });
});
