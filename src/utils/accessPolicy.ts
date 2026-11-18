import { lookup } from "node:dns/promises";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { matchesAnyHostPattern } from "../scraper/utils/patternMatcher";
import type { AppConfig } from "./config";
import { AccessPolicyError } from "./errors";
import { logger } from "./logger";

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

/**
 * Where users go to change file access decisions.
 *
 * Rejections state which rule blocked the path and point here, rather than
 * naming individual settings and environment variables. Every setting named in
 * an error is one more thing a rename can silently invalidate, and the docs
 * carry the full picture — config file, env vars, and tokens — in one place
 * that is already maintained. Deep-linked without an anchor on purpose: a stale
 * anchor fails quietly.
 */
const FILE_ACCESS_DOCS =
  "https://github.com/arabold/docs-mcp-server/blob/main/docs/setup/configuration.md";

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
  /** Roots already reported as unresolvable, so each is warned about once. */
  private readonly warnedUnresolvedRoots = new Set<string>();
  private hasWarnedUnavailableAllowlist = false;
  private hasLoggedConfiguredRoots = false;

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
   * @param url - The requested URL.
   * @param resolvedAddresses - DNS answers, when the caller pins its connection to them.
   */
  async assertNetworkUrlAllowed(
    url: string,
    resolvedAddresses?: Awaited<ReturnType<typeof resolveAddresses>>,
  ): Promise<void> {
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

      const addresses = resolvedAddresses ?? (await resolveAddresses(hostname));
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

    const addresses = resolvedAddresses ?? (await resolveAddresses(hostname));
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
   *
   * Rejections name the specific policy rule that blocked the path and link to
   * the configuration documentation rather than naming individual settings.
   * Filesystem paths — configured or resolved — stay out of the thrown message
   * because it reaches MCP clients and the web UI; they are logged instead,
   * where only the operator sees them. Root tokens such as `$DOCUMENTS` are
   * named in the message: they are runtime state rather than host detail, and
   * warn-level logs are suppressed on the non-interactive runs where an
   * unresolvable token is most likely.
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
      throw new AccessPolicyError(
        `Local file access is disabled by the scraper security policy, so ${url} cannot be indexed. ` +
          `See ${FILE_ACCESS_DOCS} to configure local file access.`,
      );
    }

    if (this.security.fileAccess.mode === "allowedRoots" && !matchedBypassRoot) {
      const configuredRoots = await this.expandRoots(
        this.security.fileAccess.allowedRoots,
        true,
      );
      if (configuredRoots.length === 0) {
        this.warnUnavailableAllowlist();
        throw new AccessPolicyError(
          `Local file access is limited to configured roots, but ${describeUnavailableRoots(
            this.security.fileAccess.allowedRoots,
          )}, so ${url} cannot be indexed. ` +
            `See ${FILE_ACCESS_DOCS} to configure the allowed roots.`,
        );
      }

      matchedRoot = await this.findContainingRoot(
        accessPath,
        configuredRoots,
        this.security.fileAccess.followSymlinks,
      );
      if (!matchedRoot) {
        this.logConfiguredRoots(configuredRoots);
        throw new AccessPolicyError(
          `${url} is outside the configured allowed roots, so it cannot be indexed. ` +
            `See ${FILE_ACCESS_DOCS} to allow this folder.`,
        );
      }
    }

    if (!this.security.fileAccess.followSymlinks && !matchedBypassRoot) {
      const symlinkPath = await findSymlinkInPath(accessPath);
      if (symlinkPath) {
        throw new AccessPolicyError(
          `${url} resolves through a symlink, which the security policy blocks by default, so it cannot be indexed. ` +
            `See ${FILE_ACCESS_DOCS} to allow symlinked paths.`,
        );
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
          `${url} contains a hidden path segment (a name starting with "."), which the security policy blocks by default, ` +
            `so it cannot be indexed. See ${FILE_ACCESS_DOCS} to allow hidden files and folders.`,
        );
      }
      if (
        resolved.virtualArchivePath &&
        hasHiddenArchiveSegment(resolved.virtualArchivePath)
      ) {
        throw new AccessPolicyError(
          `The archive entry requested by ${url} is hidden (a name starting with "."), which the security policy blocks by default. ` +
            `See ${FILE_ACCESS_DOCS} to allow hidden archive entries.`,
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

  /**
   * Expands configured root entries into concrete paths, dropping those that do
   * not resolve on this system. With `warnOnUnresolved`, every dropped entry is
   * reported once — silently discarding them makes `allowedRoots` look active
   * when it grants nothing.
   */
  private async expandRoots(
    roots: string[],
    warnOnUnresolved = false,
  ): Promise<string[]> {
    const expanded: string[] = [];
    for (const root of roots) {
      const value = await expandConfiguredRoot(root);
      if (value) {
        expanded.push(value);
        continue;
      }
      if (warnOnUnresolved && !this.warnedUnresolvedRoots.has(root)) {
        this.warnedUnresolvedRoots.add(root);
        logger.warn(
          `⚠️  Ignoring allowed file root "${root}": it does not resolve to an existing directory on this system.`,
        );
      }
    }
    return expanded;
  }

  /**
   * Warns that `allowedRoots` mode is active but grants nothing, which blocks
   * all local file access. Emitted once per policy instance.
   */
  private warnUnavailableAllowlist(): void {
    if (this.hasWarnedUnavailableAllowlist) return;
    this.hasWarnedUnavailableAllowlist = true;

    // Operator-facing log: naming the configured entries is safe here and is
    // the fastest way to see why the allowlist came up empty.
    const configured = this.security.fileAccess.allowedRoots;
    const cause =
      configured.length === 0
        ? "no roots are configured"
        : `none of the configured roots (${configured.join(", ")}) exist on this system`;
    logger.warn(
      `⚠️  Local file access is limited to configured roots, but ${cause}, so all file:// indexing is blocked. ` +
        `See ${FILE_ACCESS_DOCS} to configure the allowed roots.`,
    );
  }

  /**
   * Logs the roots that local file access is limited to. Emitted once per policy
   * instance, alongside the first out-of-root rejection.
   */
  private logConfiguredRoots(roots: string[]): void {
    if (this.hasLoggedConfiguredRoots) return;
    this.hasLoggedConfiguredRoots = true;

    logger.warn(`⚠️  Local file access is limited to: ${roots.join(", ")}`);
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

const ROOT_TOKENS = new Set(["$HOME", "$CWD", ...Object.keys(USER_DIR_TOKENS)]);

/**
 * Describes why an `allowedRoots` allowlist grants no access, for an error that
 * also reaches MCP clients and the web UI.
 *
 * Configured tokens are named because they are fixed vocabulary that says
 * nothing about the host. Literal paths are only counted: even a path that does
 * not exist reveals the layout an operator intended, so `/mnt/acme-secrets/docs`
 * must not travel back to a caller.
 *
 * Today `expandConfiguredRoot` resolves literal paths unconditionally, so only
 * tokens reach this function and the count stays at zero. The branch guards the
 * day that changes — validating literal roots must not start leaking them.
 */
function describeUnavailableRoots(configured: string[]): string {
  if (configured.length === 0) {
    return "no roots are configured";
  }

  const tokens = configured.filter((root) => ROOT_TOKENS.has(root));
  const literalCount = configured.length - tokens.length;
  const parts: string[] = [];
  if (tokens.length > 0) {
    parts.push(`${tokens.join(", ")} did not resolve`);
  }
  if (literalCount > 0) {
    parts.push(`${literalCount} configured path(s) do not exist`);
  }
  return `none of its entries are available on this system (${parts.join("; ")})`;
}

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
