import { lookup } from "node:dns/promises";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { matchesAnyHostPattern } from "../scraper/utils/patternMatcher";
import type { AppConfig } from "./config";
import { AccessPolicyError } from "./errors";

const SPECIAL_USE_IPV4_CIDRS = [
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.0.0.0/24",
  "192.0.2.0/24",
  "192.168.0.0/16",
  "198.18.0.0/15",
  "198.51.100.0/24",
  "203.0.113.0/24",
  "224.0.0.0/4",
  "240.0.0.0/4",
];

const SPECIAL_USE_IPV6_CIDRS = ["::/128", "::1/128", "fc00::/7", "fe80::/10", "ff00::/8"];

const ARCHIVE_EXTENSIONS = new Set([".zip", ".tar", ".gz", ".tgz"]);

type ScraperSecurityConfig = AppConfig["scraper"]["security"];

export interface ResolvedFileAccess {
  filePath: string;
  accessPath: string;
  virtualArchivePath: string | null;
}

/**
 * Shared access policy for outbound network and local file access.
 */
export class ScraperAccessPolicy {
  private readonly allowedCidrs = new net.BlockList();
  private readonly specialUseCidrs = new net.BlockList();
  private readonly allowedHosts: string[];

  constructor(private readonly security: ScraperSecurityConfig) {
    this.allowedHosts = security.network.allowedHosts;

    for (const cidr of security.network.allowedCidrs) {
      this.addCidr(this.allowedCidrs, cidr);
    }

    for (const cidr of SPECIAL_USE_IPV4_CIDRS) {
      this.addCidr(this.specialUseCidrs, cidr);
    }
    for (const cidr of SPECIAL_USE_IPV6_CIDRS) {
      this.addCidr(this.specialUseCidrs, cidr);
    }
  }

  /**
   * Checks whether a network URL is allowed before connecting.
   */
  async assertNetworkUrlAllowed(url: string): Promise<void> {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return;
    }

    const hostname = normalizeHostname(parsed.hostname);
    const ipFamily = net.isIP(hostname);

    if (this.security.network.mode === "allowlist") {
      // Allowlist mode: a request is permitted iff its hostname matches a
      // configured host pattern OR every resolved IP for the hostname is
      // inside `allowedCidrs`. `allowPrivateNetworks` is intentionally ignored
      // here because the explicit allowlist is the complete authorization
      // surface.
      //
      // A hostname listed in `allowedHosts` is authoritative for that name:
      // we trust its DNS answers, even when they resolve to private or
      // special-use addresses. This mirrors `open` mode and matches the
      // documented mental model — adding a host to `allowedHosts` is the
      // explicit trust decision. Operators who want a strictly address-bound
      // policy can leave `allowedHosts` empty and use `allowedCidrs` only.
      if (ipFamily !== 0) {
        const family = ipFamily === 6 ? "ipv6" : "ipv4";
        if (this.allowedCidrs.check(hostname, family)) return;
        throw new AccessPolicyError(`Security policy blocked network access to ${url}`);
      }

      if (matchesAnyHostPattern(hostname, this.allowedHosts)) {
        return;
      }

      const addresses = await resolveAddresses(hostname);
      const allAllowedByCidr =
        addresses.length > 0 &&
        addresses.every((address) => {
          const family = net.isIP(address.address);
          if (family === 0) return false;
          return this.allowedCidrs.check(address.address, family === 6 ? "ipv6" : "ipv4");
        });
      if (allAllowedByCidr) return;

      throw new AccessPolicyError(`Security policy blocked network access to ${url}`);
    }

    // Open mode: public targets are allowed; private/special-use targets are
    // blocked unless explicitly opened up.
    if (this.security.network.allowPrivateNetworks) {
      return;
    }

    if (ipFamily !== 0) {
      this.assertSpecialUseAddressAllowed(hostname, url);
      return;
    }

    if (looksLikeIpLiteral(hostname)) {
      throw new AccessPolicyError(`Security policy blocked network access to ${url}`);
    }

    if (matchesAnyHostPattern(hostname, this.allowedHosts)) {
      return;
    }

    const addresses = await resolveAddresses(hostname);
    for (const address of addresses) {
      this.assertSpecialUseAddressAllowed(address.address, url);
    }
  }

  /**
   * Checks whether TLS certificate validation may be bypassed for a URL.
   */
  shouldAllowInvalidTls(url: string): boolean {
    try {
      const parsed = new URL(url);
      return parsed.protocol === "https:" && this.security.network.allowInvalidTls;
    } catch {
      return false;
    }
  }

  /**
   * Resolves and validates a file URL against the configured file access policy.
   */
  async resolveFileAccess(
    url: string,
    additionalAllowedRoots: string[] = [],
  ): Promise<ResolvedFileAccess> {
    const filePath = fileUrlToPathLoose(url);
    const resolved = await resolveArchiveAwarePath(filePath);
    const accessPath = resolved.archivePath ?? filePath;
    const bypassRoots = await this.expandRoots(additionalAllowedRoots);
    const matchedBypassRoot = await this.findContainingRoot(
      accessPath,
      bypassRoots,
      false,
    );

    let matchedRoot: string | null = matchedBypassRoot;

    if (this.security.fileAccess.mode === "disabled" && !matchedBypassRoot) {
      throw new AccessPolicyError(`Security policy blocked local file access for ${url}`);
    }

    if (this.security.fileAccess.mode === "allowedRoots" && !matchedBypassRoot) {
      const configuredRoots = await this.expandRoots(
        this.security.fileAccess.allowedRoots,
      );
      if (configuredRoots.length === 0) {
        throw new AccessPolicyError(
          `Security policy blocked local file access for ${url}`,
        );
      }

      matchedRoot = await this.findContainingRoot(
        accessPath,
        configuredRoots,
        this.security.fileAccess.followSymlinks,
      );
      if (!matchedRoot) {
        throw new AccessPolicyError(
          `Security policy blocked local file access for ${url}`,
        );
      }
    }

    if (!this.security.fileAccess.followSymlinks && !matchedBypassRoot) {
      const symlinkPath = await findSymlinkInPath(accessPath);
      if (symlinkPath) {
        throw new AccessPolicyError(`Security policy blocked symlink access for ${url}`);
      }
    }

    if (!this.security.fileAccess.includeHidden) {
      // Hidden-segment checks apply to segments strictly below the matched
      // allowed root. Segments at-or-above the root are part of the user's
      // explicit opt-in: a configured root like `/Users/x/.config/docs` is
      // expected to live under a hidden ancestor and must not be self-rejected.
      // In `unrestricted` mode with no specific match, fall back to checking
      // the full absolute path.
      if (hasHiddenSegmentBelowRoot(filePath, matchedRoot)) {
        throw new AccessPolicyError(
          `Security policy blocked hidden file access for ${url}`,
        );
      }
      if (
        resolved.virtualArchivePath &&
        hasHiddenArchiveSegment(resolved.virtualArchivePath)
      ) {
        throw new AccessPolicyError(
          `Security policy blocked hidden archive entry access for ${url}`,
        );
      }
    }

    return {
      filePath,
      accessPath,
      virtualArchivePath: resolved.virtualArchivePath,
    };
  }

  /**
   * Throws if `address` falls inside a blocked special-use range and is not
   * explicitly permitted by `allowedCidrs`. Used both for direct-IP targets
   * and for revalidating DNS-resolved addresses (open mode) and allowlisted
   * hostnames (allowlist mode, to close DNS-rebinding gaps).
   */
  private assertSpecialUseAddressAllowed(address: string, url: string): void {
    const family = net.isIP(address);
    if (family === 0) {
      return;
    }

    const type = family === 6 ? "ipv6" : "ipv4";
    if (!this.specialUseCidrs.check(address, type)) {
      return;
    }

    if (this.allowedCidrs.check(address, type)) {
      return;
    }

    throw new AccessPolicyError(`Security policy blocked network access to ${url}`);
  }

  private addCidr(blockList: net.BlockList, cidr: string): void {
    const [network, prefix] = cidr.split("/");
    const family = net.isIP(network);
    if (family === 0 || prefix === undefined) {
      return;
    }
    blockList.addSubnet(
      network,
      Number.parseInt(prefix, 10),
      family === 6 ? "ipv6" : "ipv4",
    );
  }

  private async expandRoots(roots: string[]): Promise<string[]> {
    const expanded: string[] = [];
    for (const root of roots) {
      const value = await expandConfiguredRoot(root);
      if (value) {
        expanded.push(value);
      }
    }
    return expanded;
  }

  private async findContainingRoot(
    accessPath: string,
    roots: string[],
    followSymlinks: boolean,
  ): Promise<string | null> {
    const resolvedAccessPath = await resolveContainmentPath(accessPath, followSymlinks);
    for (const root of roots) {
      const resolvedRoot = await resolveContainmentPath(root, followSymlinks);
      if (pathContains(resolvedRoot, resolvedAccessPath)) {
        return resolvedRoot;
      }
    }
    return null;
  }
}

async function resolveAddresses(
  hostname: string,
): Promise<Array<{ address: string; family: number }>> {
  try {
    const result = await lookup(hostname, { all: true, verbatim: true });
    return Array.isArray(result) ? result : [];
  } catch {
    return [];
  }
}

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[(.*)]$/, "$1");
}

function looksLikeIpLiteral(hostname: string): boolean {
  return hostname.includes(":") || /^\d+(?:\.\d+){0,3}$/.test(hostname);
}

async function findSymlinkInPath(targetPath: string): Promise<string | null> {
  const resolved = path.resolve(targetPath);
  const root = path.parse(resolved).root;
  const relative = path.relative(root, resolved);
  const segments = relative.split(path.sep).filter(Boolean);
  let current = root;

  for (const segment of segments) {
    current = path.join(current, segment);
    const stats = await fs.lstat(current).catch(() => null);
    if (stats?.isSymbolicLink()) {
      return current;
    }
  }

  return null;
}

/**
 * Converts a file URL into a local filesystem path while preserving legacy leniency.
 */
export function fileUrlToPathLoose(url: string): string {
  let filePath = url.replace(/^file:\/\/\/?/, "");
  filePath = decodeURIComponent(filePath);

  if (!filePath.startsWith("/") && process.platform !== "win32") {
    filePath = `/${filePath}`;
  }

  return filePath;
}

const USER_DIR_TOKENS: Record<string, string> = {
  $DOCUMENTS: "Documents",
  $DOWNLOADS: "Downloads",
  $DESKTOP: "Desktop",
};

/**
 * Expands user-facing configured root tokens into concrete filesystem paths.
 *
 * Supported tokens:
 * - `$HOME`     — the user's home directory (broad; grants access to dotfiles).
 * - `$DOCUMENTS`, `$DOWNLOADS`, `$DESKTOP` — standard user folders. Resolve to
 *   `<home>/<Folder>` if that directory exists, otherwise null so the token
 *   denies rather than silently granting an unexpected path.
 * - `$CWD`      — the process's current working directory. Useful for CLI use.
 *
 * Any other value is treated as a literal filesystem path and absolute-resolved.
 * Returning `null` means the token could not be resolved on this platform or
 * account and therefore grants no access by itself.
 */
export async function expandConfiguredRoot(root: string): Promise<string | null> {
  if (root === "$HOME") {
    const homeDir = os.homedir();
    return homeDir ? path.resolve(homeDir) : null;
  }

  if (root === "$CWD") {
    return path.resolve(process.cwd());
  }

  const subdir = USER_DIR_TOKENS[root];
  if (subdir !== undefined) {
    const homeDir = os.homedir();
    if (!homeDir) {
      return null;
    }
    const candidate = path.join(homeDir, subdir);
    const stats = await fs.stat(candidate).catch(() => null);
    if (!stats?.isDirectory()) {
      return null;
    }
    return path.resolve(candidate);
  }

  return path.resolve(root);
}

async function resolveArchiveAwarePath(filePath: string): Promise<{
  archivePath: string | null;
  virtualArchivePath: string | null;
}> {
  let currentPath = filePath;
  while (
    currentPath !== "/" &&
    currentPath !== "." &&
    path.dirname(currentPath) !== currentPath
  ) {
    const stats = await fs.lstat(currentPath).catch(() => null);
    if (stats?.isFile() && looksLikeArchivePath(currentPath)) {
      const virtualArchivePath = filePath
        .substring(currentPath.length)
        .replace(/^\/+/, "")
        .replace(/^\\+/, "");
      return {
        archivePath: currentPath,
        virtualArchivePath: virtualArchivePath || null,
      };
    }
    if (stats) {
      return { archivePath: null, virtualArchivePath: null };
    }
    currentPath = path.dirname(currentPath);
  }

  return { archivePath: null, virtualArchivePath: null };
}

async function resolveContainmentPath(
  targetPath: string,
  followSymlinks: boolean,
): Promise<string> {
  if (!followSymlinks) {
    return path.resolve(targetPath);
  }

  return fs.realpath(targetPath).catch(() => path.resolve(targetPath));
}

function looksLikeArchivePath(filePath: string): boolean {
  return ARCHIVE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function pathContains(root: string, candidate: string): boolean {
  if (root === candidate) {
    return true;
  }

  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

/**
 * Returns true if any path segment strictly below `matchedRoot` starts with a
 * dot. When `matchedRoot` is null (e.g. `unrestricted` mode with no explicit
 * containing root), the entire absolute path is checked. The matched root
 * itself is treated as opt-in and never contributes to the hidden check, so
 * configuring an allowed root like `/Users/x/.config/docs` does not
 * self-reject because its absolute path contains `.config`.
 */
function hasHiddenSegmentBelowRoot(
  targetPath: string,
  matchedRoot: string | null,
): boolean {
  const resolved = path.resolve(targetPath);
  let segments: string[];
  if (matchedRoot) {
    const resolvedRoot = path.resolve(matchedRoot);
    if (resolved === resolvedRoot) return false;
    const relative = path.relative(resolvedRoot, resolved);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      // Target is outside the matched root — fall back to the strict check
      // to remain defensive.
      segments = resolved.split(path.sep).filter(Boolean);
    } else {
      segments = relative.split(path.sep).filter(Boolean);
    }
  } else {
    segments = resolved.split(path.sep).filter(Boolean);
  }
  return segments.some((segment) => segment.startsWith("."));
}

function hasHiddenArchiveSegment(archivePath: string): boolean {
  return archivePath
    .split(/[\\/]+/)
    .filter(Boolean)
    .some((segment) => segment.startsWith("."));
}
