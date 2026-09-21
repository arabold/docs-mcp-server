# Tasks

Test placement follows the repository's single-file policy: `src/foo.ts` ↔ `src/foo.test.ts`. Every
scenario in `specs/version-resolution/spec.md` must end up covered by a named test; group 8 checks that
none were missed.

## 1. Shared write-path normalization

- [x] 1.1 Extract `normalizeVersionLabel(version)` (trim, lowercase, empty means unversioned) into
      `src/store/types.ts` beside `normalizeVersionRef`, and reimplement `normalizeVersionRef` in terms of
      it; verify existing `src/store/types.test.ts` (or a new one) covers both and passes
- [x] 1.2 Call `normalizeVersionLabel` in `DocumentStore.resolveVersionId` in place of the inline
      `.toLowerCase()`; verify a label submitted as `" 1.0.0 "` resolves to the same version row as
      `1.0.0` in `src/store/DocumentStore.test.ts`
- [x] 1.3 Replace `DocumentManagementService.normalizeVersion` with `normalizeVersionLabel` so its six
      call sites trim as well as lowercase; verify `src/store/DocumentManagementService.test.ts` covers a
      whitespace-padded version reaching `exists`, `removeAllDocuments` and `searchStore` unchanged
- [x] 1.4 Route `PipelineManager.enqueueScrapeJob`, `enqueueRefreshJob` and `enqueueJobWithStoredOptions`
      through `normalizeVersionLabel` instead of `version ?? ""`; verify with a
      `src/pipeline/PipelineManager.test.ts` case that `"LATEST"` and `"latest"` enqueue onto one version

## 2. Remove the duplicated write gates

- [x] 2.1 Delete the semver validation/coercion block from `src/tools/ScrapeTool.ts` and pass the
      normalized label straight through; verify by replacing the `Invalid version format` assertion at
      `src/tools/ScrapeTool.test.ts:94` with one asserting `"stable"` is accepted and stored as `stable`
- [x] 2.2 Add a `ScrapeTool` test asserting `"1.20"` is stored verbatim and NOT rewritten to `1.20.0`
- [x] 2.3 Delete the identical block from `src/tools/RefreshVersionTool.ts`; verify its test file no
      longer expects `Invalid version format for refreshing` and that refreshing a tag-labelled version
      succeeds
- [x] 2.4 Confirm no `Invalid version format` string remains in `src/`; verify with a repo grep returning
      no matches

## 3. Two-tier label classification

- [x] 3.1 Extend `VersionCandidate` in `src/utils/version.ts` with a tier discriminator so
      `toVersionCandidate` returns a tag candidate instead of `null` for non-version labels, keeping the
      existing `PARTIAL_VERSION_PATTERN` gating; verify the accepted-forms scenarios pass
- [x] 3.2 Ensure an empty label still yields no candidate (unversioned is not a tag); verify with the
      classification test for `""`
- [x] 3.3 Update `listVersions` to return version-tier and tag-tier labels separately rather than
      filtering tags away; verify tags no longer disappear between the store and the resolver

## 4. Resolution ladder

- [x] 4.1 Implement rung 1, literal match on the normalized request against stored labels, ahead of all
      semantic matching in `findBestVersion`; verify the six Literal Label Resolution scenarios pass
- [x] 4.2 Remove `selectStoredVersion`, now superseded by rung 1 per design D4; verify the `1.20`/`1.20.0`
      coexistence scenarios still pass without it
- [x] 4.3 Pass `includePrerelease: true` to both `semver.maxSatisfying` calls; verify the twelve Semantic
      Version Resolution scenarios pass
- [x] 4.4 Implement rung 3, resolving a lone tag when no semantic version exists and raising
      `VersionNotFoundInStoreError` listing labels when several do; verify the three Tag-Only scenarios
- [x] 4.5 Ensure rungs 1–3 take precedence over the unversioned bucket so an indexed label is never
      silently skipped; verify the four Unversioned Documentation Resolution scenarios

## 5. Failure reporting

- [x] 5.1 Include opaque tags in the `availableVersions` carried by `VersionNotFoundInStoreError`; verify
      the "Available labels include tags" scenario
- [x] 5.2 Confirm an unknown library still raises `LibraryNotFoundInStoreError` with fuzzy suggestions
      ahead of any version handling; verify the corresponding scenario
- [x] 5.3 Confirm an unparseable request still reports unversioned availability rather than throwing;
      verify the corresponding scenario

## 6. Listing order

- [x] 6.1 Extend `compareVersionsDescending` to place unversioned first, semantic versions newest-first,
      then tags alphabetically, replacing the current reverse-string fallback; verify the five Version
      Listing Order scenarios in `src/utils/version.test.ts`
- [x] 6.2 Sort `listLibraries` output with that comparator in the service layer rather than relying on
      `queryLibraryVersions`'s lexicographic SQL order; verify `1.10.0` precedes `1.9.0`
- [x] 6.3 Confirm the web UI's default version selection (`LibraryDetail`, `VersionTabs`, `Search`) now
      lands on the newest version; verify with a component test or by driving the dev server

## 7. Surface consistency

- [x] 7.1 Pass `resolvedVersion` rather than the raw `version` into `findBestVersion` from
      `src/tools/SearchTool.ts` so the searched version matches what the log line reports; verify with a
      `SearchTool` test
- [x] 7.2 Confirm `search_docs` searches a resolved tag bucket rather than falling through to unversioned;
      verify with a `SearchTool` test reproducing issue #475 (`medusa` indexed only as `latest`)

## 8. Full scenario coverage

- [x] 8.1 Add a write-path parity E2E in `test/` asserting the same label submitted via `ScrapeTool`, the
      CLI, and the pipeline tRPC router lands in exactly one version row; verify it covers the
      "All entry points normalize identically" scenario
- [x] 8.2 Walk `specs/version-resolution/spec.md` end to end and confirm each of its 46 scenarios maps to
      a named test; verify by listing scenario → test name and closing any gap found
- [x] 8.3 Run `npm run lint`, `npm run typecheck` and `npm test`; verify all pass with no skipped tests in
      the touched files

## 9. Reconcile with PR #497

- [x] 9.1 Rebase or re-target PR [#497](https://github.com/arabold/docs-mcp-server/pull/497) onto this
      work, keeping its `toVersionCandidate` gating and dropping its `selectStoredVersion` tie-break;
      verify its regression tests still pass against the new ladder
- [x] 9.2 Update the PR description to note that #475 and #480 are both closed here; verify the linked
      issues reference the final change
