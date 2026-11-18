import semver from "semver";
import {
  sortVersionsDescending,
  toVersionCandidate,
  VERSION_REQUEST_PATTERN,
} from "../utils/version";
import { type DocumentationVersion, normalizeVersionLabel } from "./types";

/**
 * Describes how the indexed label relates to a documentation request.
 * @param requested The caller's version label or range.
 * @param indexed The selected label, or an empty label for unversioned content.
 * @returns The requested and selected labels and their relationship.
 */
export function describeDocumentationVersion(
  requested: string | undefined,
  indexed: string | null,
): DocumentationVersion {
  const target = normalizeVersionLabel(requested);
  const indexedVersion = indexed || null;
  const candidate = indexedVersion ? toVersionCandidate(indexedVersion) : null;
  const isExact = semver.valid(target) !== null;
  const matches =
    target === indexedVersion ||
    (candidate?.kind === "version" &&
      (isExact ? candidate.strict : VERSION_REQUEST_PATTERN.test(target)) &&
      semver.satisfies(candidate.normalized, target, { includePrerelease: true }));

  let versionMatch: DocumentationVersion["versionMatch"] = "not-requested";
  if (target) {
    versionMatch = !indexedVersion ? "unversioned" : matches ? "matched" : "different";
  }

  return {
    requestedVersion: requested?.trim() || undefined,
    indexedVersion,
    versionMatch,
  };
}

/**
 * Orders documentation buckets for lookup and prefers the requested release line.
 * @param labels The indexed labels available to search.
 * @param preferred The label already selected, or null when none resolved.
 * @param requested The version or range originally requested.
 * @returns The labels in lookup order.
 */
export function documentationFallbacks(
  labels: string[],
  preferred: string | null,
  requested?: string,
): string[] {
  const target = normalizeVersionLabel(requested);
  const release = target ? semver.parse(target) : null;
  const ranked = sortVersionsDescending(labels).map((label) => {
    const candidate = toVersionCandidate(label);
    const match = describeDocumentationVersion(requested, label).versionMatch;
    let priority = Number(candidate?.kind === "version");
    if (release && candidate?.kind === "version") {
      const indexed = semver.parse(candidate.normalized);
      if (indexed?.major === release.major) {
        priority = indexed.minor === release.minor ? 3 : 2;
      }
    }
    if (match === "matched") priority = 4;
    if (!target && label === preferred) priority = 5;
    return { label, priority, preferred: label === preferred };
  });
  return ranked
    .sort(
      (a, b) =>
        b.priority - a.priority || Number(b.preferred) - Number(a.preferred),
    )
    .map(({ label }) => label);
}
