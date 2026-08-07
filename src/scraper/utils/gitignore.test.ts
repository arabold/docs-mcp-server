import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { findRepositoryRootAbove, GitignoreFilter } from "./gitignore";

describe("GitignoreFilter", () => {
  let rootDirectory: string;

  beforeEach(async () => {
    rootDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "docs-mcp-gitignore-"));
  });

  afterEach(async () => {
    await fs.rm(rootDirectory, { recursive: true, force: true });
  });

  async function write(relativePath: string, content: string): Promise<void> {
    const filePath = path.join(rootDirectory, relativePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content);
  }

  it("matches files and directories while pruning ignored parents", async () => {
    await write(".gitignore", "ignored.md\nbuild/\nartifact.md/\n");
    await write(path.join("build", ".gitignore"), "!keep.md\n");

    const filter = new GitignoreFilter(rootDirectory);

    await expect(
      filter.isIgnored(path.join(rootDirectory, "ignored.md"), false),
    ).resolves.toBe(true);
    await expect(filter.isIgnored(path.join(rootDirectory, "build"), true)).resolves.toBe(
      true,
    );
    await expect(
      filter.isIgnored(path.join(rootDirectory, "build", "keep.md"), false),
    ).resolves.toBe(true);
    await expect(
      filter.isIgnored(path.join(rootDirectory, "artifact.md"), false),
    ).resolves.toBe(false);
    await expect(
      filter.isIgnored(path.join(rootDirectory, "nested", "artifact.md"), true),
    ).resolves.toBe(true);
  });

  it("applies nested negation and anchored patterns from their own directory", async () => {
    await write(".gitignore", "*.generated.md\n");
    await write(path.join("nested", ".gitignore"), "!keep.generated.md\n/only-here.md\n");

    const filter = new GitignoreFilter(rootDirectory);

    await expect(
      filter.isIgnored(path.join(rootDirectory, "nested", "drop.generated.md"), false),
    ).resolves.toBe(true);
    await expect(
      filter.isIgnored(path.join(rootDirectory, "nested", "keep.generated.md"), false),
    ).resolves.toBe(false);
    await expect(
      filter.isIgnored(path.join(rootDirectory, "nested", "only-here.md"), false),
    ).resolves.toBe(true);
    await expect(
      filter.isIgnored(
        path.join(rootDirectory, "nested", "deeper", "only-here.md"),
        false,
      ),
    ).resolves.toBe(false);
  });

  it("propagates a nested directory negation to descendants", async () => {
    await write(".gitignore", "nested/reincluded/\n");
    await write(path.join("nested", ".gitignore"), "!reincluded/\n");

    const filter = new GitignoreFilter(rootDirectory);

    await expect(
      filter.isIgnored(path.join(rootDirectory, "nested", "reincluded"), true),
    ).resolves.toBe(false);
    await expect(
      filter.isIgnored(
        path.join(rootDirectory, "nested", "reincluded", "keep.md"),
        false,
      ),
    ).resolves.toBe(false);
  });

  it("supports case-sensitive matching so differently cased negations do not leak files", async () => {
    await write(".gitignore", "*.env\n!PUBLIC.env\n");
    const filter = new GitignoreFilter(rootDirectory, { ignoreCase: false });

    await expect(
      filter.isIgnored(path.join(rootDirectory, "public.env"), false),
    ).resolves.toBe(true);
    await expect(
      filter.isIgnored(path.join(rootDirectory, "PUBLIC.env"), false),
    ).resolves.toBe(false);
  });

  it("supports case-insensitive matching for case-insensitive filesystems", async () => {
    await write(".gitignore", "secrets/\n");
    const filter = new GitignoreFilter(rootDirectory, { ignoreCase: true });

    await expect(
      filter.isIgnored(path.join(rootDirectory, "Secrets"), true),
    ).resolves.toBe(true);
    await expect(
      filter.isIgnored(path.join(rootDirectory, "Secrets", "key.md"), false),
    ).resolves.toBe(true);
  });

  it("applies case-insensitive matching to negations", async () => {
    await write(".gitignore", "*.env\n!PUBLIC.env\n");
    const filter = new GitignoreFilter(rootDirectory, { ignoreCase: true });

    await expect(
      filter.isIgnored(path.join(rootDirectory, "public.env"), false),
    ).resolves.toBe(false);
  });

  it("applies the selected casing behavior to nested rules", async () => {
    await write(path.join("nested", ".gitignore"), "generated/\n");
    const filter = new GitignoreFilter(rootDirectory, { ignoreCase: true });

    await expect(
      filter.isIgnored(path.join(rootDirectory, "nested", "Generated"), true),
    ).resolves.toBe(true);
  });

  it("detects the filesystem casing behavior by default", async () => {
    await write(".gitignore", "secrets/\n");
    const ignoreStats = await fs.lstat(path.join(rootDirectory, ".gitignore"));
    let alternateStats: Awaited<ReturnType<typeof fs.lstat>> | null = null;
    try {
      alternateStats = await fs.lstat(path.join(rootDirectory, ".GITIGNORE"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
    const filesystemIgnoresCase =
      alternateStats !== null &&
      alternateStats.dev === ignoreStats.dev &&
      alternateStats.ino === ignoreStats.ino;
    const filter = new GitignoreFilter(rootDirectory);

    await expect(
      filter.isIgnored(path.join(rootDirectory, "Secrets"), true),
    ).resolves.toBe(filesystemIgnoresCase);
  });

  it.each(["**/", "/**/", "**/**/"])(
    "keeps nested direct files for scoped directory globstar %s",
    async (pattern) => {
      await write(path.join("nested", ".gitignore"), `${pattern}\n`);
      const filter = new GitignoreFilter(rootDirectory);

      await expect(
        filter.isIgnored(path.join(rootDirectory, "nested", "direct.txt"), false),
      ).resolves.toBe(false);
      await expect(
        filter.isIgnored(path.join(rootDirectory, "nested", "subdirectory"), true),
      ).resolves.toBe(true);
      await expect(
        filter.isIgnored(
          path.join(rootDirectory, "nested", "subdirectory", "ignored.txt"),
          false,
        ),
      ).resolves.toBe(true);
    },
  );

  it.each(["!**/", "!/**/"])(
    "scopes directory globstar negation %s when recursively re-including",
    async (pattern) => {
      await write(path.join("nested", ".gitignore"), `*\n${pattern}\n!*.md\n`);
      const filter = new GitignoreFilter(rootDirectory);

      await expect(
        filter.isIgnored(path.join(rootDirectory, "nested", "direct.md"), false),
      ).resolves.toBe(false);
      await expect(
        filter.isIgnored(path.join(rootDirectory, "nested", "subdirectory"), true),
      ).resolves.toBe(false);
      await expect(
        filter.isIgnored(
          path.join(rootDirectory, "nested", "subdirectory", "deep.md"),
          false,
        ),
      ).resolves.toBe(false);
      await expect(
        filter.isIgnored(
          path.join(rootDirectory, "nested", "subdirectory", "deep.txt"),
          false,
        ),
      ).resolves.toBe(true);
    },
  );

  it.each(["foo/**/", "/foo/**/", "foo/**/**/"])(
    "requires a descendant directory for trailing globstar pattern %s",
    async (pattern) => {
      await write(path.join("nested", ".gitignore"), `${pattern}\n`);
      const filter = new GitignoreFilter(rootDirectory);

      await expect(
        filter.isIgnored(path.join(rootDirectory, "nested", "foo", "direct.txt"), false),
      ).resolves.toBe(false);
      await expect(
        filter.isIgnored(path.join(rootDirectory, "nested", "foo", "subdirectory"), true),
      ).resolves.toBe(true);
    },
  );

  it("does not let a trailing globstar negation reopen an ignored parent", async () => {
    await write(".gitignore", "foo/\n!foo/**/\n");
    const filter = new GitignoreFilter(rootDirectory);

    await expect(filter.isIgnored(path.join(rootDirectory, "foo"), true)).resolves.toBe(
      true,
    );
    await expect(
      filter.isIgnored(path.join(rootDirectory, "foo", "direct.env"), false),
    ).resolves.toBe(true);
    await expect(
      filter.isIgnored(
        path.join(rootDirectory, "foo", "subdirectory", "secret.env"),
        false,
      ),
    ).resolves.toBe(true);
  });

  it("applies a root-anchored globstar negation to all descendants", async () => {
    await write(".gitignore", "*\n!/**\n");
    const filter = new GitignoreFilter(rootDirectory);

    await expect(
      filter.isIgnored(path.join(rootDirectory, "direct.txt"), false),
    ).resolves.toBe(false);
    await expect(
      filter.isIgnored(path.join(rootDirectory, "directory"), true),
    ).resolves.toBe(false);
    await expect(
      filter.isIgnored(path.join(rootDirectory, "directory", "deep.txt"), false),
    ).resolves.toBe(false);
    await expect(
      filter.isIgnored(
        path.join(rootDirectory, "directory", "deeper", "nested.txt"),
        false,
      ),
    ).resolves.toBe(false);
  });

  it("removes unescaped trailing whitespace before matching root rules", async () => {
    await write(".gitignore", "secrets/   \n");
    const filter = new GitignoreFilter(rootDirectory);

    await expect(
      filter.isIgnored(path.join(rootDirectory, "subdirectory", "secrets"), true),
    ).resolves.toBe(true);
    await expect(
      filter.isIgnored(
        path.join(rootDirectory, "subdirectory", "secrets", "key.env"),
        false,
      ),
    ).resolves.toBe(true);
  });

  it("preserves escaped trailing whitespace as a literal character", async () => {
    await write(".gitignore", "literal\\ \n");
    const filter = new GitignoreFilter(rootDirectory);

    await expect(
      filter.isIgnored(path.join(rootDirectory, "literal "), false),
    ).resolves.toBe(true);
    await expect(
      filter.isIgnored(path.join(rootDirectory, "literal"), false),
    ).resolves.toBe(false);
  });

  it("preserves trailing non-space whitespace as literal pattern content", async () => {
    await write(".gitignore", "*.env\n!PUBLIC.env\t\n!SECOND.env\u00A0\nliteral\t\n");
    const filter = new GitignoreFilter(rootDirectory, { ignoreCase: false });

    await expect(
      filter.isIgnored(path.join(rootDirectory, "PUBLIC.env"), false),
    ).resolves.toBe(true);
    await expect(
      filter.isIgnored(path.join(rootDirectory, "SECOND.env"), false),
    ).resolves.toBe(true);
    await expect(
      filter.isIgnored(path.join(rootDirectory, "literal\t"), false),
    ).resolves.toBe(true);
    await expect(
      filter.isIgnored(path.join(rootDirectory, "literal"), false),
    ).resolves.toBe(false);
  });

  it("only removes a BOM at the start of a .gitignore file", async () => {
    await write(".gitignore", "\uFEFFroot.md\n*.env\n\uFEFF!PUBLIC.env\n");
    await write(path.join("nested", ".gitignore"), "*.key\n\uFEFF!PUBLIC.key\n");
    const filter = new GitignoreFilter(rootDirectory, { ignoreCase: false });

    await expect(
      filter.isIgnored(path.join(rootDirectory, "root.md"), false),
    ).resolves.toBe(true);
    await expect(
      filter.isIgnored(path.join(rootDirectory, "PUBLIC.env"), false),
    ).resolves.toBe(true);
    await expect(
      filter.isIgnored(path.join(rootDirectory, "nested", "PUBLIC.key"), false),
    ).resolves.toBe(true);
  });

  it("scopes nested rules when directory names contain pattern characters", async () => {
    await write(path.join("docs[1]", ".gitignore"), "ignored.md\n");
    const filter = new GitignoreFilter(rootDirectory);

    await expect(
      filter.isIgnored(path.join(rootDirectory, "docs[1]", "ignored.md"), false),
    ).resolves.toBe(true);
    await expect(
      filter.isIgnored(path.join(rootDirectory, "docs1", "ignored.md"), false),
    ).resolves.toBe(false);
  });

  it("does not apply rules outside the crawl root", async () => {
    await write(".gitignore", "*.md\n");
    const filter = new GitignoreFilter(rootDirectory);

    await expect(
      filter.isIgnored(path.join(path.dirname(rootDirectory), "outside.md"), false),
    ).resolves.toBe(false);
  });

  it("always ignores repository metadata, even against a re-including rule", async () => {
    await write(".gitignore", "!.git\n!.git/**\n");
    const filter = new GitignoreFilter(rootDirectory);

    await expect(filter.isIgnored(path.join(rootDirectory, ".git"), true)).resolves.toBe(
      true,
    );
    await expect(
      filter.isIgnored(path.join(rootDirectory, ".git", "config"), false),
    ).resolves.toBe(true);
    await expect(
      filter.isIgnored(path.join(rootDirectory, "nested", ".git", "HEAD"), false),
    ).resolves.toBe(true);
  });

  it("treats alternate spellings of the metadata directory as metadata", async () => {
    const filter = new GitignoreFilter(rootDirectory);

    await expect(
      filter.isIgnored(path.join(rootDirectory, ".GIT", "config"), false),
    ).resolves.toBe(true);
    await expect(
      filter.isIgnored(path.join(rootDirectory, ".Git", "HEAD"), false),
    ).resolves.toBe(true);
  });

  it("does not confuse repository metadata with similarly named paths", async () => {
    const filter = new GitignoreFilter(rootDirectory);

    await expect(
      filter.isIgnored(path.join(rootDirectory, ".github", "workflow.md"), false),
    ).resolves.toBe(false);
    await expect(
      filter.isIgnored(path.join(rootDirectory, "not.git", "notes.md"), false),
    ).resolves.toBe(false);
  });
});

describe("findRepositoryRootAbove", () => {
  let rootDirectory: string;

  beforeEach(async () => {
    rootDirectory = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), "docs-mcp-repo-root-")),
    );
  });

  afterEach(async () => {
    await fs.rm(rootDirectory, { recursive: true, force: true });
  });

  it("finds a repository root above the given directory", async () => {
    await fs.mkdir(path.join(rootDirectory, ".git"));
    const nested = path.join(rootDirectory, "docs", "guides");
    await fs.mkdir(nested, { recursive: true });

    await expect(findRepositoryRootAbove(nested)).resolves.toBe(rootDirectory);
  });

  it("detects a worktree or submodule, where .git is a file", async () => {
    await fs.writeFile(path.join(rootDirectory, ".git"), "gitdir: /elsewhere\n");
    const nested = path.join(rootDirectory, "docs");
    await fs.mkdir(nested);

    await expect(findRepositoryRootAbove(nested)).resolves.toBe(rootDirectory);
  });

  it("ignores a repository rooted at the directory itself", async () => {
    await fs.mkdir(path.join(rootDirectory, ".git"));

    await expect(findRepositoryRootAbove(rootDirectory)).resolves.toBeNull();
  });
});

/**
 * Differential coverage: builds throwaway repositories, walks them the way
 * `LocalFileStrategy` does (prune ignored directories, skip ignored files),
 * and compares the resulting file set against what Git itself reports via
 * `git ls-files --others --exclude-standard`.
 *
 * `git check-ignore` is deliberately not the oracle. It answers a subtly
 * different question: for a `dir/**` pattern it reports the trailing-slash
 * directory form as ignored, which would over-prune directories whose direct
 * children Git still lists. Comparing the visible *file set* is the property
 * the crawler actually needs.
 *
 * Skips when no `git` binary is available.
 */
const exec = promisify(execFile);

interface Scenario {
  name: string;
  /** Relative `.gitignore` path -> file contents. */
  ignores: Record<string, string>;
  /** Relative paths to create, with parent directories implied. */
  files: string[];
}

const SCENARIOS: Scenario[] = [
  {
    name: "typical project ignores",
    ignores: {
      ".gitignore":
        "node_modules/\n*.log\ndist\nbuild/\n!important.log\n/root-only.txt\n.env*\n!.env.example\n",
    },
    files: [
      "important.log",
      "debug.log",
      "root-only.txt",
      "sub/root-only.txt",
      "sub/debug.log",
      "sub/important.log",
      ".env",
      ".env.example",
      "dist/a.js",
      "sub/dist/a.js",
      "build/x.md",
      "node_modules/pkg/index.js",
      "keep.md",
    ],
  },
  {
    name: "an excluded directory cannot be re-included from within",
    ignores: { ".gitignore": "build/\n!build/keep.md\n" },
    files: ["build/keep.md", "build/drop.md", "keep.md"],
  },
  {
    name: "nested rules, negation and anchoring",
    ignores: {
      ".gitignore": "*.generated.md\ntmp\n",
      "nested/.gitignore": "!keep.generated.md\n/only-here.md\n!tmp\n",
    },
    files: [
      "nested/drop.generated.md",
      "nested/keep.generated.md",
      "nested/only-here.md",
      "nested/deeper/only-here.md",
      "nested/deeper/keep.generated.md",
      "nested/tmp/a.md",
      "tmp/a.md",
    ],
  },
  {
    name: "globstar forms",
    ignores: { ".gitignore": "docs/**/tmp\n**/temp\na/**\n!a/b/\nlogs/**/\n" },
    files: [
      "docs/tmp/x.md",
      "docs/x/tmp/y.md",
      "temp/x.md",
      "x/temp/y.md",
      "a/f.md",
      "a/b/f.md",
      "a/b/c/f.md",
      "logs/x.md",
      "logs/d/x.md",
    ],
  },
  {
    name: "trailing globstar with re-inclusion",
    ignores: { ".gitignore": "secret/**\n!secret/public/\n!secret/public/**\n" },
    files: ["secret/a.md", "secret/public/b.md", "secret/public/deep/c.md"],
  },
  {
    name: "nested rules in a directory whose name contains pattern characters",
    ignores: {
      ".gitignore": "*.md\n",
      "we[i]rd*dir/.gitignore": "!keep.md\nlocal.txt\n",
    },
    files: [
      "we[i]rd*dir/keep.md",
      "we[i]rd*dir/drop.md",
      "we[i]rd*dir/local.txt",
      "other/keep.md",
    ],
  },
  {
    name: "directory-only and bare directory names",
    ignores: { ".gitignore": "artifact.md/\ncache\n" },
    files: ["artifact.md", "nested/artifact.md/inner.txt", "cache/x", "nested/cache/x"],
  },
  {
    name: "escaped and trailing-whitespace patterns",
    ignores: {
      ".gitignore": "with\\ space.md\ntrail   \nkeep\\   \n\\#hash.md\n\\!bang.md\n",
    },
    files: ["with space.md", "trail", "keep   ", "#hash.md", "!bang.md", "other.md"],
  },
  {
    name: "a nested rule re-includes a directory its parent excluded",
    ignores: {
      ".gitignore": "nested/reincluded/\n",
      "nested/.gitignore": "!reincluded/\n",
    },
    files: ["nested/reincluded/keep.md", "nested/other.md"],
  },
  {
    name: "mid-path slash anchors a nested rule",
    ignores: { "sub/.gitignore": "a/b\nc/\n!c/d\n" },
    files: ["sub/a/b", "sub/x/a/b", "sub/c/d", "a/b"],
  },
  {
    name: "three-level cascade",
    ignores: {
      ".gitignore": "*.txt\n",
      "one/.gitignore": "!*.txt\n*.md\n",
      "one/two/.gitignore": "!*.md\n**/deep.txt\n",
    },
    files: [
      "root.txt",
      "one/a.txt",
      "one/a.md",
      "one/two/b.txt",
      "one/two/b.md",
      "one/two/three/deep.txt",
      "one/two/three/b.md",
    ],
  },
  {
    name: "comments, blank lines and CRLF endings",
    ignores: { ".gitignore": "# comment\r\n\r\n*.bak\r\n!keep.bak\r\n" },
    files: ["a.bak", "keep.bak", "a.md"],
  },
  {
    name: "repository metadata is excluded by both",
    ignores: { ".gitignore": "!.git\n!.git/**\n" },
    files: ["keep.md", "nested/keep.md"],
  },
];

// A deterministic corpus: the pattern rewriting in `gitignore.ts` is where
// divergence from Git hides, so combinations matter more than any single case.
const PATTERN_POOL = [
  "*.md",
  "*.txt",
  "!keep.md",
  "build",
  "build/",
  "/build",
  "dist/**",
  "**/tmp",
  "a/b",
  "a/**/c",
  "!a/b/",
  "*.lo?",
  "[abc].md",
  "sub/*.md",
  "!sub/keep.md",
  "node_modules/",
  "*",
  "!*.keep",
  "deep/**/",
  "!/root.md",
  "**/*.md",
  "a/*/c",
  "!build/",
  "sub/**/*.txt",
  "dist",
  "!dist/keep.md",
  "*.[lt]??",
  "deep/x/",
  "!**/keep.md",
  "/a",
  "a/",
  "**",
  "!*.md",
];
const NAME_POOL = ["keep.md", "drop.md", "a.txt", "b.log", "c.keep", "root.md"];
const DIR_POOL = ["build", "dist", "sub", "a", "a/b", "a/b/c", "tmp", "deep", "deep/x"];
const NESTED_IGNORE_DIRS = ["sub", "a", "a/b", "deep"];
const RANDOM_SCENARIO_COUNT = 200;

/** Deterministic LCG, so a failure reproduces from its seed alone. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function randomScenario(seed: number): Scenario {
  const random = makeRandom(seed);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)];

  const ignores: Record<string, string> = {
    ".gitignore": `${Array.from({ length: 1 + Math.floor(random() * 5) }, () => pick(PATTERN_POOL)).join("\n")}\n`,
  };
  if (random() < 0.6) {
    const directory = pick(NESTED_IGNORE_DIRS);
    ignores[`${directory}/.gitignore`] =
      `${Array.from({ length: 1 + Math.floor(random() * 3) }, () => pick(PATTERN_POOL)).join("\n")}\n`;
  }

  const files = new Set<string>();
  for (let index = 0; index < 12; index++) {
    const directory = random() < 0.25 ? "" : pick(DIR_POOL);
    files.add(directory ? `${directory}/${pick(NAME_POOL)}` : pick(NAME_POOL));
  }

  return { name: `seed-${seed}`, ignores, files: [...files] };
}

/**
 * Whether a `git` binary is available to compare against. Skipping keeps the
 * suite usable on a bare machine, but CI must never go green by omission —
 * these are the only tests that check the filter against the real thing.
 */
async function hasGit(): Promise<boolean> {
  try {
    await exec("git", ["--version"]);
    return true;
  } catch (error) {
    if (process.env.CI) {
      throw error;
    }
    return false;
  }
}

/**
 * The set of files Git considers visible (untracked and not ignored).
 *
 * `core.excludesFile` is pinned to nothing: `--exclude-standard` otherwise
 * honours the developer's global ignore file, so a machine with `*.log` in
 * `~/.config/git/ignore` would see Git hide files the filter shows and fail
 * the comparison for a reason that has nothing to do with this code.
 */
async function gitVisibleFiles(root: string): Promise<Set<string>> {
  const { stdout } = await exec(
    "git",
    [
      "-c",
      "core.excludesFile=/dev/null",
      "ls-files",
      "--others",
      "--exclude-standard",
      "-z",
    ],
    { cwd: root, maxBuffer: 32 * 1024 * 1024 },
  );
  return new Set(stdout.split("\0").filter(Boolean));
}

/** The set of files the crawler would reach, pruning ignored directories. */
async function filterVisibleFiles(root: string): Promise<Set<string>> {
  const filter = new GitignoreFilter(root, { ignoreCase: false });
  const visible = new Set<string>();

  async function walk(directory: string): Promise<void> {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      const isDirectory = entry.isDirectory();
      if (await filter.isIgnored(entryPath, isDirectory)) {
        continue;
      }
      if (isDirectory) {
        await walk(entryPath);
      } else {
        visible.add(path.relative(root, entryPath).split(path.sep).join("/"));
      }
    }
  }

  await walk(root);
  return visible;
}

/** Returns a human-readable list of divergences, empty when the two agree. */
async function divergences(scenario: Scenario, parent: string): Promise<string[]> {
  const root = await fs.realpath(await fs.mkdtemp(path.join(parent, "case-")));
  for (const file of scenario.files) {
    const full = path.join(root, file);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, "x");
  }
  for (const [relativePath, contents] of Object.entries(scenario.ignores)) {
    const full = path.join(root, relativePath);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, contents);
  }
  await exec("git", ["init", "-q"], { cwd: root });
  // The filter is pinned case-sensitive here, so Git must be too — otherwise
  // the comparison would fail on case-insensitive volumes for the wrong reason.
  await exec("git", ["config", "core.ignoreCase", "false"], { cwd: root });

  const expected = await gitVisibleFiles(root);
  const actual = await filterVisibleFiles(root);

  const problems: string[] = [];
  for (const file of expected) {
    if (!actual.has(file)) {
      problems.push(`git indexes but the filter hides: ${file}`);
    }
  }
  for (const file of actual) {
    if (!expected.has(file)) {
      problems.push(`git ignores but the filter shows: ${file}`);
    }
  }
  if (problems.length > 0) {
    problems.unshift(`rules: ${JSON.stringify(scenario.ignores)}`);
  }
  return problems;
}

describe("GitignoreFilter matches git", async () => {
  const gitAvailable = await hasGit();
  let workspace: string;

  beforeAll(async () => {
    workspace = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), "docs-mcp-gitignore-diff-")),
    );
  });

  afterAll(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });

  it.skipIf(!gitAvailable).each(SCENARIOS)("$name", async (scenario) => {
    expect(await divergences(scenario, workspace)).toEqual([]);
  });

  it.skipIf(!gitAvailable)(
    `agrees across ${RANDOM_SCENARIO_COUNT} generated rule combinations`,
    async () => {
      const failures: string[] = [];
      for (let seed = 1; seed <= RANDOM_SCENARIO_COUNT; seed++) {
        const scenario = randomScenario(seed);
        const problems = await divergences(scenario, workspace);
        if (problems.length > 0) {
          failures.push(`--- ${scenario.name} ---\n${problems.join("\n")}`);
        }
      }
      expect(failures.join("\n\n")).toEqual("");
    },
    120_000,
  );
});
