## ADDED Requirements

### Requirement: Opt-in gitignore filtering for local directories

The scraper SHALL accept a `respectGitignore` option on `ScraperOptions`, defaulting to disabled. When disabled, local directory crawls SHALL behave exactly as they did before the option existed. When enabled, the scraper SHALL skip files and directories matched by the applicable `.gitignore` rules. The option SHALL have no effect on non-`file://` sources, and SHALL have no effect when the crawl root is a single file rather than a directory.

#### Scenario: Option disabled indexes ignored files
- **WHEN** a local directory containing a `.gitignore` that lists `ignored.md` is crawled without `respectGitignore`
- **THEN** the system SHALL index `ignored.md`

#### Scenario: Option enabled skips ignored files
- **WHEN** the same directory is crawled with `respectGitignore` enabled
- **THEN** the system SHALL NOT index `ignored.md`

#### Scenario: Option is inert for a single-file crawl root
- **WHEN** a `file://` URL pointing at a single file is crawled with `respectGitignore` enabled
- **THEN** the system SHALL index that file

### Requirement: Rules are scoped to the indexed folder

The scraper SHALL evaluate only `.gitignore` files located at or below the indexed folder. It SHALL NOT read `.gitignore` files in ancestor directories, `.git/info/exclude`, or global Git excludes. When the indexed folder is below a Git repository root, the scraper SHALL log a warning identifying that repository root.

#### Scenario: Ancestor rules are not applied
- **WHEN** a repository at `/repo` has a `.gitignore` listing `secrets.md`
- **AND** `/repo/docs` is crawled with `respectGitignore` enabled
- **AND** `/repo/docs/secrets.md` exists
- **THEN** the system SHALL index `/repo/docs/secrets.md`
- **AND** the system SHALL log a warning naming `/repo` as the containing repository

#### Scenario: No warning when the indexed folder is the repository root
- **WHEN** `/repo` itself is crawled with `respectGitignore` enabled
- **THEN** the system SHALL NOT log a containing-repository warning

### Requirement: Git precedence for nested rules

The scraper SHALL apply nested `.gitignore` files with Git's precedence. Rules in a subdirectory SHALL override inherited rules for paths under that subdirectory, negations SHALL re-include otherwise-ignored paths, and patterns SHALL be anchored relative to the directory of the `.gitignore` that declares them. A path excluded because an ancestor directory is excluded SHALL NOT be re-includable by a later negation, matching Git.

#### Scenario: Nested negation re-includes a file
- **WHEN** the root `.gitignore` contains `*.generated.md`
- **AND** `nested/.gitignore` contains `!keep.generated.md`
- **THEN** the system SHALL skip `nested/drop.generated.md`
- **AND** the system SHALL index `nested/keep.generated.md`

#### Scenario: Anchored nested pattern applies only to its own directory
- **WHEN** `nested/.gitignore` contains `/only-here.md`
- **THEN** the system SHALL skip `nested/only-here.md`
- **AND** the system SHALL index `nested/deeper/only-here.md`

#### Scenario: Excluded directory cannot be re-included from within
- **WHEN** the root `.gitignore` contains `build/`
- **AND** `build/.gitignore` contains `!keep.md`
- **THEN** the system SHALL skip `build/keep.md`

#### Scenario: Directory-only rule does not match a file
- **WHEN** the root `.gitignore` contains `artifact.md/`
- **AND** both a file `artifact.md` and a directory `nested/artifact.md/` exist
- **THEN** the system SHALL index the file `artifact.md`
- **AND** the system SHALL skip everything under `nested/artifact.md/`

### Requirement: Ignored directories are pruned

The scraper SHALL prune ignored directories during traversal rather than descending into them and filtering their contents.

#### Scenario: Ignored directory is not descended into
- **WHEN** the root `.gitignore` contains `build/`
- **AND** `build/` contains files
- **THEN** the system SHALL NOT enumerate or index any path under `build/`

### Requirement: Repository metadata is never indexed

The scraper SHALL treat `.git` and every path beneath it as ignored whenever `respectGitignore` is enabled, regardless of the configured hidden-file behavior. No `.gitignore` rule, including a negation, SHALL re-include it.

#### Scenario: .git is skipped even when hidden files are indexed
- **WHEN** a directory is crawled with `respectGitignore` enabled and hidden files included
- **THEN** the system SHALL NOT index any path under `.git/`

#### Scenario: A negation cannot re-include .git
- **WHEN** the root `.gitignore` contains `!.git` and `!.git/**`
- **THEN** the system SHALL still skip every path under `.git/`

#### Scenario: Similarly named paths are unaffected
- **WHEN** the crawled directory contains `.github/` and `not.git/`
- **THEN** the system SHALL index their contents normally

### Requirement: Symlink rules follow Git's file semantics

The scraper SHALL test a symlink against path rules before resolving its target, so that a gitignored link is skipped without the target being touched. A directory-only rule SHALL apply to a symlink only when the link resolves to a directory and the security policy permits following symlinks.

#### Scenario: Path rule skips a link without resolving it
- **WHEN** the root `.gitignore` contains `ignored-link`
- **AND** `ignored-link` is a symlink to a directory
- **THEN** the system SHALL skip the link without resolving its target

#### Scenario: Directory-only rule applies to a symlinked directory
- **WHEN** the root `.gitignore` contains `ignored-link/`
- **AND** `ignored-link` is a symlink to a directory
- **THEN** the system SHALL skip the link

#### Scenario: Directory-only rule does not apply to a symlinked file
- **WHEN** the root `.gitignore` contains `notes.md/`
- **AND** `notes.md` is a symlink to a file
- **THEN** the system SHALL index the link

### Requirement: Newly ignored pages are removed on refresh

When a refresh runs with `respectGitignore` enabled, the scraper SHALL report previously indexed pages that are now ignored as deleted, so they are removed from the index. This SHALL apply to archive members, for which the physical archive path determines the outcome. A path that is ignored and was never indexed SHALL contribute no content and SHALL NOT count toward the page budget.

#### Scenario: Previously indexed file becomes ignored
- **WHEN** a refresh processes an indexed page whose path is now matched by `.gitignore`
- **THEN** the system SHALL report that page as deleted

#### Scenario: Archive members follow their archive
- **WHEN** a refresh processes an indexed page inside `archive.zip`
- **AND** `.gitignore` now matches `archive.zip`
- **THEN** the system SHALL report that page as deleted

### Requirement: Traversal tolerates unreadable entries

An entry that cannot be inspected while filtering is active SHALL be skipped rather than failing its containing directory or the job.

#### Scenario: Unreadable directory entry is skipped
- **WHEN** a directory listing succeeds but one entry cannot be stat'ed
- **THEN** the system SHALL skip that entry
- **AND** the system SHALL index the directory's remaining entries

### Requirement: The option persists with the version

The scraper SHALL store `respectGitignore` with the version's scraper options, and refresh and re-index jobs SHALL reuse the stored value.

#### Scenario: Refresh reuses the stored option
- **WHEN** a version was indexed with `respectGitignore` enabled
- **AND** a refresh job is enqueued for that version
- **THEN** the refresh SHALL run with `respectGitignore` enabled
