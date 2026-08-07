import fs from "node:fs/promises";
import path from "node:path";
import ignore from "ignore";

type IgnoreMatcher = ReturnType<typeof ignore>;

interface IgnoreContext {
  matcher: IgnoreMatcher;
  blocked: boolean;
}

interface GitignoreFilterOptions {
  ignoreCase?: boolean;
}

interface LoadedPatterns {
  patterns: string | readonly string[];
  ignoreCase: boolean;
}

const GITIGNORE_SPECIAL_CHARACTERS = new Set(["\\", "*", "?", "[", "]", "!", "#"]);

/** Repository metadata directory, which Git never walks and never lets a pattern re-include. */
const GIT_DIRECTORY = ".git";

function createMatcher(ignoreCase: boolean): IgnoreMatcher {
  return ignore({ ignorecase: ignoreCase });
}

/**
 * Matches paths against `.gitignore` files from a local crawl root down to the
 * candidate path. Each directory keeps its own pattern base and overrides
 * ancestor decisions according to Git ignore ordering.
 */
export class GitignoreFilter {
  private readonly rootDirectory: string;
  private readonly ignoreCaseOverride: boolean | undefined;
  private readonly emptyContext: IgnoreContext;
  private readonly contextCache = new Map<string, Promise<IgnoreContext>>();

  constructor(rootDirectory: string, options: GitignoreFilterOptions = {}) {
    this.rootDirectory = path.resolve(rootDirectory);
    this.ignoreCaseOverride = options.ignoreCase;
    this.emptyContext = {
      matcher: createMatcher(options.ignoreCase ?? false),
      blocked: false,
    };
  }

  /**
   * Returns whether a path is ignored by the applicable `.gitignore` cascade.
   *
   * Repository metadata (`.git` and everything under it) is always ignored:
   * Git excludes it from traversal unconditionally, and no pattern — not even
   * a negation — can bring it back.
   * @param targetPath Absolute filesystem path to test.
   * @param isDirectory Whether the target is a directory.
   * @returns True when the path should be skipped.
   */
  async isIgnored(targetPath: string, isDirectory: boolean): Promise<boolean> {
    const resolvedTarget = path.resolve(targetPath);
    if (!this.isInsideRoot(resolvedTarget) || resolvedTarget === this.rootDirectory) {
      return false;
    }

    if (this.containsGitDirectory(resolvedTarget)) {
      return true;
    }

    const context = await this.getContext(path.dirname(resolvedTarget));
    if (context.blocked) {
      return true;
    }

    return this.matches(context.matcher, resolvedTarget, isDirectory);
  }

  private getContext(directory: string): Promise<IgnoreContext> {
    const resolvedDirectory = path.resolve(directory);
    const cached = this.contextCache.get(resolvedDirectory);
    if (cached) {
      return cached;
    }

    const contextPromise = this.buildContext(resolvedDirectory);
    this.contextCache.set(resolvedDirectory, contextPromise);
    return contextPromise;
  }

  private async buildContext(directory: string): Promise<IgnoreContext> {
    if (!this.isInsideRoot(directory)) {
      return this.emptyContext;
    }

    if (directory === this.rootDirectory) {
      return {
        matcher: await this.appendMatcher(this.emptyContext.matcher, directory),
        blocked: false,
      };
    }

    const parentContext = await this.getContext(path.dirname(directory));
    if (parentContext.blocked || this.matches(parentContext.matcher, directory, true)) {
      return { matcher: parentContext.matcher, blocked: true };
    }

    return {
      matcher: await this.appendMatcher(parentContext.matcher, directory),
      blocked: false,
    };
  }

  private async appendMatcher(
    parentMatcher: IgnoreMatcher,
    directory: string,
  ): Promise<IgnoreMatcher> {
    const loaded = await this.loadPatterns(directory);
    return loaded
      ? createMatcher(loaded.ignoreCase).add(parentMatcher).add(loaded.patterns)
      : parentMatcher;
  }

  private async loadPatterns(directory: string): Promise<LoadedPatterns | null> {
    const ignorePath = path.join(directory, ".gitignore");
    let stats: Awaited<ReturnType<typeof fs.lstat>>;

    try {
      stats = await fs.lstat(ignorePath);
    } catch (error) {
      if (isMissingPathError(error)) {
        return null;
      }
      throw error;
    }

    if (!stats.isFile() || stats.isSymbolicLink()) {
      return null;
    }

    try {
      const patterns = (await fs.readFile(ignorePath, "utf8"))
        .replace(/^\uFEFF/, "")
        .split(/\r?\n/)
        .map(preserveLeadingBom)
        .map(normalizeTrailingWhitespace)
        .map(preserveTrailingNonSpaceWhitespace)
        .map(normalizeTrailingDirectoryGlobstar);
      const relativeDirectory = path.relative(this.rootDirectory, directory);
      if (!relativeDirectory) {
        return {
          patterns: patterns.map(normalizeRootAnchoredGlobstar),
          ignoreCase: await this.resolveIgnoreCase(ignorePath, stats),
        };
      }

      const normalizedDirectory = relativeDirectory.split(path.sep).join("/");
      return {
        patterns: patterns.map((pattern) =>
          scopePatternToRoot(pattern, normalizedDirectory),
        ),
        ignoreCase: await this.resolveIgnoreCase(ignorePath, stats),
      };
    } catch (error) {
      if (isMissingPathError(error)) {
        return null;
      }
      throw error;
    }
  }

  private async resolveIgnoreCase(
    ignorePath: string,
    stats: Awaited<ReturnType<typeof fs.lstat>>,
  ): Promise<boolean> {
    if (this.ignoreCaseOverride !== undefined) {
      return this.ignoreCaseOverride;
    }

    const alternatePath = path.join(path.dirname(ignorePath), ".GITIGNORE");
    try {
      const alternateStats = await fs.lstat(alternatePath);
      return alternateStats.dev === stats.dev && alternateStats.ino === stats.ino;
    } catch (error) {
      if (isMissingPathError(error)) {
        return false;
      }
      throw error;
    }
  }

  private matches(
    matcher: IgnoreMatcher,
    targetPath: string,
    isDirectory: boolean,
  ): boolean {
    const relativePath = path.relative(this.rootDirectory, targetPath);
    if (!relativePath || isOutsideDirectory(relativePath)) {
      return false;
    }

    const normalizedPath = relativePath.split(path.sep).join("/");
    const candidate = isDirectory ? `${normalizedPath}/` : normalizedPath;
    return matcher.test(candidate).ignored;
  }

  private isInsideRoot(targetPath: string): boolean {
    const relativePath = path.relative(this.rootDirectory, targetPath);
    return relativePath === "" || !isOutsideDirectory(relativePath);
  }

  /**
   * Whether the path is, or lives under, a `.git` directory below the root.
   *
   * Matched case-insensitively: on a case-insensitive volume `.GIT` *is* the
   * metadata directory, and Git guards that spelling itself rather than
   * consulting `core.ignoreCase`. Git rejects further variants too (`git~1`,
   * `.git.`, and other filesystem-specific spellings); this covers only the
   * case dimension, which is the one a crawl realistically meets. On a
   * case-sensitive volume it can skip an unrelated directory named `.GIT`, a
   * far cheaper mistake than indexing a repository's internals.
   */
  private containsGitDirectory(targetPath: string): boolean {
    return path
      .relative(this.rootDirectory, targetPath)
      .split(path.sep)
      .some((segment) => segment.toLowerCase() === GIT_DIRECTORY);
  }
}

/**
 * Finds the Git repository root containing `directory`, looking only at
 * *ancestor* directories.
 *
 * Used to warn that a crawl rooted below a repository root cannot see that
 * repository's ignore rules. Probes for the existence of `.git` (a directory
 * in a normal clone, a file in a worktree or submodule) and never reads
 * anything, so it stays within what the access policy allows for a path the
 * crawl will not touch.
 * @param directory Absolute path of the crawl root.
 * @returns The repository root above `directory`, or null when there is none.
 */
export async function findRepositoryRootAbove(directory: string): Promise<string | null> {
  let current = path.dirname(path.resolve(directory));

  while (true) {
    try {
      await fs.lstat(path.join(current, GIT_DIRECTORY));
      return current;
    } catch {
      // Absent, or an ancestor we may not read. Either way keep walking: a
      // repository root can still sit above it, and a diagnostic must never
      // fail the crawl.
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function scopePatternToRoot(pattern: string, baseDirectory: string): string {
  const normalizedPattern = pattern;
  if (
    !normalizedPattern ||
    normalizedPattern.trim().length === 0 ||
    normalizedPattern.startsWith("#")
  ) {
    return normalizedPattern;
  }

  const negative = normalizedPattern.startsWith("!");
  const body = negative ? normalizedPattern.slice(1) : normalizedPattern;
  if (!body || body.trim().length === 0) {
    return normalizedPattern;
  }

  let significantEnd = body.length - 1;
  while (significantEnd >= 0 && body[significantEnd] === " ") {
    significantEnd--;
  }

  const significantBody = body.slice(0, significantEnd + 1);
  if (!significantBody || significantBody === "/") {
    return normalizedPattern;
  }

  const escapedBase = escapeGitignorePath(baseDirectory);
  const marker = negative ? "!" : "";
  if (body.startsWith("/")) {
    return `${marker}${escapedBase}/${body.slice(1)}`;
  }

  const pathBody = significantBody.endsWith("/")
    ? significantBody.slice(0, -1)
    : significantBody;
  const separator = pathBody.includes("/") ? "/" : "/**/";
  return `${marker}${escapedBase}${separator}${body}`;
}

function preserveLeadingBom(pattern: string): string {
  return pattern.startsWith("\uFEFF") ? `[\uFEFF]${pattern.slice(1)}` : pattern;
}

function normalizeTrailingWhitespace(pattern: string): string {
  let end = pattern.length;
  while (end > 0 && pattern[end - 1] === " ") {
    let precedingBackslashes = 0;
    for (let index = end - 2; index >= 0 && pattern[index] === "\\"; index--) {
      precedingBackslashes++;
    }

    if (precedingBackslashes % 2 === 1) {
      break;
    }
    end--;
  }

  return pattern.slice(0, end);
}

function preserveTrailingNonSpaceWhitespace(pattern: string): string {
  let start = pattern.length;
  while (start > 0 && pattern[start - 1] !== " " && /\s/u.test(pattern[start - 1])) {
    start--;
  }

  if (start === pattern.length) {
    return pattern;
  }

  let precedingBackslashes = 0;
  for (let index = start - 1; index >= 0 && pattern[index] === "\\"; index--) {
    precedingBackslashes++;
  }
  const prefixEnd = precedingBackslashes % 2 === 1 ? start - 1 : start;
  const literalWhitespace = Array.from(
    pattern.slice(start),
    (character) => `[${character}]`,
  ).join("");
  return `${pattern.slice(0, prefixEnd)}${literalWhitespace}`;
}

function normalizeTrailingDirectoryGlobstar(pattern: string): string {
  if (!pattern || pattern.startsWith("#")) {
    return pattern;
  }

  const negative = pattern.startsWith("!");
  const marker = negative ? "!" : "";
  const body = negative ? pattern.slice(1) : pattern;
  let significantEnd = body.length - 1;
  while (significantEnd >= 0 && body[significantEnd] === " ") {
    significantEnd--;
  }

  const significantBody = body.slice(0, significantEnd + 1);
  const normalizedBody = significantBody.replace(/(^|\/)(?:\*\*\/)+$/, "$1*/**/");
  if (normalizedBody === significantBody) {
    return pattern;
  }

  return `${marker}${normalizedBody}${body.slice(significantBody.length)}`;
}

function normalizeRootAnchoredGlobstar(pattern: string): string {
  const negative = pattern.startsWith("!");
  const marker = negative ? "!" : "";
  const body = negative ? pattern.slice(1) : pattern;
  return body === "/**" ? `${marker}**` : pattern;
}

function escapeGitignorePath(relativePath: string): string {
  return Array.from(relativePath, (character) =>
    GITIGNORE_SPECIAL_CHARACTERS.has(character) ? `\\${character}` : character,
  ).join("");
}

function isMissingPathError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ENOTDIR";
}

function isOutsideDirectory(relativePath: string): boolean {
  return (
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  );
}
