## ADDED Requirements

### Requirement: Consistent MIME Type Detection

The system SHALL use `MimeTypeUtils.detectMimeTypeFromPath()` for all file extension to MIME type detection. Direct calls to `mime.getType()` outside of `mimeTypeUtils.ts` are prohibited.

#### Scenario: Local file MIME detection
- **WHEN** a local file is processed via `LocalFileStrategy`
- **THEN** the MIME type is detected using `MimeTypeUtils.detectMimeTypeFromPath()`

#### Scenario: Archive entry MIME detection
- **WHEN** a file inside an archive is processed
- **THEN** the MIME type is detected using `MimeTypeUtils.detectMimeTypeFromPath()`

#### Scenario: GitHub file MIME detection
- **WHEN** a GitHub repository file is evaluated for processing
- **THEN** the MIME type is detected using `MimeTypeUtils.detectMimeTypeFromPath()`

### Requirement: Custom MIME Type Priority

The system SHALL check custom extension mappings before falling back to the `mime` npm package. This ensures developer-focused file types are correctly identified even when the `mime` package returns incorrect or missing types.

#### Scenario: TypeScript detection overrides video/mp2t
- **GIVEN** a file with `.ts` extension
- **WHEN** MIME type is detected
- **THEN** the result is `text/x-typescript` (not `video/mp2t`)

#### Scenario: Rust detection overrides RLS services
- **GIVEN** a file with `.rs` extension  
- **WHEN** MIME type is detected
- **THEN** the result is `text/x-rust` (not `application/rls-services+xml`)

#### Scenario: Unknown extension falls back to mime package
- **GIVEN** a file with an extension not in custom mappings
- **WHEN** MIME type is detected
- **THEN** the system falls back to `mime.getType()` for detection

### Requirement: Documentation Format Support

The system SHALL recognize common documentation markup formats and assign appropriate text MIME types.

#### Scenario: RST file detection
- **GIVEN** a file with `.rst` extension
- **WHEN** MIME type is detected
- **THEN** the result is `text/x-rst`

#### Scenario: AsciiDoc file detection
- **GIVEN** a file with `.adoc` or `.asciidoc` extension
- **WHEN** MIME type is detected
- **THEN** the result is `text/x-asciidoc`

#### Scenario: Org-mode file detection
- **GIVEN** a file with `.org` extension
- **WHEN** MIME type is detected
- **THEN** the result is `text/x-org` (not `application/vnd.lotus-organizer`)

### Requirement: Programming Language Support

The system SHALL recognize common programming language source files and assign appropriate text MIME types for syntax highlighting.

#### Scenario: Python file detection
- **GIVEN** a file with `.py`, `.pyw`, or `.pyi` extension
- **WHEN** MIME type is detected
- **THEN** the result is `text/x-python`

#### Scenario: Modern TypeScript module detection
- **GIVEN** a file with `.mts` or `.cts` extension
- **WHEN** MIME type is detected
- **THEN** the result is `text/x-typescript`

#### Scenario: Functional language detection
- **GIVEN** a file with `.hs` (Haskell), `.elm`, `.ex` (Elixir), or `.clj` (Clojure) extension
- **WHEN** MIME type is detected
- **THEN** the result is the appropriate `text/x-*` MIME type

#### Scenario: Modern web framework detection
- **GIVEN** a file with `.vue`, `.svelte`, or `.astro` extension
- **WHEN** MIME type is detected
- **THEN** the result is the appropriate `text/x-*` MIME type

### Requirement: Configuration File Support

The system SHALL recognize common configuration file formats and assign appropriate text MIME types.

#### Scenario: TOML file detection
- **GIVEN** a file with `.toml` extension
- **WHEN** MIME type is detected
- **THEN** the result is `text/x-toml`

#### Scenario: Environment file detection
- **GIVEN** a file with `.env` extension
- **WHEN** MIME type is detected
- **THEN** the result is `text/x-dotenv`

#### Scenario: Terraform file detection
- **GIVEN** a file with `.tf` or `.tfvars` extension
- **WHEN** MIME type is detected
- **THEN** the result is `text/x-terraform`

### Requirement: Language Identifier Extraction

The system SHALL extract programming language identifiers from MIME types for syntax highlighting in code blocks.

#### Scenario: RST language extraction
- **GIVEN** a MIME type of `text/x-rst`
- **WHEN** language is extracted
- **THEN** the result is `rst`

#### Scenario: New language extraction
- **GIVEN** a MIME type for a newly supported language (e.g., `text/x-julia`)
- **WHEN** language is extracted
- **THEN** the result is the appropriate language identifier (e.g., `julia`)
