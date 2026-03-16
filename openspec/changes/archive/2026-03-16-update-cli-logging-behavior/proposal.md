# Change: Update CLI logging behavior

## Why
The CLI is becoming a primary interface for both humans and agents, but the current behavior mixes command results with operational logs and progress output. That makes agent use less reliable and creates inconsistent behavior because some diagnostics bypass the shared logger entirely.

## What Changes
- Add a new `cli-output` capability that defines CLI output behavior for interactive and non-interactive execution.
- Specify how default, `--quiet`, and `--verbose` logging modes behave across TTY and non-TTY runs.
- Require `--quiet`, `--verbose`, and output-format selection to be implemented as global CLI behaviors rather than redefined per command.
- Require all CLI diagnostics and progress messages to flow through the shared logger instead of ad hoc `console.*` calls.
- Define a stdout/stderr contract so non-interactive agent usage receives clean command results.
- Define a structured output mode for commands that return data, with JSON as the default non-interactive format and YAML/TOON as supported alternatives.
- Classify commands by output contract so structured-data commands and plain-text commands follow explicit shared rendering rules.

## Impact
- Affected specs: `cli-output`
- Affected code: `src/cli/**`, `src/utils/logger.ts`, command result rendering, CLI documentation in `README.md` and related guides
