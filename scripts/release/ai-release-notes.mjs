#!/usr/bin/env node

/**
 * Release notes written by an agent.
 *
 * Run as a script, it gives the pull requests and commits merged since the
 * latest release tag to GitHub Copilot CLI, along with the instructions in
 * `.github/prompts/release-changelog.prompt.md`, and prints the Markdown it
 * writes. The release workflow runs it in a job of its own, and
 * `npm run release:notes` previews the next release:
 *
 *   node scripts/release/ai-release-notes.mjs [<from-ref>] [--source]
 *
 * `--source` prints what the agent would receive instead of asking it.
 *
 * As a semantic-release plugin, its `generateNotes` step puts those notes
 * under the usual version heading. Without them, the release keeps the
 * conventional notes, so a model problem never blocks a release.
 */

import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const PROMPT_FILE = fileURLToPath(
  new URL("../../.github/prompts/release-changelog.prompt.md", import.meta.url),
);

/** Copilot CLI, reading the prompt on stdin and printing only its answer. */
const DEFAULT_AGENT_COMMAND = [
  "copilot",
  "--model",
  "auto",
  "--silent",
  "--no-ask-user",
  "--no-custom-instructions",
  "--disable-builtin-mcps",
  "--no-auto-update",
  "--log-level",
  "error",
];

const AGENT_TIMEOUT_MS = 10 * 60 * 1000;

// The prompt is built from commit messages, which are untrusted. The agent
// gets no tool permissions, an empty working directory, and only these
// variables; Copilot CLI signs in with the first token set, in this order. The
// release workflow runs it in a job whose token cannot push, tag or publish.
const AGENT_ENV_VARS = [
  "PATH",
  "HOME",
  "TMPDIR",
  "COPILOT_GITHUB_TOKEN",
  "GH_TOKEN",
  "GITHUB_TOKEN",
];

const FIELD_SEPARATOR = "\x1f";
const RECORD_SEPARATOR = "\x1e";

/**
 * semantic-release `generateNotes` step: the notes in the file named by
 * `RELEASE_NOTES_FILE`, under the version heading of the conventional notes.
 *
 * Without that variable, as in a dry run, or when the file holds no release
 * notes, it returns the conventional notes.
 *
 * @param {Record<string, unknown>} pluginConfig Options of
 *   `@semantic-release/release-notes-generator`.
 * @param {any} context The semantic-release context.
 * @returns {Promise<string>} Release notes in Markdown.
 */
export async function generateNotes(pluginConfig, context) {
  const { env, logger } = context;
  // Imported here so the script runs without installing the dependencies.
  const { generateNotes: generateConventionalNotes } = await import(
    "@semantic-release/release-notes-generator"
  );
  const conventionalNotes = await generateConventionalNotes(pluginConfig, context);
  const notesFile = env.RELEASE_NOTES_FILE;
  if (!notesFile) {
    return conventionalNotes;
  }
  const notes = (await readFile(notesFile, "utf8").catch(() => "")).trim();
  if (!notes.startsWith("### ")) {
    logger.warn(`Keeping the conventional release notes: ${notesFile} holds none`);
    return conventionalNotes;
  }
  logger.success(`Using the release notes in ${notesFile}`);
  return `${versionHeading(conventionalNotes)}\n\n${notes}\n`;
}

/**
 * Lists the changes of a release for the agent: each pull request merged into
 * the branch with the commits it brought, then the commits made on the branch
 * itself.
 *
 * @param {object} options
 * @param {string} options.cwd Repository to read.
 * @param {string} [options.from] Commit or tag of the previous release; the
 *   whole history when absent.
 * @param {string} [options.to] Commit of the new release.
 * @returns {Promise<string>} Plain text, empty when the range has no commits.
 */
export async function buildReleaseSource({ cwd, from, to = "HEAD" }) {
  const range = from ? `${from}..${to}` : to;
  const sections = [];
  const branchCommits = [];
  for (const entry of await readCommits(cwd, ["--first-parent", "--reverse", range])) {
    if (entry.parents.length < 2) {
      branchCommits.push(entry);
      continue;
    }
    // GitHub puts the pull request title in the body of its merge commit.
    const pullRequest = /^Merge pull request (#\d+)/.exec(entry.subject);
    const title = entry.body.split("\n")[0];
    const heading =
      pullRequest && title ? `Pull request ${pullRequest[1]}: ${title}` : entry.subject;
    const commits = await readCommits(cwd, [
      "--no-merges",
      "--reverse",
      `${entry.parents[0]}..${entry.hash}`,
    ]);
    sections.push(formatSection(heading, commits));
  }
  if (branchCommits.length > 0) {
    sections.push(formatSection("Commits made directly on main", branchCommits));
  }
  return sections.join("\n\n");
}

/**
 * Has the agent rewrite the changes of a release into release notes.
 *
 * @param {object} options
 * @param {string} options.source Output of `buildReleaseSource`.
 * @param {string[]} [options.command] Agent command that reads the prompt on
 *   stdin and prints the notes.
 * @param {Record<string, string | undefined>} [options.env] Environment the
 *   agent's variables are taken from.
 * @returns {Promise<string>} Markdown that starts with a "###" heading.
 * @throws {Error} When the agent fails, times out, or prints something other
 *   than release notes.
 */
export async function renderReleaseNotes({
  source,
  command = DEFAULT_AGENT_COMMAND,
  env = process.env,
}) {
  const instructions = (await readFile(PROMPT_FILE, "utf8")).replace(
    /^---\n[\s\S]*?\n---\n/,
    "",
  );
  const prompt = `${instructions.trim()}\n\n<source-changelog>\n${source}\n</source-changelog>\n`;
  const agentEnv = { NO_COLOR: "1" };
  for (const name of AGENT_ENV_VARS) {
    if (env[name] !== undefined) {
      agentEnv[name] = env[name];
    }
  }

  const workDir = await mkdtemp(path.join(tmpdir(), "release-notes-"));
  try {
    const notes = (
      await runAgent(command, prompt, { cwd: workDir, env: agentEnv })
    ).trim();
    if (!notes.startsWith("### ")) {
      const firstLine = notes.split("\n")[0].slice(0, 200) || "nothing";
      throw new Error(
        `The agent did not return release notes; it began with: ${firstLine}`,
      );
    }
    return notes;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

/**
 * Links "#123" references to their issue or pull request, which GitHub does
 * in a release but not in CHANGELOG.md.
 *
 * @param {string} markdown Release notes.
 * @param {string} repositoryUrl Git URL of a GitHub repository.
 * @returns {string} The notes, unchanged when the URL is not a GitHub one.
 */
function linkReferences(markdown, repositoryUrl) {
  const match = /github\.com[:/]([^/]+)\/(.+?)(?:\.git)?\/?$/.exec(repositoryUrl ?? "");
  if (!match) {
    return markdown;
  }
  const base = `https://github.com/${match[1]}/${match[2]}`;
  return markdown.replace(/(?<![\w&[/])#(\d+)\b/g, `[#$1](${base}/issues/$1)`);
}

/**
 * Version heading of the conventional notes, linked to the comparison with the
 * previous release; their "###" sections follow it.
 *
 * @param {string} conventionalNotes
 */
function versionHeading(conventionalNotes) {
  return conventionalNotes.split(/\n(?=### )/)[0].trim();
}

/**
 * @param {string} cwd
 * @param {string[]} args Arguments for `git log`.
 */
async function readCommits(cwd, args) {
  const format = ["%H", "%P", "%s", "%b"].join(FIELD_SEPARATOR) + RECORD_SEPARATOR;
  const { stdout } = await execFileAsync("git", ["log", `--format=${format}`, ...args], {
    cwd,
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout
    .split(RECORD_SEPARATOR)
    .filter((record) => record.trim())
    .map((record) => {
      const [hash, parents, subject, body] = record
        .replace(/^\n/, "")
        .split(FIELD_SEPARATOR);
      return {
        hash,
        parents: parents.split(" ").filter(Boolean),
        subject,
        body: body.trim(),
      };
    });
}

/**
 * @param {string} heading
 * @param {{ subject: string, body: string }[]} commits
 */
function formatSection(heading, commits) {
  const lines = [`=== ${heading}`];
  for (const commit of commits) {
    lines.push("", `--- ${commit.subject}`);
    if (commit.body) {
      lines.push(commit.body);
    }
  }
  return lines.join("\n");
}

/**
 * @param {string[]} command
 * @param {string} input Written to the agent's stdin.
 * @param {{ cwd: string, env: Record<string, string | undefined> }} options
 * @returns {Promise<string>} What the agent printed.
 */
function runAgent([executable, ...args], input, { cwd, env }) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, env, timeout: AGENT_TIMEOUT_MS });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        const reason = signal ? `was stopped by ${signal}` : `exited with code ${code}`;
        reject(new Error(`${executable} ${reason}: ${stderr.trim().slice(-500)}`));
      }
    });
    // An agent that exits early closes stdin; its exit code says why.
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

/** Prints the notes, or their source, for the commits since a release. */
async function main(args) {
  const cwd = process.cwd();
  const git = async (...gitArgs) =>
    (await execFileAsync("git", gitArgs, { cwd })).stdout.trim();
  const from =
    args.find((arg) => !arg.startsWith("--")) ??
    (await git("describe", "--tags", "--abbrev=0", "--match", "v[0-9]*"));
  const source = await buildReleaseSource({ cwd, from });
  if (!source) {
    throw new Error(`No commits since ${from}.`);
  }
  if (args.includes("--source")) {
    process.stdout.write(`${source}\n`);
    return;
  }
  const notes = await renderReleaseNotes({ source });
  const remote = await git("remote", "get-url", "origin");
  process.stdout.write(`${linkReferences(notes, remote)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`❌ ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  });
}
