# Proposal

## Why

Version labels enter the store through several paths that validate them differently, and are read back
through a resolver that only understands strict semver. Labels written by one path are therefore
unreachable through another: documentation indexed as `latest` or `stable` is invisible to
`find_version`/`search_docs` (#475), and a partial version such as `1.20` written via the web UI was
equally unreachable (#480). No spec covers any of this, so the contract lives only in a 60-line method —
which is why two consecutive fixes to that method each introduced a regression.

## What Changes

- **Add a new `version-resolution` capability** covering the version lifecycle end to end: what a version
  label is, how it is normalized on write, how a request resolves to a stored label, and how the outcome
  surfaces through the MCP tools, CLI and web UI.
- **Unify the write path.** Every entry point (MCP `scrape_docs`, CLI `scrape`/`refresh`, web UI, raw
  tRPC) normalizes a label identically — trim, lowercase, empty means unversioned — and stores it
  verbatim. No validation, no coercion, no rejection beyond those two steps.
  - **BREAKING**: `ScrapeTool` and `RefreshVersionTool` no longer raise
    `Invalid version format for scraping: '<v>'. Use 'X.Y.Z', ...`. Labels such as `stable` become legal
    through MCP and the CLI, matching what the web UI already accepts.
  - **BREAKING**: `ScrapeTool` no longer coerces `1.20` to `1.20.0` before storing. A label is persisted
    as typed, so `1.20` and `1.20.0` are distinct buckets.
- **Introduce two tiers of label.** A *semantic version* participates in ordering, ranges and "latest".
  An *opaque tag* (`stable`, `latest`, `main`, anything not version-shaped) is matched literally and never
  coerced, ordered, or selected by a range.
- **Resolve literal matches before semver**, so a request for a stored label always returns that exact
  label — including a tag, and including `1.20` when both `1.20` and `1.20.0` are indexed.
- **Treat prereleases as ordinary versions.** Range and "latest" matching pass `includePrerelease`, so a
  prerelease is selected when it is the closest available match rather than being silently skipped.
  - **BREAKING**: `latest` over `[1.0.0, 2.0.0-beta]` now resolves to `2.0.0-beta` rather than `1.0.0`.
- **Resolve a tag-only library with no target** when exactly one tag exists; error listing the available
  labels when more than one does.

## Capabilities

### New Capabilities

- `version-resolution`: How library version labels are normalized and stored on write, classified as
  semantic versions or opaque tags, resolved against a requested version, and surfaced to callers —
  including prerelease ordering, the unversioned bucket, and the errors raised when nothing matches.

### Modified Capabilities

<!-- None. No existing capability covers version labels or their resolution; `search` specifies only
     chunk assembly and ranking. -->

## Impact

**Behavior**
- MCP `find_version`, `search_docs`, `scrape_docs`; CLI `find-version`, `scrape`, `refresh`, `search`;
  the web UI's version field and version tabs.
- Existing databases already contain labels written verbatim by the web UI. Reads stay tolerant of them,
  so no data migration is required and no schema change is needed — `versions.name` is already `TEXT`.

**Code**
- `src/store/DocumentManagementService.ts` — `findBestVersion`, `listVersions`, `normalizeVersion`
- `src/utils/version.ts` — `toVersionCandidate`, `VersionCandidate`, `sortVersionsDescending`
- `src/tools/ScrapeTool.ts`, `src/tools/RefreshVersionTool.ts` — duplicated write gates removed
- `src/tools/SearchTool.ts`, `src/tools/FindVersionTool.ts` — resolution outcome surfaced
- `src/pipeline/PipelineManager.ts`, `src/pipeline/trpc/router.ts`, `src/store/DocumentStore.ts` —
  single shared normalizer at the store boundary
- `src/store/DocumentStore.ts` — `queryLibraryVersions` ordering, which the web UI consumes unsorted

**Defects closed**
- #475 — documentation under a non-semver version is unreachable over MCP
- #480 — partial semver versions are permanently unmatchable
