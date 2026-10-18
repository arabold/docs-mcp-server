# Contributing

Contributions are welcome. For questions or suggestions, open an issue.

Read [ARCHITECTURE.md](ARCHITECTURE.md) for the system design. [AGENTS.md](AGENTS.md) holds the rules for the environment, checks, commits, code, tests and documentation; they apply to human contributors too.

## Setup

1. Fork the repository and create a branch named `<type>/<issue>-<description>`, for example `feat/123-add-cache`.
2. Use Node.js 22 (`.nvmrc`; with nvm, run `nvm use`). If you switch Node versions after installing dependencies, run `npm rebuild` to recompile native modules such as `better-sqlite3`.
3. Install dependencies with `npm ci`. Use `npm install` only when you change dependencies on purpose.
4. Install Chromium for the browser tests: `npx playwright install chromium`.

## Before You Push

The hooks that Husky installs check only part of a change. The `pre-commit` hook runs Biome on the staged files through `lint-staged`, and the `commit-msg` hook runs `commitlint`. Run the rest yourself:

```bash
npm run lint
npm run typecheck
npm test
```

End-to-end suites that start the CLI run `dist/index.js` when it exists and the TypeScript sources otherwise (`getCliCommand` in `test/test-helpers.ts`). After changing server code, run `npm run build` or delete `dist/`, so they test your change.

CI (`.github/workflows/ci.yml`) runs lint, typecheck, tests, the build and the Docker image end-to-end suite on every pull request to `main`.

## Commit Messages

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/), checked by `commitlint` with the settings in `commitlint.config.js`. See [AGENTS.md](AGENTS.md#git) for the subject rules. Releases are cut with semantic-release, which derives the version from these commit types.

## Pull Requests

Open the pull request against `main` and describe what changes and why.

## Releases

A maintainer cuts a release by running the Release workflow (`.github/workflows/release.yml`). semantic-release works out the version from the commit types, publishes the npm package, tags the release, and updates `CHANGELOG.md`; the Docker image is built from the tag.

GitHub Copilot CLI writes the release notes from the pull requests merged since the last release, following `.github/prompts/release-changelog.prompt.md`. Each pull request becomes one bullet written from its title and commit messages, so those should say what changes for users. Because commit messages are untrusted input, Copilot runs in a job of its own, signed in with that job's `GITHUB_TOKEN`, which can read the code and make Copilot requests but cannot push, tag or publish; `scripts/release/ai-release-notes.mjs` also gives it no tools. The requests are billed to the repository owner's Copilot seat. The release job puts the notes under the version heading. When Copilot fails or returns something other than release notes, the release keeps semantic-release's list of commits and the workflow shows a warning.

`npm run release:notes` previews the notes for the unreleased commits with your local, signed-in `copilot` CLI. `npm run release:notes -- --source` prints what Copilot receives.
