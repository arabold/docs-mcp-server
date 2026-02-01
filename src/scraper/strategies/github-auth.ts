import { exec } from "node:child_process";
import { promisify } from "node:util";
import { logger } from "../../utils/logger";

const execAsync = promisify(exec);

/**
 * Resolves GitHub authentication headers using a cascading fallback mechanism.
 *
 * Resolution order (first match wins):
 * 1. Explicit `Authorization` header in input - user has full control
 * 2. `GITHUB_TOKEN` environment variable - standard GitHub Actions / CI convention
 * 3. `GH_TOKEN` environment variable - alternative used by some CI systems
 * 4. `gh auth token` CLI - local development convenience
 *
 * @param explicitHeaders - Headers provided by the user in scraper options
 * @returns Headers object with Authorization if available, or the original headers
 */
export async function resolveGitHubAuth(
  explicitHeaders?: Record<string, string>,
): Promise<Record<string, string>> {
  // 1. Check for explicit Authorization header (case-insensitive check)
  if (explicitHeaders) {
    const hasAuthHeader = Object.keys(explicitHeaders).some(
      (key) => key.toLowerCase() === "authorization",
    );
    if (hasAuthHeader) {
      return explicitHeaders;
    }
  }

  // 2. Check GITHUB_TOKEN environment variable
  const githubToken = process.env.GITHUB_TOKEN;
  if (githubToken) {
    logger.debug("Using GitHub token from GITHUB_TOKEN environment variable");
    return {
      ...explicitHeaders,
      Authorization: `Bearer ${githubToken}`,
    };
  }

  // 3. Check GH_TOKEN environment variable (fallback)
  const ghToken = process.env.GH_TOKEN;
  if (ghToken) {
    logger.debug("Using GitHub token from GH_TOKEN environment variable");
    return {
      ...explicitHeaders,
      Authorization: `Bearer ${ghToken}`,
    };
  }

  // 4. Try gh CLI as last resort
  try {
    const { stdout } = await execAsync("gh auth token", { timeout: 5000 });
    const cliToken = stdout.trim();
    if (cliToken) {
      logger.debug("Using GitHub token from local gh CLI");
      return {
        ...explicitHeaders,
        Authorization: `Bearer ${cliToken}`,
      };
    }
  } catch {
    // gh CLI not installed, not authenticated, or command failed - silently continue
  }

  // No authentication available - return original headers (or empty object)
  return explicitHeaders ?? {};
}
