## ADDED Requirements

### Requirement: Archive detection exclusion for document formats
The archive detection system SHALL NOT treat ZIP-based document formats as archives. Specifically, `ArchiveFactory.getArchiveAdapter()` SHALL return `null` for files with extensions corresponding to supported document formats (`.docx`, `.xlsx`, `.pptx`, `.odt`, `.ods`, `.odp`, `.epub`). Archive detection SHALL rely exclusively on file extensions (`.zip`, `.tar`, `.gz`, `.tgz`) rather than magic byte inspection, ensuring document files are routed to `DocumentPipeline` for proper text extraction.

#### Scenario: DOCX file not treated as archive
- **WHEN** `getArchiveAdapter()` is called with a path ending in `.docx`
- **THEN** it SHALL return `null`
- **AND** the file SHALL be processed by `DocumentPipeline` via Kreuzberg

#### Scenario: XLSX file not treated as archive
- **WHEN** `getArchiveAdapter()` is called with a path ending in `.xlsx`
- **THEN** it SHALL return `null`

#### Scenario: PPTX file not treated as archive
- **WHEN** `getArchiveAdapter()` is called with a path ending in `.pptx`
- **THEN** it SHALL return `null`

#### Scenario: EPUB file not treated as archive
- **WHEN** `getArchiveAdapter()` is called with a path ending in `.epub`
- **THEN** it SHALL return `null`

#### Scenario: OpenDocument files not treated as archives
- **WHEN** `getArchiveAdapter()` is called with a path ending in `.odt`, `.ods`, or `.odp`
- **THEN** it SHALL return `null`

#### Scenario: Actual ZIP file still detected
- **WHEN** `getArchiveAdapter()` is called with a path ending in `.zip`
- **THEN** it SHALL return a `ZipAdapter` instance

#### Scenario: Extensionless file not treated as archive
- **WHEN** `getArchiveAdapter()` is called with a file that has no extension
- **THEN** it SHALL return `null`
- **AND** the file SHALL NOT be opened or inspected for magic bytes
