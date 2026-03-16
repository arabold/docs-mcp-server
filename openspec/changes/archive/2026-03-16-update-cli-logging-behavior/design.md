## Context
The repository already exposes most functionality through CLI commands, which makes it attractive for agent-driven workflows. Today, however, CLI output is not consistently machine-safe: some commands print progress directly, some tools emit informational logs during one-shot commands, and some warnings bypass the shared logger. The result is that non-interactive consumers can receive mixed output that is harder to parse and easier to misinterpret.

## Goals / Non-Goals
- Goals:
  - Define one logging contract that works for both humans and agents.
  - Keep interactive terminal usage pleasant and informative.
  - Keep non-interactive usage deterministic by reserving stdout for command results.
  - Centralize diagnostics through the shared logger.
  - Centralize global CLI behaviors so commands do not each implement their own quiet, verbose, or output-format logic.
  - Provide a shared structured output mode for agent-facing commands.
  - Explicitly distinguish structured-data commands from plain-text commands so output handling remains predictable.
- Non-Goals:
  - Introduce a separate agent-only CLI mode flag in this change.
  - Redesign individual command payload formats beyond what is needed for a clean stream contract.
  - Change MCP protocol behavior.
  - Add XML output support in this change.

## Decisions
- Decision: Use TTY detection to choose the default output behavior.
  - Interactive runs may present operator-oriented diagnostics and progress updates.
  - Non-interactive runs must keep stdout clean for command results and send diagnostics to stderr.
- Decision: Keep `--quiet` and `--verbose` as the explicit logging controls across both modes.
  - `--quiet` suppresses non-error diagnostics.
  - `--verbose` enables debug-level diagnostics.
  - Neither flag changes the stdout/stderr contract for non-interactive command results.
- Decision: Implement logging controls centrally in the CLI bootstrap and logger path.
  - Commands inherit the active logging mode instead of each command implementing its own quiet or verbose behavior.
  - This keeps behavior uniform and reduces command-specific branching.
- Decision: Treat the shared logger as the only supported path for diagnostics.
  - Direct `console.*` calls remain acceptable only for deliberate command result rendering to stdout.
  - This keeps filtering, formatting, and stream routing in one place.
- Decision: Add a shared structured output mode for commands that return structured data.
  - Non-interactive structured commands default to JSON.
  - YAML and TOON are supported alternatives.
  - Commands that intentionally return plain text content may keep their text output contract.
- Decision: Classify CLI commands into structured-data and plain-text result categories.
  - Structured-data commands use the shared formatter and global output-format selection.
  - Plain-text commands preserve their text payload contract and are not forced through structured serialization.
  - Both categories still follow the same logger and stream-routing rules.

## Alternatives Considered
- Add a dedicated `--agent` flag now.
  - Rejected for this proposal because TTY-based behavior covers the immediate need with less surface area.
- Force stdout-only result behavior in both interactive and non-interactive modes.
  - Rejected because it would unnecessarily reduce the usability of interactive runs.
- Specify only log levels and not stream routing.
  - Rejected because agent-safe output depends on stream separation, not just reduced verbosity.
- Allow each command to define its own output formats.
  - Rejected because it would recreate the inconsistency this proposal is trying to remove.
- Add XML now alongside JSON, YAML, and TOON.
  - Rejected because there is no current evidence of demand and it expands implementation and testing scope without clear payoff.

## Risks / Trade-offs
- TTY detection is a pragmatic proxy for human vs agent usage and may not match every workflow.
  - Mitigation: keep the spec focused on default behavior so an explicit override can be added later if needed.
- Centralizing diagnostics through the logger may require touching many command paths.
  - Mitigation: keep the contract narrow and allow explicit result rendering to remain separate.
- A shared output layer requires identifying which commands are structured-data commands versus plain-text commands.
  - Mitigation: scope the requirement to commands that return structured data and preserve explicit plain-text contracts where needed.

## Migration Plan
1. Add the `cli-output` spec and approve the change.
2. Refactor logger stream routing and level handling.
3. Add shared structured output formatting for commands that return data.
4. Update commands and utilities to stop bypassing the logger.
5. Add regression tests for TTY and non-TTY behavior plus output formats.
6. Update user-facing docs to describe the new CLI contract.

## Open Questions
- None.
