import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GitignoreFilter } from "./gitignore";

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
});
