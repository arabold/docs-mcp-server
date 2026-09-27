# Spec Delta

## Purpose

Defines how a library is identified, and how its name is validated, matched and displayed. Also defines
when indexing may create a library or version and when it may replace existing documentation, so no
entry point overwrites indexed content unless the caller explicitly asks it to.

## ADDED Requirements

### Requirement: Library Identity

The system SHALL identify a library by its name, compared after removing surrounding whitespace and
applying the Unicode default lowercase mapping. Full case folding SHALL NOT be applied, so `Straße` and
`STRASSE` are different names. Two names that compare equal this way refer to the same library, and
every other requirement in this capability uses "the same library" in this sense.

Every operation that takes a library name SHALL reach the same library for any casing and padding of
its name. This covers indexing, refreshing, searching, listing versions (including the MCP versions
resource), removing, and web UI navigation. Two libraries SHALL NOT exist whose names compare equal.

A library exists while it holds at least one version, and removing its last version SHALL remove the
library. A version exists once the system lists it, including a version whose indexing is queued,
running, failed or was cancelled. Creating a library together with its first version, and removing a
library's last version, SHALL each take effect completely or not at all.

A library name SHALL be opaque. The system SHALL NOT interpret any character in a name as separating a
scope, an ecosystem, a language, a platform or a version, and SHALL NOT derive any other attribute of a
library from its name.

#### Scenario: Any casing reaches the same library
- **GIVEN** a library named `React`
- **WHEN** a caller searches, refreshes, lists versions of, or removes `react`, `REACT` or ` React `
- **THEN** each request SHALL act on the library named `React`

#### Scenario: All entry points resolve one library
- **WHEN** documentation for `Vue Router` is indexed under version `1.0.0` through the MCP scrape tool,
  under `2.0.0` through the CLI scrape command, under `3.0.0` through the web UI's "Add version" form,
  and under `4.0.0` through the pipeline API, each time with different casing
- **THEN** exactly one library SHALL exist, holding all four versions

#### Scenario: Separator-like characters are part of the name
- **WHEN** documentation is indexed with no version for the libraries `react@18`, `python/pandoc` and
  `@tanstack/query`
- **THEN** three libraries SHALL exist under exactly those names, each holding unversioned
  documentation
- **AND** no library named `react` or `pandoc`, and no version `18`, SHALL be created

#### Scenario: Removing the last version removes the library
- **GIVEN** a library whose only version is removed while no job is indexing it
- **WHEN** libraries are listed, and documentation is then indexed for the same library under a
  different casing of its name
- **THEN** the removed library SHALL NOT be listed
- **AND** a new library SHALL be created under the newly submitted display name

#### Scenario: A failed removal leaves the library intact
- **GIVEN** a library with a single version
- **WHEN** removing that version fails partway through
- **THEN** the library and the version SHALL still be listed, with their documentation searchable

#### Scenario: A leftover empty library does not survive the upgrade
- **GIVEN** a store from an earlier release that holds a library record with no versions, such as one
  left behind by refreshing the unknown library `Reakt`
- **WHEN** the system is upgraded and a user submits "Add library" for `Reakt`
- **THEN** the library SHALL be created

### Requirement: Library Display Name

Every library SHALL have a display name. For a newly created library it is the name its creator
submitted, with surrounding whitespace removed and case, inner spacing, punctuation and non-ASCII
characters preserved. The display name SHALL be set when the library is created, and later indexing,
refreshing or re-indexing SHALL NOT change it, whatever casing that request uses. Everywhere the
system presents a stored library SHALL show its display name. This includes library listings, page
titles, job listings and progress, error messages about an existing library, and library-not-found
suggestions.

A library indexed before this capability existed SHALL have a display name as soon as the system is
upgraded. The display name SHALL equal the name under which that library was listed before the
upgrade, with surrounding whitespace removed, and the library SHALL be reachable by that name.

#### Scenario: Casing and punctuation are preserved
- **WHEN** a library is created as `Next.js Docs`
- **THEN** library listings in the MCP tools, CLI and web UI SHALL show `Next.js Docs`

#### Scenario: Later requests do not rename the library
- **GIVEN** a library named `React`
- **WHEN** a new version is indexed, or an existing version is replaced, using the name `react`
- **THEN** the library SHALL still be shown as `React`
- **AND** the job for that request SHALL be shown under `React`

#### Scenario: Errors about an existing library use its display name
- **GIVEN** a library named `React` holding only the version `18.0.0` and no unversioned documentation
- **WHEN** a caller searches `react` at version `17.0.0`, or opens the web UI at `/libraries/react`
- **THEN** the version-not-found error, and the page title, SHALL name `React`

#### Scenario: Suggestions use display names
- **GIVEN** a library named `React`
- **WHEN** a caller searches documentation for the unknown library `Reakt`
- **THEN** the library-not-found error SHALL suggest `React`

#### Scenario: Existing libraries have a display name after upgrade
- **GIVEN** a store upgraded from a release that stored library names in lowercase, holding the library
  `react`
- **WHEN** libraries are listed after the upgrade, before anything is re-indexed
- **THEN** the library SHALL be listed with the display name `react`
- **AND** its versions and documentation SHALL be unchanged

#### Scenario: A padded legacy name becomes reachable
- **GIVEN** a store from an earlier release that holds a library stored as ` react ` and no library
  `react`
- **WHEN** the system is upgraded and a caller searches `react`
- **THEN** the search SHALL reach that library, and it SHALL be listed as `react`

### Requirement: Library Name Validation

When indexing would create a new library, the system SHALL remove surrounding whitespace from the
submitted name, and SHALL reject the name if the result:
- is empty,
- contains a control character (Unicode general category Cc, which includes tab and newline), or
- is longer than 100 characters, counted as Unicode code points.

A rejected request SHALL create nothing and SHALL report which rule the name broke. Any error that
repeats a library name, whether submitted or stored, SHALL show it with control characters escaped, so
that no raw control character reaches terminal output, logs or error responses. Spaces, punctuation,
non-ASCII letters and other non-control characters SHALL be accepted. The rules apply only to creating a
library. A library that already exists SHALL remain reachable under its stored name even when that name
breaks them. The exception is an empty stored name, which no entry point accepts as input.

#### Scenario: Blank names are rejected
- **WHEN** indexing is requested for a new library named `""` or `"   "`
- **THEN** the request SHALL fail with a validation error
- **AND** no library SHALL be created

#### Scenario: Control characters are rejected
- **WHEN** indexing is requested for a new library whose name contains a newline, a tab or an ESC
  character
- **THEN** the request SHALL fail with a validation error
- **AND** the error message SHALL contain the name with those characters escaped, and no raw control
  character

#### Scenario: The length limit is inclusive
- **WHEN** indexing is requested for new libraries whose names are 100 and 101 characters long
- **THEN** the 100-character name SHALL be accepted
- **AND** the 101-character name SHALL be rejected

#### Scenario: Descriptive names are accepted
- **WHEN** indexing is requested for new libraries named `Vue Router`, `C#`, `@tanstack/query` and
  `Über Lib`
- **THEN** each SHALL be created under that display name

#### Scenario: Existing names are not re-validated
- **GIVEN** a library that existed before these rules and whose name is longer than 100 characters
- **WHEN** a caller searches, refreshes or removes it by that name
- **THEN** the request SHALL reach the library

### Requirement: Indexing Does Not Overwrite Without Intent

A request to index documentation that would clear an existing version SHALL fail unless the caller
explicitly requests replacement. A failed request SHALL:
- leave that version's documentation, status and stored configuration untouched,
- not cancel any job already indexing it, and
- report the library by its display name, the version, and how to request replacement.

A request that names a library or version that does not yet exist SHALL create it. When replacement is
requested, the system SHALL rebuild an existing version from scratch, or create it if it does not
exist.

Indexing that appends to a version without clearing it is not an overwrite and SHALL NOT be rejected.
Refreshing a version and recovering an interrupted job both act on an existing version by definition,
and SHALL NOT be rejected under this rule.

Callers request replacement as follows:
- MCP `scrape_docs`: the `replace` argument, default `false`.
- CLI `scrape`: the `--replace` flag, default off.
- Web UI: "Edit & re-index" and job retry request replacement. "Add version" does not.
- Pipeline API: an explicit replace intent. The default is not to replace.

#### Scenario: Re-indexing an existing version without intent fails
- **GIVEN** the library `React` with an indexed unversioned bucket
- **WHEN** a caller scrapes `react` with no version and does not request replacement
- **THEN** the request SHALL fail, naming `React` and explaining how to replace
- **AND** the existing documentation SHALL remain searchable and unchanged

#### Scenario: Adding a new version to an existing library succeeds
- **GIVEN** the library `React` with the version `18.0.0`
- **WHEN** a caller scrapes `react` version `19.0.0` without requesting replacement
- **THEN** the library `React` SHALL gain the version `19.0.0`
- **AND** the version `18.0.0` SHALL be unchanged

#### Scenario: Replacement rebuilds an existing version
- **GIVEN** the library `React` with an indexed version `19.0.0`
- **WHEN** a caller scrapes `React` version `19.0.0` and requests replacement
- **THEN** the version SHALL be rebuilt from the new scrape

#### Scenario: Replacement of a missing version creates it
- **WHEN** a caller requests replacement for a library and version that do not exist
- **THEN** the library and version SHALL be created and indexed

#### Scenario: Refreshing an indexed version is not an overwrite
- **GIVEN** the library `React` with a completely indexed version `19.0.0`
- **WHEN** a caller refreshes `react` version `19.0.0` through the MCP tool, the CLI or the web UI
- **THEN** the refresh SHALL be accepted and SHALL update the version in place

#### Scenario: An in-flight job is not disturbed by a rejected request
- **GIVEN** a job currently indexing `React` version `19.0.0`
- **WHEN** a second request to index that version arrives without requesting replacement
- **THEN** the second request SHALL fail
- **AND** the first job SHALL continue unaffected

#### Scenario: A failed version still counts as existing
- **GIVEN** a version whose indexing failed and that the system lists with a failed status
- **WHEN** a caller scrapes that version without requesting replacement
- **THEN** the request SHALL fail
- **AND** retrying the failed job from the web UI SHALL succeed

#### Scenario: Appending is not an overwrite
- **GIVEN** an indexed version
- **WHEN** a caller indexes more documentation into it without clearing existing documents
- **THEN** the request SHALL be accepted and existing documentation retained

### Requirement: Explicit Library Creation

A request made explicitly to create a new library SHALL fail when the same library already exists,
whatever versions it holds. The web UI's "Add library" form makes this request. A failed request SHALL
create and modify nothing, and SHALL report the existing library by its display name. When several
requests race to create the same new library, exactly one SHALL succeed, and the others SHALL fail as
an existing library.

#### Scenario: Adding a library under an existing name fails
- **GIVEN** the library `React` holding only the version `18.0.0`
- **WHEN** a user submits "Add library" for `react` with version `19.0.0`
- **THEN** the request SHALL fail, naming the existing library `React`
- **AND** no version `19.0.0` SHALL be created

#### Scenario: Concurrent creation admits one winner
- **WHEN** two requests to create the new library `Svelte` are submitted at the same time
- **THEN** exactly one SHALL succeed
- **AND** the other SHALL fail as an existing library

### Requirement: Refresh Does Not Create Libraries

Refreshing a library or version that does not exist SHALL fail with a not-found error, and SHALL NOT
create a library or version.

#### Scenario: A mistyped refresh leaves no trace
- **WHEN** a caller refreshes the library `Reakt`, which does not exist
- **THEN** the request SHALL fail with a not-found error
- **AND** `Reakt` SHALL NOT appear in library listings
- **AND** a later "Add library" for `Reakt` SHALL succeed
