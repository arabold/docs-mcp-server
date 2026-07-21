/**
 * Normalizes and compares semantic version strings for the web UI update
 * notification. The helpers strip Git-style prefixes, ignore build metadata,
 * and perform numeric comparisons to determine whether a newer release is
 * available.
 */

const VERSION_PREFIX_PATTERN = /^v/i;

/**
 * Converts a version string into its normalized form suitable for comparisons.
 * Returns null when the input cannot be interpreted as a semantic version.
 */
export const normalizeVersionTag = (input: unknown): string | null => {
  if (typeof input !== "string") {
    return null;
  }

  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const withoutPrefix = trimmed.replace(VERSION_PREFIX_PATTERN, "");
  return withoutPrefix.length > 0 ? withoutPrefix : null;
};

const extractComparableSegments = (version: string): number[] | null => {
  const base = version.split(/[+-]/)[0];
  const segments = base.split(".");

  if (segments.length === 0) {
    return null;
  }

  const numericSegments: number[] = [];
  for (const segment of segments) {
    if (segment.length === 0) {
      return null;
    }

    const parsed = Number.parseInt(segment, 10);
    if (Number.isNaN(parsed)) {
      return null;
    }
    numericSegments.push(parsed);
  }

  return numericSegments;
};

/**
 * Determines whether the latest version string represents a newer release than
 * the current version.
 */
export const isVersionNewer = (
  latestVersion: unknown,
  currentVersion: unknown,
): boolean => {
  const latestNormalized = normalizeVersionTag(latestVersion);
  const currentNormalized = normalizeVersionTag(currentVersion);

  if (!latestNormalized || !currentNormalized) {
    return false;
  }

  const latestSegments = extractComparableSegments(latestNormalized);
  const currentSegments = extractComparableSegments(currentNormalized);

  if (!latestSegments || !currentSegments) {
    return false;
  }

  const maxLength = Math.max(latestSegments.length, currentSegments.length);

  for (let index = 0; index < maxLength; index += 1) {
    const latest = latestSegments[index] ?? 0;
    const current = currentSegments[index] ?? 0;

    if (latest > current) {
      return true;
    }
    if (latest < current) {
      return false;
    }
  }

  return false;
};

export const getComparableVersion = (input: unknown): string | null => {
  const normalized = normalizeVersionTag(input);
  if (!normalized) {
    return null;
  }

  const base = normalized.split(/[+-]/)[0];
  return base.length > 0 ? base : null;
};

export const fallbackReleaseLabel = (input: unknown): string | null => {
  const comparable = getComparableVersion(input);
  return comparable ? `v${comparable}` : null;
};
