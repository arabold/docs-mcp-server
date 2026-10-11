# Tasks

## 1. Pipeline

- [x] 1.1 Replace `recoverJobs` in `PipelineManager` with `interruptedJobs: "recover" | "fail" | "leave"`; `"leave"` changes no version at startup. Verify with PipelineManager tests for each choice against a real store.

## 2. Backend and commands

- [x] 2.1 Replace `jobs: { recoverJobs }` with `jobs: { interruptedJobs }` in `openBackend`. Verify `backend.test.ts` covers "leave" leaving a RUNNING version untouched.
- [x] 2.2 Server commands pass `--resume ? "recover" : "fail"` (worker defaults `--resume` to true); `scrape` and `refresh` pass `"leave"`. Verify the command tests and typecheck.
- [x] 2.3 Update every other caller (tests, harnesses, search-eval preflight) and verify `rm -f .tsbuildinfo && npm run typecheck` passes.

## 3. End to end

- [x] 3.1 Add a CLI E2E: seed a RUNNING version from another process, run a local `scrape` of a different library, and verify the seeded version is still RUNNING; then verify a `refresh` leaves it too.

## 4. Docs

- [x] 4.1 Update ARCHITECTURE.md, `docs/concepts/pipeline-architecture.md` and the AGENTS.md test inventory; verify no `recoverJobs` remains outside archived changes (`grep -rn recoverJobs src test tests docs ARCHITECTURE.md`).
