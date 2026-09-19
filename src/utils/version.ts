/**
 * Version comparison utilities for consistent sorting across the application.
 * Provides semver-aware comparison with support for unversioned (latest) entries.
 */

import semver from "semver";

/**
 * Compares two version strings for sorting in descending order (latest first).
 *
 * Rules:
 * - Unversioned entries (empty string, null, undefined) are considered "latest" and sort first.
 * - Valid semver versions are compared using semver rules.
 * - Invalid semver versions are compared as strings (case-insensitive).
 *
 * @param a First version string (may be empty, null, or undefined for unversioned)
 * @param b Second version string (may be empty, null, or undefined for unversioned)
 * @returns Negative if a should come before b, positive if b should come before a, 0 if equal
 */
export function compareVersionsDescending(
  a: string | null | undefined,
  b: string | null | undefined,
): number {
  const aIsUnversioned = a === "" || a === null || a === undefined;
  const bIsUnversioned = b === "" || b === null || b === undefined;

  // Unversioned entries come first (are "latest")
  if (aIsUnversioned && bIsUnversioned) return 0;
  if (aIsUnversioned) return -1;
  if (bIsUnversioned) return 1;

  // Both have versions - normalize via the same rules used for range matching,
  // so sort order and version resolution never disagree.
  const aSemver = toVersionCandidate(a)?.normalized;
  const bSemver = toVersionCandidate(b)?.normalized;

  if (aSemver && bSemver) {
    // Both are valid semver - compare descending (higher version first)
    return semver.rcompare(aSemver, bSemver);
  }

  // Fallback to string comparison (case-insensitive, descending)
  const aLower = (a as string).toLowerCase();
  const bLower = (b as string).toLowerCase();
  return bLower.localeCompare(aLower);
}

/**
 * Sorts an array of version strings in descending order (latest first).
 * Unversioned entries (empty string) are placed at the beginning.
 *
 * @param versions Array of version strings
 * @returns New array sorted in descending order
 */
export function sortVersionsDescending(versions: string[]): string[] {
  return [...versions].sort(compareVersionsDescending);
}

/**
 * A stored version string paired with the strict semver used to match it.
 *
 * Version labels in the store are whatever a project publishes — `"1.20"`,
 * `"5"`, `"v2.0.0"` or `"2.0.0-beta"` — but semver range matching only accepts
 * full `X.Y.Z` strings. A candidate keeps both forms side by side so matches
 * can be resolved back to the label that is actually in the store.
 */
export type VersionCandidate = {
  /** The version string exactly as stored in the database. */
  stored: string;
  /** Strict `X.Y.Z[-prerelease]` semver used for range matching and sorting. */
  normalized: string;
  /** True when `stored` was already valid semver and needed no coercion. */
  strict: boolean;
};

/**
 * Partial versions accepted as stored labels: `major` or `major.minor`, with an
 * optional `v` prefix (e.g. `"5"`, `"1.20"`, `"v1.20"`).
 *
 * Coercion is gated on this shape because `semver.coerce()` pulls the first
 * number out of arbitrary text — it turns `"stable-2024"` into `2024.0.0` and
 * `"node18"` into `18.0.0`, which would make non-version labels sort and match
 * as if they were releases.
 */
const PARTIAL_VERSION_PATTERN = /^v?\d+(?:\.\d+)?$/;

/**
 * Normalizes a stored version string into a {@link VersionCandidate}.
 *
 * Strict semver is matched first and preserved verbatim, so prerelease and
 * build metadata survive and a label like `"2.0.0-beta"` never collapses into
 * `"2.0.0"` and outranks the real release. Only the partial shapes in
 * {@link PARTIAL_VERSION_PATTERN} fall back to coercion.
 *
 * @param stored Version string as stored in the database.
 * @returns The candidate, or `null` when the string is not a version at all
 *   (e.g. `""`, `"stable"`, `"latest"`, `"stable-2024"`).
 */
export function toVersionCandidate(stored: string): VersionCandidate | null {
  const strict = semver.valid(stored);
  if (strict) {
    return { stored, normalized: strict, strict: true };
  }
  if (!PARTIAL_VERSION_PATTERN.test(stored)) {
    return null;
  }
  const coerced = semver.coerce(stored);
  if (coerced) {
    return { stored, normalized: coerced.version, strict: false };
  }
  return null;
}

/**
 * Maps stored version strings to {@link VersionCandidate}s, dropping the
 * entries that are not versions at all.
 *
 * @param versions Version strings as stored in the database.
 * @returns One candidate per recognizable version, in input order.
 */
export function toVersionCandidates(versions: string[]): VersionCandidate[] {
  return versions
    .map(toVersionCandidate)
    .filter((candidate): candidate is VersionCandidate => candidate !== null);
}
