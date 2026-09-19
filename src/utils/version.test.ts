/**
 * Unit tests for version label classification and comparison utilities.
 */

import { describe, expect, it } from "vitest";
import {
  compareVersionsDescending,
  isSemanticVersion,
  sortVersionsDescending,
  toVersionCandidate,
  toVersionCandidates,
} from "./version";

describe("toVersionCandidate", () => {
  it("should classify full semantic versions as versions, preserving metadata", () => {
    expect(toVersionCandidate("1.2.3")).toEqual({
      kind: "version",
      stored: "1.2.3",
      normalized: "1.2.3",
      strict: true,
    });
    expect(toVersionCandidate("2.0.0-beta")).toEqual({
      kind: "version",
      stored: "2.0.0-beta",
      normalized: "2.0.0-beta",
      strict: true,
    });
    expect(toVersionCandidate("1.0.0+build")).toMatchObject({
      kind: "version",
      stored: "1.0.0+build",
    });
    expect(toVersionCandidate("v2.0.0-beta.1")).toEqual({
      kind: "version",
      stored: "v2.0.0-beta.1",
      normalized: "2.0.0-beta.1",
      strict: true,
    });
  });

  it("should classify partial versions as versions", () => {
    expect(toVersionCandidate("1.20")).toEqual({
      kind: "version",
      stored: "1.20",
      normalized: "1.20.0",
      strict: false,
    });
    expect(toVersionCandidate("5")).toEqual({
      kind: "version",
      stored: "5",
      normalized: "5.0.0",
      strict: false,
    });
    expect(toVersionCandidate("v2")).toMatchObject({
      kind: "version",
      normalized: "2.0.0",
    });
    expect(toVersionCandidate("v1.20")).toMatchObject({
      kind: "version",
      normalized: "1.20.0",
    });
  });

  it("should classify labels that merely contain a number as tags", () => {
    // semver.coerce() on its own pulls the first number out of arbitrary text
    // ("stable-2024" -> 2024.0.0), which would let a branch or channel name
    // sort and match as if it were a release.
    for (const label of [
      "stable-2024",
      "release-2024",
      "docs-v3",
      "node18",
      "alpha-1",
      "2024-01-15",
    ]) {
      expect(toVersionCandidate(label)).toEqual({ kind: "tag", stored: label });
    }
  });

  it("should classify channel names as tags", () => {
    for (const label of ["stable", "latest", "main", "next"]) {
      expect(toVersionCandidate(label)).toEqual({ kind: "tag", stored: label });
    }
  });

  it("should classify range syntax stored as a label as a tag", () => {
    // Range syntax describes a query, not a released version.
    expect(toVersionCandidate("1.x")).toEqual({ kind: "tag", stored: "1.x" });
    expect(toVersionCandidate("1.2.x")).toEqual({ kind: "tag", stored: "1.2.x" });
  });

  it("should classify over-long numeric labels as tags", () => {
    expect(toVersionCandidate("1.2.3.4")).toEqual({ kind: "tag", stored: "1.2.3.4" });
  });

  it("should classify partial versions carrying a suffix as tags", () => {
    // Completing "1.20-beta" would mean guessing which patch level it is a
    // prerelease of, so it stays an opaque tag and is reachable literally.
    expect(toVersionCandidate("1.20-beta")).toEqual({
      kind: "tag",
      stored: "1.20-beta",
    });
    expect(toVersionCandidate("v2+docs")).toEqual({ kind: "tag", stored: "v2+docs" });
  });

  it("should return null for an empty label, which means unversioned", () => {
    // Unversioned is its own bucket, not a tag.
    expect(toVersionCandidate("")).toBeNull();
  });
});

describe("toVersionCandidates", () => {
  it("should keep tags alongside versions and preserve input order", () => {
    const candidates = toVersionCandidates(["1.20", "stable", "2.0.0"]);
    expect(candidates.map((c) => c.stored)).toEqual(["1.20", "stable", "2.0.0"]);
    expect(candidates.map((c) => c.kind)).toEqual(["version", "tag", "version"]);
  });

  it("should drop empty labels", () => {
    expect(toVersionCandidates(["1.0.0", "", "stable"]).map((c) => c.stored)).toEqual([
      "1.0.0",
      "stable",
    ]);
  });

  it("should keep both forms when a partial and its full version coexist", () => {
    const candidates = toVersionCandidates(["1.20", "1.20.0"]);
    expect(candidates).toHaveLength(2);
    expect(candidates.every((c) => c.kind === "version")).toBe(true);
    expect(candidates.filter(isSemanticVersion).map((c) => c.normalized)).toEqual([
      "1.20.0",
      "1.20.0",
    ]);
    expect(candidates.filter(isSemanticVersion).map((c) => c.strict)).toEqual([
      false,
      true,
    ]);
  });
});

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

  it("should place semantic versions ahead of opaque tags", () => {
    expect(compareVersionsDescending("1.0.0", "stable")).toBeLessThan(0);
    expect(compareVersionsDescending("stable", "1.0.0")).toBeGreaterThan(0);
  });

  it("should sort opaque tags alphabetically", () => {
    expect(compareVersionsDescending("next", "stable")).toBeLessThan(0);
    expect(compareVersionsDescending("stable", "next")).toBeGreaterThan(0);
    expect(compareVersionsDescending("abc", "xyz")).toBeLessThan(0);
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

  it("should sort semantic versions newest first, not lexicographically", () => {
    expect(sortVersionsDescending(["1.9.0", "1.10.0", "2.0.0"])).toEqual([
      "2.0.0",
      "1.10.0",
      "1.9.0",
    ]);
  });

  it("should sort partial versions by value, not by text", () => {
    expect(sortVersionsDescending(["1.20", "5", "2.0.0"])).toEqual([
      "5",
      "2.0.0",
      "1.20",
    ]);
  });

  it("should sort a prerelease below its release", () => {
    expect(sortVersionsDescending(["2.0.0", "2.0.0-beta", "1.0.0"])).toEqual([
      "2.0.0",
      "2.0.0-beta",
      "1.0.0",
    ]);
  });

  it("should order labels that normalize to the same version deterministically", () => {
    // "1.20" and "1.20.0" are the same semver, so ordering would otherwise fall
    // to store insertion order. The strict spelling wins, matching the label
    // semantic matching resolves to.
    expect(sortVersionsDescending(["1.20", "1.20.0"])).toEqual(["1.20.0", "1.20"]);
    expect(sortVersionsDescending(["1.20.0", "1.20"])).toEqual(["1.20.0", "1.20"]);
  });

  it("should place unversioned first and tags last", () => {
    expect(sortVersionsDescending(["stable", "1.0.0", "", "next"])).toEqual([
      "",
      "1.0.0",
      "next",
      "stable",
    ]);
  });
});
