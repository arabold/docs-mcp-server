# cli-output Specification

## Purpose
Defines CLI output behavior including TTY-adaptive output, quiet/verbose modes, structured output formats, and diagnostic routing through the shared logger.

## Requirements

### Requirement: Adapt CLI output to interaction mode
The CLI MUST adapt its default diagnostic output based on whether it is running interactively. When stdout and stderr are attached to a TTY, the CLI SHALL behave as an interactive human-facing interface. When running without a TTY, the CLI SHALL behave as a machine-facing interface.

#### Scenario: Interactive command run
- **WHEN** a CLI command runs with TTY-attached output streams
- **THEN** the CLI may emit human-oriented diagnostics and progress updates during command execution
- **AND** the command result may still be presented in the command's existing human-facing format

#### Scenario: Non-interactive command run
- **WHEN** a CLI command runs without TTY-attached output streams
- **THEN** stdout MUST be reserved for the command result payload only
- **AND** diagnostics, warnings, and debug output MUST be emitted to stderr instead of stdout

### Requirement: Provide consistent quiet and verbose logging modes
The CLI MUST provide consistent logging controls across commands. `--quiet` MUST suppress all non-error diagnostics. `--verbose` MUST enable debug-level diagnostics. When neither flag is provided, the CLI MUST use defaults that match the current interaction mode while preserving the non-interactive stdout contract. These logging controls MUST be implemented as global CLI behavior so commands inherit them without command-specific reimplementation.

#### Scenario: Quiet mode suppresses non-error output
- **WHEN** a user runs any CLI command with `--quiet`
- **THEN** informational, warning, progress, and debug diagnostics MUST be suppressed
- **AND** command errors MUST still be emitted

#### Scenario: Verbose mode enables debug diagnostics
- **WHEN** a user runs any CLI command with `--verbose`
- **THEN** debug diagnostics MUST be enabled in addition to normal diagnostics for that interaction mode
- **AND** non-interactive command results MUST continue to be written to stdout without diagnostic noise

#### Scenario: Command inherits global logging controls
- **WHEN** a new CLI command is added
- **THEN** it MUST inherit `--quiet` and `--verbose` behavior from the shared CLI logging path
- **AND** it MUST NOT need to implement separate quiet or verbose flag handling to comply with this requirement

### Requirement: Route CLI diagnostics through the shared logger
The CLI MUST route diagnostics through the shared logger so that filtering, formatting, and stream selection are applied consistently. Direct `console.*` output MUST NOT be used for logs, warnings, debug messages, or progress updates. Direct stdout writes MAY be used only for intentional command result rendering.

#### Scenario: Command emits progress updates
- **WHEN** a command needs to report operational progress or status
- **THEN** it MUST emit that information through the shared logger
- **AND** the logger MUST decide whether to display or suppress it based on the active mode and log level

#### Scenario: Utility reports an operational warning
- **WHEN** a shared CLI utility encounters a recoverable warning
- **THEN** it MUST report that warning through the shared logger
- **AND** the warning MUST follow the same filtering and stream-routing rules as command-level diagnostics

### Requirement: Provide global structured output formats
The CLI MUST provide a global output-format control for commands that return structured data. In non-interactive runs, the default structured output format MUST be JSON. The CLI MUST support YAML and TOON as alternative structured output formats. Structured output formatting MUST be implemented through shared CLI infrastructure rather than per-command formatting logic.

#### Scenario: Non-interactive structured command uses default JSON output
- **WHEN** a structured-data command runs without a TTY and no explicit output format is requested
- **THEN** the command result MUST be written to stdout as JSON
- **AND** the JSON payload MUST not be mixed with diagnostics

#### Scenario: User selects YAML output
- **WHEN** a user runs a structured-data command with the global YAML output option
- **THEN** the command result MUST be rendered as YAML
- **AND** diagnostics MUST continue to follow the active logger rules

#### Scenario: User selects TOON output
- **WHEN** a user runs a structured-data command with the global TOON output option
- **THEN** the command result MUST be rendered as TOON
- **AND** the output selection MUST not require command-specific formatting logic

### Requirement: Distinguish structured-data and plain-text command results
The CLI MUST classify command results into structured-data and plain-text output contracts. Structured-data commands MUST use the shared structured output formatter. Plain-text commands MUST preserve their text payload contract and MUST NOT be implicitly wrapped in structured serialization solely because they run in non-interactive mode.

#### Scenario: Structured-data command uses shared formatter
- **WHEN** a command returns structured result data such as objects, arrays, or records
- **THEN** it MUST render its result through the shared structured output path
- **AND** it MUST honor the global output-format selection

#### Scenario: Plain-text command preserves text payload
- **WHEN** a command intentionally returns plain text content
- **THEN** it MUST write that text payload directly to stdout
- **AND** it MUST continue to keep diagnostics separate according to the active logger and stream-routing rules
