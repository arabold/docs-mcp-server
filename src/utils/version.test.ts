/**
 * Unit tests for version comparison utilities.
 */

import { describe, expect, it } from "vitest";
import { compareVersionsDescending, sortVersionsDescending } from "./version";

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
