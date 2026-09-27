# Tasks

Tests follow the repository's single-file policy (`src/foo.ts` ↔ `src/foo.test.ts`). Anything that has
to hit real storage goes in `test/library-identity-e2e.test.ts` rather than in a test that mocks
`DocumentStore`. Every scenario in `specs/library-identity/spec.md` must end up covered by a named test;
task 8.4 checks that none were missed. Use Node 22 (`nvm use 22`) for every command.

## 1. Migration

- [x] 1.1 Add `db/migrations/017-add-library-display-name.sql` in two `@migration-step` blocks, following
      the step order in design.md:
      - prune versionless libraries;
      - re-key padded names unless the trimmed key exists;
      - defer foreign keys;
      - back up the rows and `sqlite_sequence`;
      - drop the table;
      - recreate it with `display_name TEXT NOT NULL`;
      - re-insert with `display_name` set to the trimmed name;
      - restore the sequence;
      - recreate `idx_libraries_lower_name` (second block);
      - reset `defer_foreign_keys`.

      Verify with a new `src/store/applyMigrations.test.ts` case. Simulate the pre-017 state the way the
      014 partition-key tests do: apply everything, recreate the old `libraries` shape, and delete the
      017 row from `_schema_migrations`. Seed libraries with versions and one library without, then
      re-run `applyMigrations`. Assert:
      - ids, `created_at` and version references are unchanged;
      - `display_name = name` for every kept row;
      - the versionless library is gone;
      - `PRAGMA foreign_key_check` is empty.
- [x] 1.2 Verify that the display name has no fallback path. In `applyMigrations.test.ts`, assert that
      `INSERT INTO libraries (name)` without `display_name` fails with `SQLITE_CONSTRAINT_NOTNULL` after
      migration, and that foreign-key enforcement is still active (deleting a referenced library fails).
- [x] 1.3 Verify sequence preservation. Seed and delete a library so `sqlite_sequence` exceeds `MAX(id)`,
      migrate, insert a new library, and assert that it receives an id above the old sequence value.
      Repeat with a table left empty by the prune.
- [x] 1.4 Verify rollback, as the `database-migrations` spec requires. Wrap the test database's `exec`
      so that it throws for the block containing `CREATE UNIQUE INDEX idx_libraries_lower_name`, which
      runs after the `DROP`. Assert that `applyMigrations` rejects, that the original `libraries` rows
      and shape survive, and that 017 is not recorded in `_schema_migrations`.
- [x] 1.5 Verify that an empty legacy name does not block the upgrade. Seed a library with `name = ''`
      and a version before 017, and assert that the migration succeeds and the row keeps
      `display_name = ''`.
- [x] 1.6 Verify that deferral does not leak. After 017 runs in `applyMigrations`, assert that `PRAGMA
      defer_foreign_keys` reads `0` on that connection.
- [x] 1.7 Verify the padded-key repair. Seed ` react ` (padded, alone), and both ` vue ` and `vue`, before
      017. Assert that:
      - ` react ` is re-keyed to `react` with the display name `react`;
      - the colliding ` vue ` row keeps its key;
      - `vue` is unchanged;
      - the migration succeeds.

## 2. Naming helpers and errors

- [x] 2.1 Add `ExistingTargetPolicy`, `normalizeLibraryDisplayName` and `describeLibraryNameProblem` to
      `src/store/types.ts`, and rewrite the `normalizeLibraryName` TSDoc to call it the lookup key.
      Verify with `src/store/types.test.ts` cases:
      - rejected: blank, whitespace-only, newline, tab, U+0085 (a Cc), and 101 code points;
      - accepted: exactly 100 code points, and an emoji ZWJ sequence (Cf is allowed);
      - accepted and returned trimmed and unchanged: `Vue Router`, `C#`, `@tanstack/query`, `Über Lib`;
      - `normalizeLibraryName("Straße") !== normalizeLibraryName("STRASSE")`.
- [x] 2.2 Add `LibraryAlreadyExistsError`, `VersionAlreadyExistsError` and `InvalidLibraryNameError` to
      `src/store/errors.ts`, with the per-error messages from the D10 table. Only
      `VersionAlreadyExistsError` names a version and the `--replace` / `replace: true` / refresh
      remedy, and it has an unversioned wording. Every name goes through the shared `quoteName()` /
      `escapeControlCharacters()` helpers, which also cover the existing not-found errors. Verify with
      message assertions for each error, including the unversioned case. Check that a name containing
      `\n`, `\t`, `\u001b`, U+007F and U+0085 produces a message with all of them escaped and no raw
      Unicode Cc character.

## 3. Store: display name, single creation path, claim and lookup

- [x] 3.1 Route every library insert in `DocumentStore` through one private creation helper. It writes
      `name = normalizeLibraryName(x)` and `display_name = normalizeLibraryDisplayName(x)`, and throws
      `InvalidLibraryNameError` for a *new* library whose name fails `describeLibraryNameProblem`. Verify
      in `src/store/DocumentStore.test.ts` that:
      - `resolveVersionId("Next.js Docs", "")` lists as `Next.js Docs`;
      - a second call with `next.js docs` returns the same version id and leaves the display name
        unchanged;
      - a blank or control-character name is rejected with nothing created;
      - `resolveVersionId("react@18", "")` and `resolveVersionId("python/pandoc", "")` create libraries
        under exactly those names, each with an unversioned version, and create neither a `react` nor a
        `pandoc` library;
      - library creation is atomic. Make the version insert throw (spy on the prepared statement) during
        `resolveVersionId("Atomic", "1.0.0")`, and assert that no `Atomic` library row remains.
- [x] 3.2 Switch the presenting statements (`queryLibraryVersions`, `getVersionsByStatus`,
      `getVersionsBySourceUrl`) to `l.display_name`, keeping `ORDER BY l.name`. Make `getLibrary()` return
      `{ id, name, displayName }`. Verify by extending "treats library names case-insensitively and reuses
      same library id" to assert the display name through `queryLibraryVersions()` and `getLibrary()`.
- [x] 3.3 Implement `DocumentStore.claimVersion(library, version, policy)` as one IMMEDIATE
      better-sqlite3 transaction with no `await` inside, mapping `SQLITE_CONSTRAINT_UNIQUE` to the
      already-exists errors (design D5). Verify with `DocumentStore.test.ts` cases for each policy against
      a missing library, a library without that version, and an existing version. For each rejection,
      also assert that the existing version's status, stored scraper options and documents are
      unchanged.
- [x] 3.4 Add the lookup-only `DocumentStore.findVersionId(library, version)`. Verify that it returns
      `null` for an unknown library and for an unknown version, and that neither call creates a row
      (compare `queryLibraryVersions()` before and after).
- [x] 3.5 Make `removeVersion()` run all of its deletes in one transaction: documents, pages, the version,
      and the library when that was its last version (design D3). Verify in `DocumentStore.test.ts`
      that:
      - removing a library's only version deletes the library row too (`getLibrary()` returns `null`);
      - a later `claimVersion()` under a different casing, with `reject-library`, succeeds and stores the
        new display name;
      - removal is atomic: make the library delete throw (spy on the prepared statement), and the
        version, its pages and its documents are all still present afterward (spec scenario "A failed
        removal leaves the library intact").
- [x] 3.6 In `DocumentManagementService`:
      - add the `claimVersion` and `findVersionId` passthroughs;
      - drop the `toLowerCase()` in `ensureLibraryAndVersion`, and make `ensureVersion` normalize only
        the version;
      - build `findBestVersion`'s `VersionNotFoundInStoreError` with the listed library's display name.

      Update the `getLibrary` mocks in `src/store/DocumentManagementService.test.ts` (~1109, ~1116,
      ~1181) to the new shape, and verify that the file passes. The display-name behavior is verified
      against real storage in 8.1.

## 4. Pipeline

- [x] 4.1 Add `EnqueueScrapeOptions` to `src/pipeline/trpc/interfaces.ts` and a fourth parameter to
      `IPipeline.enqueueScrapeJob`. In `PipelineManager`:
      - apply the default `"reject-version"`;
      - apply the D6 mapping for `clean === false`;
      - call `claimVersion` **before** duplicate cancellation;
      - set `job.library` to the claimed display name.

      Add `claimVersion`/`findVersionId` to every `mockStore` in `src/pipeline/PipelineManager.test.ts`
      (~118, 523, 987, 1036, 1089, 1138, 1201). Verify with cases:
      - a default enqueue whose claim rejects creates no job and cancels nothing;
      - a second default enqueue while the first is QUEUED rejects, and the first job stays QUEUED;
      - `replace` cancels and supersedes the in-flight job, as today;
      - `clean: false` claims with `replace`;
      - a job enqueued as `react` against the stored `React` reports `library === "React"`.
- [x] 4.2 Make both refresh routes lookup-only, and have them pass `{ onExisting: "replace" }`:
      - the completed-version route, whose `enqueueScrapeJob` call carries `isRefresh`;
      - `enqueueJobWithStoredOptions`.

      Both go through `DocumentManagementService.requireVersion()`, a lookup-only helper that returns
      the version id and the library's stored display name. The refresh errors and logs then name the
      library as stored. It throws `LibraryNotFoundInStoreError`, with suggestions, or
      `VersionNotFoundInStoreError` when the lookup misses. Switch the refresh tests (~665-954) from
      mocking `ensureVersion` to mocking `requireVersion`. Verify that:
      - refreshing a completed version enqueues with `onExisting: "replace"`;
      - the not-completed fall-back does the same;
      - refreshing an unknown library throws and never calls a creating store method;
      - the recovery tests ("should use enqueueRefreshJob for recovery", "should mark job as FAILED when
        recovery fails") still pass.
- [x] 4.3 In `src/pipeline/trpc/router.ts`, add `onExisting: z.enum([...]).optional()` to
      `enqueueScrapeInput`. Map the errors to `TRPCError`, keeping the message:
      - the two already-exists errors → `CONFLICT`;
      - `InvalidLibraryNameError` → `BAD_REQUEST`;
      - the not-found errors from `enqueueRefreshJob` → `NOT_FOUND`;
      - an incoming `TRPCError` passes through unchanged.

      Verify in `src/pipeline/trpc/router.test.ts` with `createPipelineRouter(...).createCaller` that:
      - each mapping yields its code and the original message;
      - an omitted `onExisting` behaves as `reject-version`;
      - a pipeline that throws a `TRPCError` keeps its code.
- [x] 4.4 Make `PipelineClient` forward `onExisting`. For a `TRPCClientError` whose `data.code` is
      `CONFLICT`, `BAD_REQUEST` or `NOT_FOUND`, `enqueueScrapeJob` and `enqueueRefreshJob` rethrow
      `new TRPCError({ code, message })` with the unprefixed message; other failures keep the "Failed to
      enqueue …" wrap. Verify in `src/pipeline/PipelineClient.test.ts` that:
      - `onExisting` is sent;
      - a mocked `CONFLICT` client error surfaces as a `TRPCError` with code `CONFLICT` and the original
        message;
      - a network error is still wrapped.

## 5. MCP, CLI and tools

- [x] 5.1 Add `replace?: boolean` to `ScrapeToolOptions`. Pass `{ onExisting: "replace" }` when it is
      true, and pass no `onExisting` otherwise, so the default stays in `PipelineManager` (D4). Verify in
      `src/tools/ScrapeTool.test.ts`:
      - the fourth argument is `{ onExisting: "replace" }` with `replace: true`;
      - it is undefined or has no `onExisting` without it;
      - `replace` never appears in the `ScraperOptions` object.
- [x] 5.2 Add the `--replace` boolean option (default `false`) to `src/cli/commands/scrape.ts` and pass it
      to `ScrapeTool`. Mention it in the usage text next to `--clean`. Verify in
      `src/cli/commands/scrape.test.ts` that `--replace` reaches `ScrapeTool.execute`, and that it is
      `false` by default.
- [x] 5.3 Add the `replace` argument (`z.boolean().optional().default(false)`, described as rebuilding an
      existing version) to `scrape_docs` in `src/mcp/mcpServer.ts`. Update the tool description: an
      existing version is rejected unless `replace` is true, and `refresh_version` updates it in place.
      Verify in `src/mcp/mcpServer.test.ts` that `replace: true` reaches `ScrapeTool`, and that a conflict
      comes back as a tool error whose text contains the remedy.
- [x] 5.4 Make the `docs://libraries/{library}/versions` resource `decodeURIComponent` its variable and
      compare with `normalizeLibraryName` on both sides. Verify in `mcpServer.test.ts` that, with `React`
      and `@tanstack/query` listed, reading `docs://libraries/react/versions` and
      `docs://libraries/%40tanstack%2Fquery/versions` returns their versions.
- [x] 5.5 In `src/tools/SearchTool.ts`, compare with `normalizeLibraryName` in the available-versions
      lookup, and build the `VersionNotFoundInStoreError` with the listed library's display name. Verify
      in `src/tools/SearchTool.test.ts` that searching `react` at an unresolvable version, with `React`
      listed, reports `React` together with its available versions.

## 6. Web UI

The web client has no component-test harness, so each task here is verified in the browser preview
against the dev server.

- [x] 6.1 In `AddEditDocumentationDrawer.tsx`, pass `onExisting` per form (design D4):
      - `add` without `library` → `reject-library`;
      - `add` with `library` → omit;
      - `edit` → `replace`.

      Verify in the preview by reading the `enqueueScrapeJob` request payload for each mode through the
      network log.
- [x] 6.2 Add inline pre-checks to the drawer, and disable submit while any of them applies:
      - "Add library": an existing name, compared with `normalizeLibraryName`. The hint names the stored
        display name and links to `/libraries/<encoded display name>`.
      - "Add version": an existing version, matched with the existing `findVersion()`.
      - A new name: the `describeLibraryNameProblem` message.

      Verify each hint and the disabled state in the preview. Also verify that a server-side conflict
      still surfaces through the existing error toast; force it by submitting through `javascript_tool`
      while the pre-check is bypassed.
- [x] 6.3 Make `Jobs.tsx` `handleRetry` pass `{ onExisting: "replace" }`. Verify in the preview that
      retrying a failed job re-queues it, with no conflict (spec scenario "A failed version still counts
      as existing").
- [x] 6.4 Match the route parameter in `LibraryDetail.tsx` with `normalizeLibraryName`. Title
      `Topbar.tsx` with the listed display name, and drop its `decodeURIComponent()`, since React Router v7
      already decodes the parameter (design D12). Verify in the preview that:
      - `/libraries/react` and `/libraries/React` both open the `React` library, and the header and Topbar
        show `React`;
      - libraries named `@tanstack/query` and `100% Docs`, opened from the Libraries list, show their
        exact names;
      - the console reports no `URIError`.

## 7. Existing tests affected by the new default

- [x] 7.1 Update the raw `INSERT INTO libraries (name)` statements that run after all migrations
      (`applyMigrations.test.ts:202,257,378,484,604,812`, `DocumentStore.test.ts:2613`) to supply
      `display_name`. Verify that both files pass.
- [x] 7.2 In `PipelineManager.test.ts`, change "should normalize version labels so entry points share one
      bucket" and "should normalize library names so entry points share one bucket" to enqueue the second
      job with `{ onExisting: "replace" }`, keeping their cancellation assertions. Verify that the file
      passes.
- [x] 7.3 In `test/version-resolution-e2e.test.ts`, make every case that enqueues the same bucket twice
      request replacement, or seed it with distinct libraries, so the label-normalization assertions are
      unchanged. Verify that the suite passes.

## 8. End-to-end coverage

- [x] 8.1 Add `test/library-identity-e2e.test.ts`, against a real SQLite store and `PipelineManager`
      (follow the setup in `test/version-resolution-e2e.test.ts`). Seed documents and pages through the
      store where a case needs indexed content. Cover:
      - **Case-insensitive reach.** Indexing, search, refresh, remove, `ListLibrariesTool` and the MCP
        versions resource all reach `React` via `react`, `REACT` and ` React `.
      - **Entry points.** ScrapeTool, the tRPC caller and the pipeline API, each with a different
        version and casing, produce one library holding every version.
      - **Opaque names.** `react@18`, `python/pandoc` and `@tanstack/query`, scraped with no version,
        list as three unversioned libraries, and no library `react` and no version `18` appears.
      - **Display name.** It is shown by `ListLibrariesTool`, `ListJobsTool` and job info.
        `ensureVersion({ library: "React" })` lists `React`. The version-not-found and
        library-not-found errors name `React`.
      - **Overwrite rules.**
        - default rejection, with documents left intact;
        - a new version added to an existing library;
        - replace rebuilds an existing version, and replace of a missing version creates it;
        - appending is accepted;
        - refreshing a completed version is accepted.
      - **Removal.** Removing the last version removes the library and frees it for a new display name.
      - **"Add library".** `reject-library` is rejected for an existing name in any casing.
      - **Arbitration** lives in `DocumentStore.test.ts`, next to `claimVersion`. Two `DocumentStore`
        instances, each with its own connection to one temp database file, both claim `Svelte` with
        `reject-library`. Exactly one succeeds and the other raises `LibraryAlreadyExistsError`, which
        shows the database decides and not process state (design D5).
      - **Refresh.** A mistyped refresh leaves no library behind.
      - **Upgrade.** A padded legacy ` react ` becomes reachable as `react`.

      Keep each case well under 3s, since CI runs about 4x slower. Verify with `npx vitest run
      test/library-identity-e2e.test.ts`, and also run `test/refresh-pipeline-e2e.test.ts` to confirm
      that refresh still works end to end.
- [x] 8.2 Drive the real CLI and MCP surfaces with no embedding provider configured, which is FTS-only
      mode:
      - **CLI.** In `test/cli-e2e.test.ts`, seed the version in-process against a temp `--store-path`
        (saving a CLI process), then run `scrape <lib> file://…/test/fixtures/html.html`. It exits
        non-zero with `--replace` in its output. A second run with `--replace` succeeds.
      - **MCP.** In `test/mcp-stdio-e2e.test.ts`, call `scrape_docs` twice for the same library and no
        version on the spawned server. The second call returns a tool error naming `replace: true`.

      The web UI's path is the tRPC caller, which 8.1 covers, together with the preview checks in
      group 6. Verify that both suites pass, and that each new case stays under the suite's timeout.
- [x] 8.3 Add the new suite to the Test Inventory table in `AGENTS.md`: in the default `npm test` run,
      with no requirements. Update the `cli-e2e` and `mcp-stdio-e2e` rows to mention the overwrite checks.
      Verify that the rows follow the table format.
- [x] 8.4 Walk every scenario in `specs/library-identity/spec.md` and note in the PR description the
      test, or the preview check, that covers it. Verify that no scenario is left uncovered. For the
      entry-points scenario, map each surface to where it is verified:
      - CLI and MCP → 8.2;
      - web UI → 6.1 plus the 8.1 tRPC case;
      - pipeline API → 8.1.

## 9. Documentation

- [x] 9.1 Update the Libraries Table section of `docs/concepts/data-storage.md`:
      - `name` is the lookup key (trimmed, lowercased);
      - `display_name` is the trimmed name as entered;
      - a library record exists only while it holds a version;
      - drop the nonexistent `updated_at`;
      - list migration `017` alongside `008`;
      - in the storage flow, state that library creation and the overwrite check happen in one step.

      Verify against `PRAGMA table_info(libraries)` on a migrated database.
- [x] 9.2 Document `--replace` in `README.md`, `docs/guides/basic-usage.md` and the `docs-manage` agent
      skill (`skills/docs-manage/SKILL.md`, whose `--clean` note described the old overwrite): re-indexing
      requires `--replace` or `refresh`, and `--no-clean` appends. Document `scrape_docs`'s `replace`
      argument next to the existing `preserveHashes` note in `README.md`. Verify that each documented
      command matches the `scrape --help` output.
- [x] 9.3 Add a short "Library names" note to `docs/guides/basic-usage.md`:
      - names keep the casing entered and are matched case-insensitively;
      - "Add library" refuses an existing name;
      - the name rules;
      - no character carries meaning, so write `--version 18` rather than `react@18`.

      Verify the stated rules against `describeLibraryNameProblem`.
- [x] 9.4 In `docs/infrastructure/deployment-modes.md`, state that the worker must be upgraded together
      with, or before, its coordinators. Verify that the note sits in the coordinator/worker section.

## 10. Final verification

- [x] 10.1 Run `npm run lint`, `rm -f .tsbuildinfo && npm run typecheck`, and `npm test`, and verify that
      all three pass. The typecheck must run cold, because the incremental cache hides errors CI catches.
- [x] 10.2 Run `openspec validate define-library-identity --strict` and verify that it reports the change
      as valid.
