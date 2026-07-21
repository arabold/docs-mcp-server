/**
 * Checks GitHub for a newer release than the currently running app version,
 * powering the sidebar's "Update available" pill.
 *
 * Uses `@tanstack/react-query`'s `useQuery` directly (not tRPC) since this
 * calls the public GitHub REST API, not the app's own backend.
 */
import { useQuery } from "@tanstack/react-query";
import { fallbackReleaseLabel, isVersionNewer } from "../utils/versionCheck";

const LATEST_RELEASE_ENDPOINT =
  "https://api.github.com/repos/arabold/docs-mcp-server/releases/latest";
const LATEST_RELEASE_FALLBACK_URL =
  "https://github.com/arabold/docs-mcp-server/releases/latest";

/** Release checks don't need to be fresher than this — avoids hammering the GitHub API. */
const STALE_TIME_MS = 60 * 60 * 1000;

/** The subset of the GitHub "get latest release" response this hook reads. */
interface GithubReleaseResponse {
  tag_name?: unknown;
  html_url?: unknown;
}

/** Result of comparing the running version against the latest GitHub release. */
export interface UpdateCheckResult {
  /** Whether a newer release than the current version is available. */
  hasUpdate: boolean;
  /** Display label for the latest release (e.g. "v1.4.0"), or null when none is known. */
  latestLabel: string | null;
  /** URL to the latest release, falling back to the repo's releases page. */
  releaseUrl: string;
}

const NO_UPDATE: UpdateCheckResult = {
  hasUpdate: false,
  latestLabel: null,
  releaseUrl: LATEST_RELEASE_FALLBACK_URL,
};

/**
 * Fetches the latest GitHub release and compares it against `currentVersion`.
 * Never throws — any fetch/parse failure resolves to {@link NO_UPDATE} so the
 * caller fails closed (no update surfaced) rather than showing an error UI
 * for a non-critical background check.
 */
async function fetchLatestRelease(currentVersion: string): Promise<UpdateCheckResult> {
  try {
    const response = await fetch(LATEST_RELEASE_ENDPOINT, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!response.ok) {
      return NO_UPDATE;
    }

    const payload = (await response.json()) as GithubReleaseResponse;
    const tagName = payload.tag_name;

    if (!isVersionNewer(tagName, currentVersion)) {
      return NO_UPDATE;
    }

    const latestLabel =
      (typeof tagName === "string" && tagName.trim().length > 0
        ? tagName.trim()
        : null) ?? fallbackReleaseLabel(tagName);
    if (!latestLabel) {
      return NO_UPDATE;
    }

    const releaseUrl =
      typeof payload.html_url === "string" && payload.html_url.trim().length > 0
        ? payload.html_url
        : LATEST_RELEASE_FALLBACK_URL;

    return { hasUpdate: true, latestLabel, releaseUrl };
  } catch {
    return NO_UPDATE;
  }
}

/**
 * Checks whether a newer release than `currentVersion` is available on
 * GitHub, for the sidebar's "Update available" pill.
 *
 * Resolves to "no update" (never an error state) while `currentVersion` is
 * unknown (e.g. system health still loading) or when the check itself
 * fails — see {@link fetchLatestRelease}. Uses a long `staleTime` since
 * release checks don't need to be fresh.
 *
 * @param currentVersion - The running app's version, e.g. from
 * `useSystemHealth().data?.version`. Pass `undefined` while unknown.
 */
export function useUpdateCheck(currentVersion: string | undefined): UpdateCheckResult {
  const { data } = useQuery({
    queryKey: ["github-latest-release", currentVersion ?? null],
    queryFn: () => fetchLatestRelease(currentVersion as string),
    enabled: Boolean(currentVersion),
    staleTime: STALE_TIME_MS,
  });

  return data ?? NO_UPDATE;
}
