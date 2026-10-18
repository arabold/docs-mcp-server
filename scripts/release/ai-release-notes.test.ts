import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { generateNotes as generateConventionalNotes } from "@semantic-release/release-notes-generator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  buildReleaseSource,
  generateNotes,
  renderReleaseNotes,
} from "./ai-release-notes.mjs";

const SCRIPT = path.join(import.meta.dirname, "ai-release-notes.mjs");

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();
}

/** An agent command that reads the prompt from stdin, then runs `script`. */
function fakeAgent(script: string): string[] {
  return [
    process.execPath,
    "-e",
    `let prompt = ""; process.stdin.on("data", (chunk) => { prompt += chunk; }).on("end", () => { ${script} });`,
  ];
}

describe("ai-release-notes", () => {
  let workDir: string;
  let repo: string;

  beforeAll(() => {
    workDir = mkdtempSync(path.join(tmpdir(), "release-notes-test-"));
    repo = path.join(workDir, "repo");
    mkdirSync(repo);
    git(repo, "init", "-b", "main");
    git(repo, "config", "user.name", "Test");
    git(repo, "config", "user.email", "test@example.com");
    git(repo, "config", "commit.gpgsign", "false");
    git(repo, "config", "tag.gpgsign", "false");
    git(repo, "remote", "add", "origin", "git@github.com:owner/repo.git");
    git(repo, "commit", "--allow-empty", "-m", "chore: initial commit");
    git(repo, "tag", "v1.0.0");
    git(repo, "switch", "-c", "feature");
    git(
      repo,
      "commit",
      "--allow-empty",
      "-m",
      "feat(cli): add a thing",
      "-m",
      "Closes #11",
    );
    git(repo, "commit", "--allow-empty", "-m", "fix(cli): handle an empty thing");
    git(repo, "switch", "main");
    git(
      repo,
      "merge",
      "--no-ff",
      "feature",
      "-m",
      "Merge pull request #12 from owner/feature",
      "-m",
      "feat(cli): add a thing",
    );
    git(repo, "commit", "--allow-empty", "-m", "docs: fix a typo");
  });

  afterAll(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  /** A directory holding a `copilot` executable that runs `script` in sh. */
  function fakeCopilot(name: string, script: string): string {
    const bin = path.join(workDir, name);
    mkdirSync(bin);
    writeFileSync(path.join(bin, "copilot"), `#!/bin/sh\nprompt=$(cat)\n${script}\n`);
    chmodSync(path.join(bin, "copilot"), 0o755);
    return bin;
  }

  function runScript(bin: string) {
    return execFileSync(process.execPath, [SCRIPT], {
      cwd: repo,
      env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` },
      encoding: "utf8",
      stdio: "pipe",
    });
  }

  function releaseContext(env: Record<string, string | undefined> = {}) {
    return {
      cwd: repo,
      env,
      options: { repositoryUrl: "git+https://github.com/owner/repo.git" },
      lastRelease: { gitTag: "v1.0.0", gitHead: git(repo, "rev-parse", "v1.0.0") },
      nextRelease: {
        version: "1.1.0",
        gitTag: "v1.1.0",
        gitHead: git(repo, "rev-parse", "HEAD"),
      },
      commits: [
        { hash: "a1b2c3d", message: "feat(cli): add a thing\n\nCloses #11" },
        { hash: "b2c3d4e", message: "fix(cli): handle an empty thing" },
      ],
      logger: { log: vi.fn(), warn: vi.fn(), success: vi.fn(), error: vi.fn() },
    };
  }

  it("lists each pull request with its commits, then the commits made on main", async () => {
    const source = await buildReleaseSource({ cwd: repo, from: "v1.0.0" });

    expect(source).toBe(
      [
        "=== Pull request #12: feat(cli): add a thing",
        "",
        "--- feat(cli): add a thing",
        "Closes #11",
        "",
        "--- fix(cli): handle an empty thing",
        "",
        "=== Commits made directly on main",
        "",
        "--- docs: fix a typo",
      ].join("\n"),
    );
  });

  it.skipIf(process.platform === "win32")(
    "prints Copilot's notes for the commits since the latest tag, with linked references",
    () => {
      const bin = fakeCopilot(
        "copilot-writes-notes",
        `case "$prompt" in
          *"chore: initial commit"*) echo "the prompt holds released commits" >&2; exit 1 ;;
          *"=== Pull request #12: feat(cli): add a thing"*) printf '### Features\\n\\n- Adds a thing to the CLI (#12, #11)\\n' ;;
          *) echo "the prompt is missing the pull request" >&2; exit 1 ;;
        esac`,
      );

      expect(runScript(bin)).toBe(
        "### Features\n\n- Adds a thing to the CLI ([#12](https://github.com/owner/repo/issues/12), [#11](https://github.com/owner/repo/issues/11))\n",
      );
    },
  );

  it.skipIf(process.platform === "win32")(
    "exits with an error when Copilot fails, so the workflow can fall back",
    () => {
      const bin = fakeCopilot(
        "copilot-fails",
        `echo "No authentication information found." >&2; exit 1`,
      );

      expect(() => runScript(bin)).toThrow(/No authentication information found/);
    },
  );

  it.each([
    [
      "prints something other than release notes",
      fakeAgent(`process.stdout.write("Sorry, I cannot help with that.")`),
      /did not return release notes/,
    ],
    [
      "exits with an error",
      fakeAgent(
        `process.stderr.write("No authentication information found."); process.exit(1)`,
      ),
      /exited with code 1: No authentication information found/,
    ],
    ["is not installed", ["release-notes-agent-that-is-not-installed"], /ENOENT/],
  ])("rejects when the agent %s", async (_case, command, error) => {
    await expect(
      renderReleaseNotes({ source: "=== Pull request #12", command }),
    ).rejects.toThrow(error);
  });

  it("gives the agent an empty directory and only its own variables", async () => {
    const notes = await renderReleaseNotes({
      source: "=== Pull request #12",
      command: fakeAgent(
        `const leaked = ["NPM_TOKEN", "NODE_AUTH_TOKEN"].filter((name) => process.env[name]);
        const files = require("node:fs").readdirSync(".");
        process.stdout.write("### Features\\n\\n- leaked: " + (leaked.join(", ") || "none")
          + "; token: " + process.env.GITHUB_TOKEN + "; files: " + files.length)`,
      ),
      env: {
        ...process.env,
        GITHUB_TOKEN: "github-token",
        NPM_TOKEN: "npm-token",
        NODE_AUTH_TOKEN: "node-auth-token",
      },
    });

    expect(notes).toBe("### Features\n\n- leaked: none; token: github-token; files: 0");
  });

  it("puts the notes file under the version heading", async () => {
    const notesFile = path.join(workDir, "release-notes.md");
    writeFileSync(notesFile, "### Features\n\n- Adds a thing to the CLI (#12)\n");

    const notes = await generateNotes(
      {},
      releaseContext({ RELEASE_NOTES_FILE: notesFile }),
    );

    const [heading, ...body] = notes.split("\n\n");
    expect(heading).toMatch(
      /^# \[1\.1\.0\]\(https:\/\/github\.com\/owner\/repo\/compare\/v1\.0\.0\.\.\.v1\.1\.0\) \(\d{4}-\d{2}-\d{2}\)$/,
    );
    expect(body.join("\n\n")).toBe("### Features\n\n- Adds a thing to the CLI (#12)\n");
  });

  it.each([
    ["is empty", ""],
    ["holds something other than release notes", "Sorry, I cannot help with that."],
    ["is missing", undefined],
  ])("keeps the conventional notes when the notes file %s", async (name, content) => {
    const notesFile = path.join(workDir, `release-notes-${name.replaceAll(" ", "-")}.md`);
    if (content !== undefined) {
      writeFileSync(notesFile, content);
    }
    const context = releaseContext({ RELEASE_NOTES_FILE: notesFile });

    const notes = await generateNotes({}, context);

    expect(notes).toBe(await generateConventionalNotes({}, context));
    expect(context.logger.warn).toHaveBeenCalledOnce();
  });

  it("keeps the conventional notes without a notes file, as in a dry run", async () => {
    const context = releaseContext();

    const notes = await generateNotes({}, context);

    expect(notes).toBe(await generateConventionalNotes({}, context));
    expect(context.logger.warn).not.toHaveBeenCalled();
  });
});
