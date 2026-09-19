# Spec Delta

## Purpose

Defines how a library's version labels are normalized when documentation is indexed, how a requested
version resolves to one of those stored labels, and what callers observe when nothing matches — covering
semantic versions, opaque tags, prereleases and unversioned documentation.

## ADDED Requirements

### Requirement: Version Label Normalization On Write

Every path that indexes documentation SHALL normalize a version label identically: trim surrounding
whitespace, lowercase it, and treat an empty result as unversioned. The label SHALL then be stored
verbatim. The system SHALL NOT validate, coerce, reject or otherwise rewrite a label beyond those steps,
because a version label is not guaranteed to be a semantic version.

#### Scenario: Surrounding whitespace is removed
- **WHEN** documentation is indexed with the version `" 1.0.0 "`
- **THEN** the stored label SHALL be `1.0.0`
- **AND** it SHALL NOT create a second bucket distinct from a previously stored `1.0.0`

#### Scenario: Labels are lowercased
- **WHEN** documentation is indexed with the version `"LATEST"`
- **THEN** the stored label SHALL be `latest`

#### Scenario: An empty label means unversioned
- **WHEN** documentation is indexed with the version `""`, `"   "`, `null`, or with no version at all
- **THEN** the documentation SHALL be stored as unversioned

#### Scenario: A partial version is stored as written
- **WHEN** documentation is indexed with the version `"1.20"`
- **THEN** the stored label SHALL be `1.20`
- **AND** it SHALL NOT be rewritten to `1.20.0`

#### Scenario: A non-version label is accepted
- **WHEN** documentation is indexed with the version `"stable"`
- **THEN** the documentation SHALL be indexed under the label `stable`
- **AND** no validation error SHALL be raised

#### Scenario: A partial version and its full form are distinct buckets
- **WHEN** documentation is indexed once with `"1.20"` and once with `"1.20.0"`
- **THEN** the library SHALL have two distinct version buckets, `1.20` and `1.20.0`

#### Scenario: All entry points normalize identically
- **WHEN** the same version label is submitted through the MCP scrape tool, the CLI scrape command, the
  web UI, or the pipeline API directly
- **THEN** each SHALL produce the same stored label
- **AND** repeated submissions SHALL resolve to a single version bucket rather than one per entry point

### Requirement: Version Label Classification

The system SHALL classify each stored label as either a semantic version or an opaque tag. A semantic
version is a full `X.Y.Z` semver string, or a `major` or `major.minor` prefix, each optionally preceded by
`v` and optionally carrying prerelease or build metadata. Every other label is an opaque tag. Semantic
versions participate in ordering and range matching; opaque tags SHALL be matched only literally and
SHALL NEVER be coerced into a version, ordered against versions, or selected by a range.

#### Scenario: Full semantic versions are versions
- **WHEN** the labels `1.2.3`, `2.0.0-beta`, `1.0.0+build`, `v2.0.0-beta.1` are classified
- **THEN** each SHALL be classified as a semantic version
- **AND** prerelease and build metadata SHALL be preserved rather than discarded

#### Scenario: Partial versions are versions
- **WHEN** the labels `1.20`, `5`, `v2`, `v1.20` are classified
- **THEN** each SHALL be classified as a semantic version

#### Scenario: Labels that merely contain a number are tags
- **WHEN** the labels `stable-2024`, `release-2024`, `docs-v3`, `node18`, `alpha-1`, `2024-01-15` are
  classified
- **THEN** each SHALL be classified as an opaque tag
- **AND** none SHALL be treated as the version formed by the digits it contains

#### Scenario: Channel names are tags
- **WHEN** the labels `stable`, `latest`, `main`, `next` are classified
- **THEN** each SHALL be classified as an opaque tag

#### Scenario: Range syntax stored as a label is a tag
- **WHEN** the labels `1.x`, `1.2.x` are classified
- **THEN** each SHALL be classified as an opaque tag, because range syntax describes a query rather than a
  released version

#### Scenario: Over-long numeric labels are tags
- **WHEN** the label `1.2.3.4` is classified
- **THEN** it SHALL be classified as an opaque tag

### Requirement: Literal Label Resolution

Resolution SHALL first attempt a literal match: the requested version, trimmed and lowercased, compared
for equality against each stored label. When a stored label matches, the system SHALL return that label
and SHALL NOT continue to semantic matching. This guarantees that any indexed bucket is always reachable
by the name it was indexed under.

#### Scenario: An opaque tag is reachable by its own name
- **GIVEN** a library with the stored label `latest`
- **WHEN** a caller requests version `latest`
- **THEN** the resolver SHALL return `latest`

#### Scenario: Literal matching ignores case and surrounding whitespace
- **GIVEN** a library with the stored label `stable`
- **WHEN** a caller requests version `" STABLE "`
- **THEN** the resolver SHALL return `stable`

#### Scenario: A partial version resolves to itself when its full form also exists
- **GIVEN** a library with the stored labels `1.20` and `1.20.0`
- **WHEN** a caller requests version `1.20`
- **THEN** the resolver SHALL return `1.20`

#### Scenario: A full version resolves to itself when its partial form also exists
- **GIVEN** a library with the stored labels `1.20` and `1.20.0`
- **WHEN** a caller requests version `1.20.0`
- **THEN** the resolver SHALL return `1.20.0`

#### Scenario: A prerelease is reachable by its own name
- **GIVEN** a library with the stored labels `2.0.0` and `2.0.0-beta`
- **WHEN** a caller requests version `2.0.0-beta`
- **THEN** the resolver SHALL return `2.0.0-beta`
- **AND** the stable `2.0.0` SHALL NOT take its place

#### Scenario: A stored label that looks like a range is reachable by its own name
- **GIVEN** a library with the stored label `1.x`
- **WHEN** a caller requests version `1.x`
- **THEN** the resolver SHALL return the stored `1.x` label rather than range-matching other versions

### Requirement: Semantic Version Resolution

When no stored label matches literally, the system SHALL resolve the request against the library's
semantic versions. A request MAY be a full version, a `major` or `major.minor` prefix, an X-range such as
`5.x` or `5.2.x`, the word `latest`, or absent. When a request names a specific version, the system SHALL
select the highest available version at or below it, preferring a match over no match because older
documentation remains useful. Prereleases SHALL be ranked as ordinary versions and SHALL be eligible for
selection whenever they are the closest available match.

#### Scenario: A prerelease is selected when it is the only version indexed
- **GIVEN** a library whose only stored version is `2.0.0-beta`
- **WHEN** a caller requests the latest version, or requests no version at all
- **THEN** the resolver SHALL return `2.0.0-beta`

#### Scenario: The newest version wins even when it is a prerelease
- **GIVEN** a library with the stored versions `1.0.0` and `2.0.0-beta`
- **WHEN** a caller requests the latest version, or requests no version at all
- **THEN** the resolver SHALL return `2.0.0-beta`

#### Scenario: A released version supersedes its own prerelease
- **GIVEN** a library with the stored versions `1.0.0`, `2.0.0-beta` and `2.0.0`
- **WHEN** a caller requests the latest version
- **THEN** the resolver SHALL return `2.0.0`

#### Scenario: A prerelease of the requested version beats an older major
- **GIVEN** a library with the stored versions `1.0.0` and `2.0.0-beta`
- **WHEN** a caller requests version `2.0.0`
- **THEN** the resolver SHALL return `2.0.0-beta`

#### Scenario: An X-range selects a prerelease within that range
- **GIVEN** a library with the stored versions `1.0.0` and `2.0.0-beta`
- **WHEN** a caller requests version `2.x`
- **THEN** the resolver SHALL return `2.0.0-beta`

#### Scenario: A major-only request selects a prerelease within that major
- **GIVEN** a library with the stored versions `1.0.0` and `2.0.0-beta`
- **WHEN** a caller requests version `2`
- **THEN** the resolver SHALL return `2.0.0-beta`

#### Scenario: Falling back below the requested version may select a prerelease
- **GIVEN** a library with the stored versions `1.0.0` and `2.0.0-beta`
- **WHEN** a caller requests version `3.0.0`
- **THEN** the resolver SHALL return `2.0.0-beta` as the highest version at or below the request

#### Scenario: A newer prerelease is not selected for an older request
- **GIVEN** a library with the stored versions `1.0.0` and `1.0.1-beta`
- **WHEN** a caller requests version `1.0.0`
- **THEN** the resolver SHALL return `1.0.0`
- **AND** SHALL NOT return `1.0.1-beta`, which is above the request

#### Scenario: Prereleases of the same version are ordered among themselves
- **GIVEN** a library with the stored versions `2.0.0-rc.1` and `2.0.0-rc.2`
- **WHEN** a caller requests the latest version
- **THEN** the resolver SHALL return `2.0.0-rc.2`

#### Scenario: A request with nothing at or below it does not match
- **GIVEN** a library whose only stored version is `2.0.0-beta`
- **WHEN** a caller requests version `1.20`
- **THEN** the resolver SHALL NOT return a semantic version match

#### Scenario: Partial stored versions are matchable
- **GIVEN** a library with the stored versions `1.20` and `5`
- **WHEN** a caller requests the latest version
- **THEN** the resolver SHALL return `5`

#### Scenario: Opaque tags are excluded from semantic matching
- **GIVEN** a library with the stored labels `1.0.0`, `stable-2024` and `node18`
- **WHEN** a caller requests the latest version
- **THEN** the resolver SHALL return `1.0.0`
- **AND** SHALL NOT return a tag on the basis of digits it contains

### Requirement: Tag-Only Library Resolution

When a caller requests no specific version and the library has no semantic versions, the system SHALL
resolve to the library's single opaque tag when exactly one exists. When more than one tag exists there is
no defensible newest, so the system SHALL raise a version-not-found error that lists the available labels.

#### Scenario: A single tag resolves without an explicit request
- **GIVEN** a library whose only stored label is `latest`
- **WHEN** a caller requests no version
- **THEN** the resolver SHALL return `latest`

#### Scenario: Multiple tags cannot be ranked
- **GIVEN** a library with the stored labels `stable` and `next` and no semantic versions
- **WHEN** a caller requests no version
- **THEN** the system SHALL raise a version-not-found error
- **AND** the error SHALL list `stable` and `next` as available labels

#### Scenario: A single tag does not outrank a semantic version
- **GIVEN** a library with the stored labels `1.0.0` and `stable`
- **WHEN** a caller requests no version
- **THEN** the resolver SHALL return `1.0.0`

### Requirement: Unversioned Documentation Resolution

Documentation indexed without a version SHALL occupy its own bucket, distinct from every labelled bucket.
The system SHALL report whether that bucket exists alongside any resolved match. A labelled bucket SHALL
be preferred over the unversioned bucket, so indexed documentation is never silently skipped in favour of
unversioned content. The unversioned bucket SHALL be used only when no label resolves.

#### Scenario: Unversioned availability is reported alongside a match
- **GIVEN** a library with the stored version `1.0.0` and unversioned documentation
- **WHEN** a caller requests version `1.0.0`
- **THEN** the resolver SHALL return `1.0.0`
- **AND** SHALL report that unversioned documentation also exists

#### Scenario: Unversioned documentation is used when nothing resolves
- **GIVEN** a library with unversioned documentation and no labels that match the request
- **WHEN** a caller requests version `9.9.9`
- **THEN** the resolver SHALL report no match and that unversioned documentation exists

#### Scenario: A prerelease is not silently skipped in favour of unversioned
- **GIVEN** a library with the stored version `2.0.0-beta` and unversioned documentation
- **WHEN** a caller requests no version
- **THEN** the resolver SHALL return `2.0.0-beta`
- **AND** SHALL NOT fall back to the unversioned bucket

#### Scenario: A tag is not silently skipped in favour of unversioned
- **GIVEN** a library with the stored label `latest` and unversioned documentation
- **WHEN** a caller requests version `latest`
- **THEN** the resolver SHALL return `latest`

### Requirement: Resolution Failure Reporting

When no label resolves and no unversioned documentation exists, the system SHALL raise a version-not-found
error naming the library, the requested version, and every label available for that library — including
opaque tags, so a caller can see and request a label the resolver could not rank. When the library itself
is unknown, the system SHALL raise a library-not-found error carrying similarly named libraries.

#### Scenario: Available labels include tags
- **GIVEN** a library with the stored labels `1.0.0` and `stable` and no unversioned documentation
- **WHEN** a caller requests version `9.9.9` and nothing resolves
- **THEN** the error SHALL list both `1.0.0` and `stable` as available

#### Scenario: An unknown library is distinguished from an unmatched version
- **WHEN** a caller requests a version of a library that has no documentation at all
- **THEN** the system SHALL raise a library-not-found error rather than a version-not-found error
- **AND** the error SHALL include similarly named libraries when any exist

#### Scenario: An unparseable request does not mask available documentation
- **GIVEN** a library with the stored version `1.0.0` and unversioned documentation
- **WHEN** a caller requests a version that is neither a label nor valid range syntax
- **THEN** the system SHALL report no match and that unversioned documentation exists, rather than failing

### Requirement: Version Listing Order

The system SHALL present a library's versions in a single deterministic order wherever they are listed:
unversioned documentation first, then semantic versions from newest to oldest, then opaque tags in
alphabetical order. Every surface that lists versions SHALL use this order, so the default selection a
caller sees matches the one the resolver would choose.

#### Scenario: Semantic versions sort newest first
- **GIVEN** a library with the stored versions `1.9.0`, `1.10.0` and `2.0.0`
- **WHEN** its versions are listed
- **THEN** the order SHALL be `2.0.0`, `1.10.0`, `1.9.0`

#### Scenario: Partial versions sort by value, not by text
- **GIVEN** a library with the stored versions `1.20`, `5` and `2.0.0`
- **WHEN** its versions are listed
- **THEN** the order SHALL be `5`, `2.0.0`, `1.20`

#### Scenario: A prerelease sorts below its release
- **GIVEN** a library with the stored versions `2.0.0`, `2.0.0-beta` and `1.0.0`
- **WHEN** its versions are listed
- **THEN** the order SHALL be `2.0.0`, `2.0.0-beta`, `1.0.0`

#### Scenario: Unversioned sorts first and tags sort last
- **GIVEN** a library with unversioned documentation and the stored labels `1.0.0`, `stable` and `next`
- **WHEN** its versions are listed
- **THEN** unversioned SHALL appear first, then `1.0.0`, then `next` and `stable`

#### Scenario: Listing surfaces agree with the resolver
- **GIVEN** a library with the stored versions `1.9.0` and `1.10.0`
- **WHEN** its versions are listed in the web UI and resolved with no requested version
- **THEN** both SHALL identify `1.10.0` as the newest
