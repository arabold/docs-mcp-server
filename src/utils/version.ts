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

  // Both have versions - try semver comparison
  // First try exact semver validation (preserves prerelease tags)
  // Then fall back to coercion for loose versions like "v1.0.0"
  const aSemver = semver.valid(a) ?? semver.valid(semver.coerce(a));
  const bSemver = semver.valid(b) ?? semver.valid(semver.coerce(b));

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
