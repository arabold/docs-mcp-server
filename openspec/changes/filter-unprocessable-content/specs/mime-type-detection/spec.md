## ADDED Requirements

### Requirement: Pipeline Capability As Single Source of Truth

The system SHALL determine whether a MIME type can be processed by consulting the configured content pipelines, not by consulting a separate list. A single predicate SHALL be derived from `PipelineFactory.createStandardPipelines()` and SHALL be the only mechanism by which non-pipeline code answers the question "can this content type be processed?".

This extends the existing single-source-of-truth rule for extension-to-MIME detection: `MimeTypeUtils.detectMimeTypeFromPath()` remains the only way to map a path to a MIME type, and the capability predicate becomes the only way to map a MIME type to a processing verdict.

#### Scenario: Crawl filters consult the predicate
- **WHEN** a discovered-link filter or a fetcher decides whether content is processable
- **THEN** it calls the capability predicate
- **AND** it does not compare against any locally defined list of extensions or MIME types

#### Scenario: Predicate composes with path detection
- **GIVEN** a URL path ending in `.pdf`
- **WHEN** the processability of the link is evaluated
- **THEN** `MimeTypeUtils.detectMimeTypeFromPath()` yields `application/pdf`
- **AND** the capability predicate is evaluated against that value

#### Scenario: Support for a format is declared in exactly one place
- **GIVEN** the system gains or loses support for a content format
- **WHEN** the change is made to the relevant pipeline's `canProcess()`
- **THEN** every consumer of the capability predicate reflects the change
- **AND** no other file requires editing

### Requirement: Binary Media Classification

The system SHALL provide a classifier that reports whether a MIME type names binary media, defined as the `image/*`, `video/*`, `audio/*`, and `font/*` families. Classification SHALL be case-insensitive.

`application/*` SHALL NOT be classified as binary media. The `mime` package resolves several plain-text script extensions to `application/*` types — `.csh` to `application/x-csh`, `.tcl` to `application/x-tcl`, `.bat` to `application/x-msdownload`, `.scm` to `application/vnd.lotus-screencam`, `.ps` to `application/postscript` — and treating that family as binary would cause pre-request filtering to discard text files that pipelines read correctly.

#### Scenario: Media families are classified as binary
- **WHEN** the classifier is given `image/png`, `video/mp4`, `audio/mpeg`, or `font/woff2`
- **THEN** it returns true for each

#### Scenario: Text and document types are not binary media
- **WHEN** the classifier is given `text/html`, `text/plain`, `application/pdf`, or `application/json`
- **THEN** it returns false for each

#### Scenario: Misclassified script types are not binary media
- **WHEN** the classifier is given `application/x-csh`, `application/x-tcl`, `application/x-msdownload`, `application/vnd.lotus-screencam`, or `application/postscript`
- **THEN** it returns false for each

#### Scenario: Classification ignores case
- **WHEN** the classifier is given `IMAGE/PNG`
- **THEN** it returns true
