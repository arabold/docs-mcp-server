## 1. Specification
- [x] 1.1 Add the `cli-output` spec covering interactive vs non-interactive CLI behavior.
- [x] 1.2 Define normative behavior for global default, `--quiet`, and `--verbose` logging modes.
- [x] 1.3 Define the rule that non-result diagnostics must use the shared logger rather than direct `console.*` calls.
- [x] 1.4 Define the structured output contract, including default JSON output for machine-facing structured commands and supported alternative formats.
- [x] 1.5 Define the distinction between structured-data commands and plain-text commands.

## 2. Implementation
- [x] 2.1 Refactor the logger and CLI bootstrap so global logging flags are interpreted once and applied consistently across all commands.
- [x] 2.2 Update CLI commands and shared utilities to route progress, warnings, and diagnostics through the logger.
- [x] 2.3 Add a shared output-format layer for structured command results instead of per-command format implementations.
- [x] 2.4 Classify existing commands by output type and apply the appropriate shared rendering path.
- [x] 2.5 Preserve explicit command result rendering while ensuring non-interactive stdout remains clean for agent consumption.

## 3. Validation
- [x] 3.1 Add or update automated tests for TTY vs non-TTY execution and `--quiet` / `--verbose` behavior.
- [x] 3.2 Add or update tests that fail when CLI diagnostics bypass the shared logger contract.
- [x] 3.3 Add or update tests for global structured output selection, including JSON, YAML, and TOON.
- [x] 3.4 Add or update tests that verify plain-text commands keep their text payload contract while still honoring the logging rules.
- [x] 3.5 Update CLI-facing documentation to describe the output behavior and recommended agent usage.
