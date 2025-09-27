/**
 * Unit tests for version normalization and comparison helpers that drive the
 * release update notification on the web UI.
 */
import { describe, expect, it } from "vitest";

import {
  fallbackReleaseLabel,
  getComparableVersion,
  isVersionNewer,
  normalizeVersionTag,
} from "./versionCheck";

describe("normalizeVersionTag", () => {
  it("removes v-prefixes and trims whitespace", () => {
    expect(normalizeVersionTag(" v1.2.3 ")).toBe("1.2.3");
  });

  it("returns null for non-string input", () => {
    expect(normalizeVersionTag(undefined)).toBeNull();
    expect(normalizeVersionTag(42)).toBeNull();
  });
});

describe("getComparableVersion", () => {
  it("drops pre-release and metadata suffixes", () => {
    expect(getComparableVersion("v1.2.3-beta+abc")).toBe("1.2.3");
  });
});

describe("isVersionNewer", () => {
  it("detects when the remote version is newer", () => {
    expect(isVersionNewer("v1.2.4", "1.2.3")).toBe(true);
  });

  it("returns false for identical versions", () => {
    expect(isVersionNewer("1.2.3", "1.2.3")).toBe(false);
  });

  it("returns false when the remote version is older", () => {
    expect(isVersionNewer("v1.2.2", "1.2.3")).toBe(false);
  });

  it("ignores pre-release tags when comparing", () => {
    expect(isVersionNewer("v1.2.3-beta", "1.2.3")).toBe(false);
  });
});

describe("fallbackReleaseLabel", () => {
  it("returns a display label prefixed with v", () => {
    expect(fallbackReleaseLabel("1.4.0")).toBe("v1.4.0");
  });
});
