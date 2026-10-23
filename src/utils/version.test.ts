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
  type VersionCandidate,
} from "./version";

describe("toVersionCandidate", () => {
  it("classifies full and partial semantic versions as versions", () => {
    // Full versions are strict and keep the label as stored; partial versions
    // are completed and are not strict.
    const cases: Array<[label: string, expected: VersionCandidate]> = [
      ["1.2.3", { kind: "version", stored: "1.2.3", normalized: "1.2.3", strict: true }],
      [
        "2.0.0-beta",
        { kind: "version", stored: "2.0.0-beta", normalized: "2.0.0-beta", strict: true },
      ],
      [
        "1.0.0+build",
        { kind: "version", stored: "1.0.0+build", normalized: "1.0.0", strict: true },
      ],
      [
        "v2.0.0-beta.1",
        {
          kind: "version",
          stored: "v2.0.0-beta.1",
          normalized: "2.0.0-beta.1",
          strict: true,
        },
      ],
      ["1.20", { kind: "version", stored: "1.20", normalized: "1.20.0", strict: false }],
      ["5", { kind: "version", stored: "5", normalized: "5.0.0", strict: false }],
      ["v2", { kind: "version", stored: "v2", normalized: "2.0.0", strict: false }],
      [
        "v1.20",
        { kind: "version", stored: "v1.20", normalized: "1.20.0", strict: false },
      ],
    ];

    for (const [label, expected] of cases) {
      expect.soft(toVersionCandidate(label), label).toEqual(expected);
    }
  });

  it("classifies every other non-empty label as a tag", () => {
    const labels = [
      // semver.coerce() on its own pulls the first number out of arbitrary text
      // ("stable-2024" -> 2024.0.0), which would let a branch or channel name
      // sort and match as if it were a release.
      "stable-2024",
      "release-2024",
      "docs-v3",
      "node18",
      "alpha-1",
      "2024-01-15",
      // Channel names
      "stable",
      "latest",
      "main",
      "next",
      // Range syntax describes a query, not a released version.
      "1.x",
      "1.2.x",
      // Over-long numeric labels
      "1.2.3.4",
      // Completing "1.20-beta" would mean guessing which patch level it is a
      // prerelease of, so it stays an opaque tag and is reachable literally.
      "1.20-beta",
      "v2+docs",
    ];

    for (const label of labels) {
      expect
        .soft(toVersionCandidate(label), label)
        .toEqual({ kind: "tag", stored: label });
    }
  });

  it("should return null for an empty label, which means unversioned", () => {
    // Unversioned is its own bucket, not a tag.
    expect(toVersionCandidate("")).toBeNull();
  });
});

describe("toVersionCandidates", () => {
  it("keeps tags alongside versions in input order and drops empty labels", () => {
    const candidates = toVersionCandidates(["1.20", "", "stable", "2.0.0"]);

    expect(candidates.map((c) => c.stored)).toEqual(["1.20", "stable", "2.0.0"]);
    expect(candidates.map((c) => c.kind)).toEqual(["version", "tag", "version"]);
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
  it("places an unversioned label first, whether empty, null or undefined", () => {
    // sortVersionsDescending only takes strings, so null and undefined are
    // only reachable here.
    for (const unversioned of ["", null, undefined]) {
      const label = String(unversioned);
      expect.soft(compareVersionsDescending(unversioned, "1.0.0"), label).toBeLessThan(0);
      expect
        .soft(compareVersionsDescending("1.0.0", unversioned), label)
        .toBeGreaterThan(0);
      expect.soft(compareVersionsDescending(unversioned, unversioned), label).toBe(0);
    }
  });
});

describe("sortVersionsDescending", () => {
  it("sorts unversioned first, then versions newest first, then tags alphabetically", () => {
    const cases: Array<[versions: string[], expected: string[]]> = [
      [
        ["1.0.0", "3.0.0", "2.0.0"],
        ["3.0.0", "2.0.0", "1.0.0"],
      ],
      [
        ["1.0.1", "1.0.2"],
        ["1.0.2", "1.0.1"],
      ],
      [
        ["1.0.0", "", "2.0.0"],
        ["", "2.0.0", "1.0.0"],
      ],
      [
        ["18.2.0", "17.0.2", "", "18.0.0", "19.0.0-rc.1"],
        ["", "19.0.0-rc.1", "18.2.0", "18.0.0", "17.0.2"],
      ],
      // By value, not lexicographically
      [
        ["1.9.0", "1.10.0", "2.0.0"],
        ["2.0.0", "1.10.0", "1.9.0"],
      ],
      // Partial versions by value, not by text
      [
        ["1.20", "5", "2.0.0"],
        ["5", "2.0.0", "1.20"],
      ],
      // A prerelease below its release
      [
        ["2.0.0", "2.0.0-beta", "1.0.0"],
        ["2.0.0", "2.0.0-beta", "1.0.0"],
      ],
      // A leading "v" is ignored
      [
        ["v1.0.0", "v2.0.0"],
        ["v2.0.0", "v1.0.0"],
      ],
      [
        ["stable", "1.0.0", "", "next"],
        ["", "1.0.0", "next", "stable"],
      ],
      [
        ["xyz", "abc"],
        ["abc", "xyz"],
      ],
    ];

    for (const [versions, expected] of cases) {
      expect
        .soft(sortVersionsDescending(versions), versions.join(", "))
        .toEqual(expected);
    }
  });

  it("should not mutate the original array", () => {
    const versions = ["1.0.0", "3.0.0", "2.0.0"];
    const sorted = sortVersionsDescending(versions);
    expect(versions).toEqual(["1.0.0", "3.0.0", "2.0.0"]);
    expect(sorted).not.toBe(versions);
  });

  it("should order labels that normalize to the same version deterministically", () => {
    // "1.20" and "1.20.0" are the same semver, so ordering would otherwise fall
    // to store insertion order. The strict spelling wins, matching the label
    // semantic matching resolves to.
    expect(sortVersionsDescending(["1.20", "1.20.0"])).toEqual(["1.20.0", "1.20"]);
    expect(sortVersionsDescending(["1.20.0", "1.20"])).toEqual(["1.20.0", "1.20"]);
    // Equally strict spellings fall back to the label itself.
    expect(sortVersionsDescending(["v1.20", "1.20"])).toEqual(["1.20", "v1.20"]);
    expect(sortVersionsDescending(["1.20", "v1.20"])).toEqual(["1.20", "v1.20"]);
  });
});
