# Design

## Context

See proposal.md (Why). The current state that shapes the approach:

**Schema and lookups**
- `libraries` has `id`, `name TEXT NOT NULL UNIQUE` and `created_at`, plus the expression index
  `idx_libraries_lower_name` from migration 008. `name` holds `normalizeLibraryName()` output (trim, then
  JS `toLowerCase()`).
- Twelve prepared statements in `DocumentStore` match `l.name = ?` against that normalized value, plus
  `getLibraryIdByName` and two ad-hoc queries.
- SQLite's built-in `LOWER()` and `COLLATE NOCASE` fold ASCII only. The JS-computed key is the only
  place `Über` and `über` become the same library.
- Every SQLite-era writer has lowercased with JS `toLowerCase()` before inserting. This goes back to
  the first SQLite store (`7899231`, before v1.0.0). It covers `documents.library` before migration
  002, and `libraries.name` from 002 until 008. Migration 008's SQL `LOWER()` therefore changed no
  non-ASCII key: every stored key already equals its JS lowercase form. Keys were **not** always
  trimmed, though. Trimming arrived with `normalizeLibraryName()`, so an older, padded key such as
  `" react "` is unreachable today.
- `queryLibraryVersions` selects `FROM versions JOIN libraries`, so a library with no versions is never
  listed. `DocumentStore.removeVersion()` deletes the library together with its last version; every
  caller passes `removeLibraryIfEmpty = true`.

**Row creation**
- Rows are created as a side effect. `DocumentStore.resolveVersionId()` runs `INSERT … ON CONFLICT DO
  NOTHING` for both the library and the version. It is reached from:
  - `ensureLibraryAndVersion()`, which also lowercases the name;
  - `ensureVersion()`, which lowercases through `normalizeVersionRef()`;
  - `addDocuments()` and `addEmptyPage()` during a scrape.
- `PipelineManager.updateJobStatus()` calls `ensureLibraryAndVersion()` on **every** status change, and
  catches and logs every store error. A check placed there could never reject a request.
- Neither creation nor removal is atomic today:
  - `resolveVersionId()` commits the library insert and the version insert as separate statements
    (`DocumentStore.ts:1333-1345`).
  - `removeVersion()` deletes documents, pages, the version and the now-empty library in separate
    statements, with an `await` between them (`DocumentStore.ts:2233-2256`).

  An error or a process exit in between can leave a library record with no versions.

**Enqueue and refresh**
- `PipelineManager.enqueueScrapeJob()` cancels any QUEUED/RUNNING job for the same bucket.
  `PipelineWorker` then clears the bucket unless `clean === false` or `isRefresh` is set.
- Refreshing a completed version ends in `enqueueScrapeJob(library, version, scraperOptions)` with
  `isRefresh: true` (`PipelineManager.ts:426`). Refreshing an incomplete version goes through
  `enqueueJobWithStoredOptions()`. Both paths call `ensureVersion()`.
- Refreshing an unknown name therefore creates an empty library and a `not_indexed` version. The new
  version takes the stored-options fall-back, which fails with "No stored scraper options found" and
  leaves the empty records behind. They are unlisted, but their `name` is taken.
- `ScraperOptions` (minus runtime fields) is persisted to `versions.scraper_options` and replayed by
  "Edit & re-index", retry and the refresh fall-backs.

**Remote workers**
- `PipelineClient.enqueueScrapeJob` and `enqueueRefreshJob` rewrap every error as a plain
  `Error("Failed to enqueue …: <message>")`, which discards the tRPC error code.
- The pipeline router's input schemas are plain `z.object`s, so unknown keys are stripped silently.

**Name handling outside the store**
- The MCP versions resource compares with `===` (`mcpServer.ts:606`). Its template variable arrives
  percent-encoded, and it does not match at all for a name containing `/`.
- `SearchTool` compares with `===` when it lists available versions (`SearchTool.ts:73`).
- `LibraryDetail` matches the route parameter with `toLowerCase()`.
- `Topbar` titles the page with the decoded route parameter.
- `VersionNotFoundInStoreError` is built from the caller's input (`DocumentManagementService.ts:447`,
  `SearchTool.ts:77`).

**Migrations**
- Migrations are SQL-only, and all pending migrations run together in one IMMEDIATE transaction
  (`applyMigrations.ts:197-254`).
- better-sqlite3 is compiled with foreign keys **on** by default (verified: `PRAGMA foreign_keys` reads
  `1` on a fresh connection). `foreign_keys` cannot be changed inside a transaction.
- On a fully migrated database, `versions.library_id` is the only foreign key into `libraries`. No
  trigger or view references the table, and `documents_vec` stores library ids as plain values.

## Goals / Non-Goals

**Goals:**
- One chokepoint for library creation, which writes the display name and validates new names.
- The display name is present on every row from the moment the migration commits. It is enforced by the
  schema, with no read-time fallback anywhere.
- A library record exists exactly when the library is listed, meaning it holds at least one version.
- Conflict rejection is atomic across concurrent requests and across processes sharing one database
  file, and it survives the trip through a remote worker.

**Non-Goals:**
- Renaming a library or editing its display name after creation.
- Recovering the original casing of existing libraries, which were lowercased on write. It is not stored anywhere:
  `storeScraperOptions()` strips `library` before persisting.
- Changing the lookup key. It stays trim + `toLowerCase()`, with no Unicode normalization, whitespace
  collapsing or slugging.
- Case-preserving version labels. `version-resolution` keeps lowercasing them.
- Language or platform scoping (#168, #436). D11 covers how this change stays compatible with it.
- Hardening mid-run edge cases, which are accepted (see Risks):
  - removing a version while its job runs;
  - an append cancelling a running rebuild.

## Decisions

### D1 — Add `display_name`; keep `name` as the lookup key

`name` keeps its current meaning and values, and a new `display_name` holds the trimmed name as
entered. Every existing `l.name = ?` statement stays correct unchanged. Only statements that
*present* a library switch to `display_name`.

*Alternatives:*
- Case-preserving `name` matched with `LOWER(l.name) = ?`. This touches every query, and the ASCII-only
  `LOWER()` would let `Über`/`über` bypass uniqueness and miss on lookup.
- `COLLATE NOCASE`. It is also ASCII-only, and it needs a table rebuild anyway.

### D2 — Leave key normalization exactly as it is, and pin what it means

The spec's comparison, "Unicode default lowercase mapping without full case folding", is exactly
`String.prototype.toLowerCase()`. That is why `Straße` and `STRASSE` stay distinct. Any stricter key
rule (case folding, NFC/NFKC, collapsing inner whitespace) would have to be re-applied to existing
keys. An SQL-only migration cannot run the JS normalizer, so existing libraries would become
unreachable. Slugging punctuation would collide `C`, `C#` and `C++`.

For new names, the validator rejects control characters instead (`/\p{Cc}/u`: tab, newline and other
C0/C1 controls), which removes the tab/newline variants without re-keying anything. Format characters
(`Cf`) stay allowed, because emoji sequences rely on the zero-width joiner.

### D3 — Populate `display_name` in the migration that creates it, make it `NOT NULL`, and prune empty libraries

This follows the maintainer's direction that there are no fallbacks. The migration that introduces the
column fills it from `name` for every row. The column is `NOT NULL`, so no reader ever needs
`COALESCE(display_name, name)`, and a write path that forgets the column fails loudly instead of storing
a hole.

SQLite cannot `ADD COLUMN … NOT NULL` without a non-null `DEFAULT`, and `DEFAULT ''` would be exactly
the silent fallback being ruled out. The migration therefore rebuilds `libraries`. The table holds one
row per library, so the rebuild is cheap.

The rebuild has to work with foreign keys enabled (see Context), so it uses `PRAGMA
defer_foreign_keys = ON`. The step order matters. Deferred-FK violations from the `DROP` are balanced
only by inserting the parent rows *after* the drop. A prototype that filled a copy and renamed it into
place failed at commit with `SQLITE_CONSTRAINT_FOREIGNKEY`. The backup, drop, recreate and re-insert
order committed cleanly, with `foreign_key_check` empty and enforcement still active afterward.

The migration turns `defer_foreign_keys` off again at the end. The pragma would otherwise stay in effect
for any later migration applied in the same run, because the runner uses a single transaction.

Before the rebuild, the migration deletes library records that hold no versions. They are never listed,
hold no documentation (documents reach a library only through its versions), and would otherwise block
`reject-library` for their name.

After 017, the invariant "a library record has at least one version" holds only if both creation and
removal are atomic, so the change makes both of them single transactions:
- `claimVersion()` and `resolveVersionId()` each insert the library and its version in one
  transaction.
- `removeVersion()` runs all of its deletes in one transaction: documents, pages, the version, and the
  library when that was its last version. Its async signature stays, but no `await` falls inside the
  transaction.

A failure at any point rolls back the whole operation, so a versionless library can no longer be left
behind.

The migration also re-keys padded legacy names (see Context): `name` becomes the name with surrounding
whitespace removed, unless that trimmed key already exists. The display name is filled from the trimmed
value. "Whitespace" is exactly the set `String.prototype.trim()` removes, spelled out as code points in
a temp table the migration's `trim()` calls share (tab, LF, VT, FF, CR, space, NBSP, U+1680,
U+2000–U+200A, U+2028, U+2029, U+202F, U+205F, U+3000, BOM). A narrower SQL set would leave keys that
the lookup key's trim still reaches past, so they would stay unreachable.

There is no `CHECK (display_name <> '')`. Older releases accepted an empty name through MCP (`z.string()
.trim()` without a length check), so such a row would abort the migration and block startup.

*Alternatives:*
- Nullable column plus backfill. No structural guarantee, so fallbacks creep back in.
- Nullable column plus triggers that raise on NULL. It works, but it hides a constraint in triggers.
- Treat a versionless library as absent in `claimVersion()`. This keeps a second definition of "exists"
  alive in code instead of removing the data that needs it.

### D4 — The overwrite intent is a separate enqueue argument, never a `ScraperOptions` field

```ts
/** What indexing does when its target library or version already exists. */
export type ExistingTargetPolicy = "reject-library" | "reject-version" | "replace";
```

`ScraperOptions` is persisted and replayed (see Context), so an intent stored there would leak into
prefilled forms and replays. Keeping it as a fourth argument makes it per-request by construction. The
default, `"reject-version"`, is applied in exactly one place, `PipelineManager.enqueueScrapeJob()`, so a
tRPC caller that omits it gets the safe behavior. Callers either pass an explicit policy or omit it.
They never restate the default: `ScrapeTool` passes `"replace"` or nothing.

*Alternatives:*
- Two booleans (`replace`, `newLibrary`). This allows the contradictory `true/true` combination.
- Three procedures (create library, add version, re-index). This triples the pipeline and tRPC surface
  for one field of difference.

Entry-point mapping:

| Caller | Policy |
|---|---|
| MCP `scrape_docs` / CLI `scrape` (default) | omitted → `reject-version` |
| MCP `replace: true` / CLI `--replace` | `replace` |
| Web "Add library" (drawer `add`, no `library`) | `reject-library` |
| Web "Add version" (drawer `add` with `library`) | omitted → `reject-version` |
| Web "Edit & re-index" (drawer `edit`), Jobs "Retry" | `replace` |
| `enqueueRefreshJob()`, completed version (`isRefresh`) | `replace` |
| `enqueueJobWithStoredOptions()` (refresh fall-back, recovery) | `replace` |

### D5 — Claim the target atomically in the store before touching jobs

`DocumentStore.claimVersion()` creates or verifies the library and version in one IMMEDIATE transaction,
with no `await` inside it:
- `reject-library` runs a plain `INSERT` into `libraries`.
- `reject-version` inserts the library if it is missing, then runs a plain `INSERT` into `versions`.
- `replace` keeps today's insert-or-ignore behavior for both.

A `SQLITE_CONSTRAINT_UNIQUE` from a plain insert is mapped to the matching `*AlreadyExistsError`.
The unique indexes are the arbiter, so two web submits, or a CLI process racing the server on the same
file, cannot both win. Because of the D3 invariant, a library row that blocks the insert is always a
listed library, so the spec's single definition of "exists" is exactly what the constraint enforces.

What the tests must prove is that the *database* decides, not process state. They show this by claiming
through two `DocumentStore` instances, each with its own connection to the same file.

Racing two claims inside one process would prove nothing. better-sqlite3 runs each transaction
synchronously, so `Promise.allSettled` in one process never interleaves them. Interleaving across
processes is ruled out by the IMMEDIATE transaction (SQLite's single-writer lock). That is SQLite's
guarantee, not behavior of ours to re-test.

The claim runs **before** duplicate-job cancellation. Otherwise a rejected request would already have
cancelled the job it conflicts with. In-flight jobs need no separate check: their version row is
written at enqueue time, so the claim sees them as existing.

*Alternative:* check first, then insert. This races across the awaits in `enqueueScrapeJob()`, and it
cannot live in `updateJobStatus()` because that method swallows errors.

### D6 — Appending (`clean: false`) is not an overwrite

When `options.clean === false`, `PipelineManager` claims with `replace` in place of `reject-version`. The
library is still created and validated if it is new. `reject-library` is never relaxed. Requiring
`--replace --no-clean` would read as a contradiction for a request that replaces nothing.

Because the append runs as `replace`, it also cancels an in-flight job for the same version, as appends
do today. This is accepted (see Non-Goals).

### D7 — Refresh and stored-option re-scrapes look up; they never create

`enqueueRefreshJob()` and `enqueueJobWithStoredOptions()` call a new lookup-only `findVersionId()`. When
it returns nothing, they throw:
- `LibraryNotFoundInStoreError`, with suggestions, through `validateLibraryExists()`; or
- `VersionNotFoundInStoreError`, with the available versions.

Both refresh routes into `enqueueScrapeJob()` pass `{ onExisting: "replace" }`: the direct route for a
completed version, and the stored-options fall-back. Refresh targets an existing version by definition.
The worker's `isRefresh` handling keeps the version from being cleared.

After this change, `ensureVersion()` has no production callers. It stays on `DocumentManagementService`
for tests that seed a version.

### D8 — One creation helper, shared validation

All library inserts go through one private `DocumentStore` helper. It computes the key with
`normalizeLibraryName()` and the display name with `normalizeLibraryDisplayName()` (trim only), and
calls `describeLibraryNameProblem()` before inserting a *new* row. `claimVersion()` and
`resolveVersionId()` both use it.

`resolveVersionId()` remains a creator because `addDocuments()`, `addEmptyPage()`, `updateJobStatus()`
and existing tests rely on it. It no longer receives a pre-lowercased name:
`ensureLibraryAndVersion()` drops its `toLowerCase()`, and `ensureVersion()` normalizes only the version.

`describeLibraryNameProblem()` is pure and lives in `src/store/types.ts`, which the web client already
imports, so the drawer shows the same message inline. Length is counted in code points (`[...s].length`)
to match the spec's unit.

### D9 — Jobs carry the display name

`claimVersion()` returns the stored display name, and `enqueueScrapeJob()` stores that on the job in
place of the caller's input. `getVersionsByStatus()` and `findVersionsBySourceUrl()` select
`l.display_name AS library_name`, so recovered jobs and URL lookups show it too.

### D10 — Error surfacing, including through remote workers

The store raises typed errors, and each one's message is written for the surface that can trigger it:

| Error | Raised by | Message (example) |
|---|---|---|
| `VersionAlreadyExistsError` | default scrape, "Add version" | `Version "19.0.0" of library "React" already exists. To rebuild it, scrape again with --replace (CLI) or replace: true (MCP), or refresh it to update in place.` Unversioned: `Unversioned documentation for library "React" already exists. …` |
| `LibraryAlreadyExistsError` | "Add library" only | `Library "React" already exists. Open it to add a version.` |
| `InvalidLibraryNameError` | any creation | `Invalid library name "React\n": contains a control character.` |

Every library name, version or suggestion that an error repeats goes through one of two helpers in
`src/store/errors.ts`:
- `quoteName()` is used by the three new errors. It adds quotes, and escapes quotes, backslashes and
  control characters.
- `escapeControlCharacters()` is used by the existing not-found errors and the refresh errors, whose
  message formats are unchanged.

Both escape every Unicode Cc character. `JSON.stringify()` alone is not enough: it escapes C0 controls
but leaves DEL and C1 controls such as U+0085 raw. A rejected name can contain these characters by
definition, and legacy display names were never validated. Escaping keeps them out of CLI output, logs,
and MCP and HTTP error bodies, so they cannot inject terminal control sequences or forge log lines.

The pipeline tRPC router maps errors to `TRPCError` codes and keeps each message:
- `CONFLICT` for the two already-exists errors;
- `BAD_REQUEST` for an invalid name;
- `NOT_FOUND` for the library-not-found and version-not-found errors from `enqueueRefreshJob`.

HTTP callers therefore get 409, 400 or 404. This is the first `TRPCError` use in the codebase.

`PipelineClient` preserves those codes. When a `TRPCClientError` carries `data.code` `CONFLICT`,
`BAD_REQUEST` or `NOT_FOUND`, it rethrows `new TRPCError({ code, message })` with the original message
and no prefix. The calling process's own router then passes the error through unchanged, so the web
UI in front of a remote worker shows the same 409 and message as a local one. Any other failure keeps
today's "Failed to enqueue …" wrapping.

The web drawer pre-checks against the loaded library list and disables submit with an inline hint.
The server stays authoritative, and a race still surfaces through the existing toast.

### D11 — Stay compatible with language/platform scoping (#168, #436)

#168 and #436 ask for libraries with the same name in different languages. #436's example is `pandoc`,
which exists for Haskell, Python and Node. The planned design is a new language/platform column on
`libraries`. This change does not add that column, but it avoids anything that would have to be undone
when it arrives:

- **Identity lives in one spec requirement.** "Library Identity" is the only requirement that says when
  two names refer to the same library, and when a library exists. The creation, overwrite and refresh
  rules say "the same library". #168 therefore modifies one requirement, making the comparison name
  *and* language/platform, and the other rules carry over unchanged.
- **Names are opaque.** Nothing parses a name, so the new attribute cannot collide with existing names
  such as `@tanstack/query` or `python/pandoc`, and no future migration has to split names apart. The
  spec pins this, with `react@18` staying a name rather than a library plus version.
- **No column yet.** Its meaning is still open: libraries that cover several languages (LangChain), a
  "generic" value, and how MCP callers choose between same-named libraries. An unused column would
  need a default, and that default becomes exactly the fallback D3 rules out. When #168 lands, it
  rebuilds `libraries` the same way 017 does. `UNIQUE(name)` becomes `UNIQUE(<language/platform>,
  name)`, and `idx_libraries_lower_name` becomes composite.
- **Ids are stable.** 017 preserves `sqlite_sequence`, so a library id is never reused. #168's proposal to
  let MCP tools take a library id depends on that.
- **Where #168 will cost.** The key rule itself lives in one function and one constraint. The name-only
  parameters do not, and #168 widens them to a library reference (name plus language/platform, or an
  id). They are:
  - the twelve `l.name = ?` statements and the other name lookups;
  - `claimVersion()` and `findVersionId()`;
  - the three new error types;
  - the D12 comparison sites;
  - the web route `/libraries/:library`.

  Generalizing them now, with no attribute to carry, would be speculative.

*Alternatives:*
- Encode the qualifier in the name (`python/pandoc`, `pandoc@py`). Rejected, because it collides with
  npm-scoped names and would make existing names ambiguous.
- Add the column in 017 to save a second rebuild. Rejected: the rebuild is cheap, and its semantics are
  not decided yet.

### D12 — Name comparisons and presentation outside the store

Every place that compares a caller-supplied name against listed libraries normalizes both sides with
`normalizeLibraryName()`:
- the MCP versions resource, which also `decodeURIComponent`s its template variable, so a name
  containing `/` works when the client encodes it as `%2F`;
- `SearchTool`'s available-versions lookup;
- `LibraryDetail`;
- the drawer.

Everything that names an *existing* library uses its stored display name:
- the version-not-found errors in `DocumentManagementService.findBestVersion` and `SearchTool` take
  the listed library's name;
- `Topbar` titles the page with the listed library's display name. While the list is still loading,
  it shows the route parameter, which is a loading state, not a data fallback.

React Router v7 already decodes route parameters, so the web client must not decode them again.
`Topbar`'s current `decodeURIComponent(params.library)` is removed. Decoding twice turns an encoded
`100%25 Docs` into `100% Docs` and then throws `URIError`, and `%` is legal in an opaque name. Links keep
`encodeURIComponent()` for building the path. Names containing `/` or `%` must round-trip through the
route, and this is verified in the preview (task 6.4). The MCP versions resource is different: its
template variable arrives undecoded, so decoding it once is correct there.

## Program Design

### Files

```
db/migrations/
+ 017-add-library-display-name.sql   # prune versionless libraries; rebuild with display_name NOT NULL
src/store/
~ types.ts                   # ExistingTargetPolicy, normalizeLibraryDisplayName, describeLibraryNameProblem;
                             #   normalizeLibraryName documented as the lookup key
~ errors.ts                  # LibraryAlreadyExistsError, VersionAlreadyExistsError, InvalidLibraryNameError
~ DocumentStore.ts           # creation helper, claimVersion, findVersionId; resolveVersionId and
                             #   removeVersion each in one transaction; display_name in listing and
                             #   version-with-library queries; getLibrary returns displayName
~ DocumentManagementService.ts  # claimVersion/findVersionId passthroughs; ensureLibraryAndVersion
                             #   and ensureVersion stop lowercasing; version-not-found uses display name
src/pipeline/
~ PipelineManager.ts         # claim before dedupe; D6 mapping; job.library = display name; both refresh
                             #   routes look up only and pass "replace"
~ PipelineClient.ts          # forwards onExisting; rethrows CONFLICT/BAD_REQUEST/NOT_FOUND as TRPCError
~ trpc/interfaces.ts         # IPipeline.enqueueScrapeJob gains EnqueueScrapeOptions
~ trpc/router.ts             # onExisting input; typed errors → CONFLICT / BAD_REQUEST / NOT_FOUND
src/tools/
~ ScrapeTool.ts              # replace?: boolean → onExisting "replace" or omitted
~ SearchTool.ts              # normalized available-versions lookup; display name in the error
src/cli/commands/
~ scrape.ts                  # --replace flag; usage text
src/mcp/
~ mcpServer.ts               # scrape_docs replace argument and description; versions resource decodes
                             #   and compares normalized
src/web/client/
~ components/AddEditDocumentationDrawer.tsx  # policy per form; inline existing-name, version and name-rule hints
~ components/Topbar.tsx      # title from the listed display name
~ pages/Jobs.tsx             # retry passes "replace"
~ pages/LibraryDetail.tsx    # match the route param with normalizeLibraryName
test/
+ library-identity-e2e.test.ts
~ version-resolution-e2e.test.ts  # repeated-submission cases request replacement
```

`claimVersion()` and `findVersionId()` are **not** added to `IDocumentManagement` or the store tRPC
router. Only the process that owns the pipeline claims, and it holds a concrete
`DocumentManagementService`.

### Signatures

```ts
// src/store/types.ts
export type ExistingTargetPolicy = "reject-library" | "reject-version" | "replace";
/** Trims only; the stored, presented form. */
export function normalizeLibraryDisplayName(library: string): string;
/** Returns why a new library name is unacceptable, or null. Pure; shared with the web client. */
export function describeLibraryNameProblem(displayName: string): string | null;

// src/store/errors.ts
export class LibraryAlreadyExistsError extends StoreError {
  constructor(readonly library: string /* stored display name */);
}
export class VersionAlreadyExistsError extends StoreError {
  constructor(readonly library: string /* stored display name */, readonly version: string);
}
export class InvalidLibraryNameError extends StoreError {
  constructor(readonly library: string, readonly reason: string);
}

// src/store/DocumentStore.ts (DocumentManagementService mirrors both)
/**
 * Creates or verifies the library and version an indexing job writes into, in one
 * IMMEDIATE transaction.
 * @throws LibraryAlreadyExistsError  policy "reject-library" and the library exists
 * @throws VersionAlreadyExistsError  policy "reject-version" and the version exists
 * @throws InvalidLibraryNameError    the library is new and its name fails validation
 */
claimVersion(library: string, version: string, policy: ExistingTargetPolicy):
  Promise<{ versionId: number; library: string /* display name */ }>;
/** Lookup only; null when the library or version does not exist. Never creates. */
findVersionId(library: string, version: string): Promise<number | null>;
getLibrary(name: string): Promise<{ id: number; name: string; displayName: string } | null>;

// src/pipeline/trpc/interfaces.ts
export interface EnqueueScrapeOptions {
  /** Defaults to "reject-version". */
  onExisting?: ExistingTargetPolicy;
}
enqueueScrapeJob(library: string, version: string | undefined | null,
  options: ScraperOptions, enqueue?: EnqueueScrapeOptions): Promise<string>;
// rejects with the store errors above (a TRPCError with the mapped code through PipelineClient);
// no job is created on rejection

// src/tools/ScrapeTool.ts
interface ScrapeToolOptions { /* … */ replace?: boolean /* default false */ }
```

### Enqueue and refresh control flow

```
PipelineManager.enqueueScrapeJob(library, version, options, { onExisting = "reject-version" })
+   policy = options.clean === false && onExisting === "reject-version" ? "replace" : onExisting   # D6
+   store.claimVersion(library, version, policy)     # IMMEDIATE txn, no await inside; throws → no job, nothing cancelled
    getJobs() → cancelJob(duplicates)                # only "replace" can reach an in-flight duplicate
~   job.library = claimed display name               # D9
    updateJobStatus(QUEUED)                          # ensureLibraryAndVersion resolves the claimed rows

PipelineManager.enqueueRefreshJob(library, version)
-   store.ensureVersion({ library, version })        # created an empty library for unknown names
+   store.findVersionId(library, version)            # null → LibraryNotFound / VersionNotFound (D7)
    status !== COMPLETED → enqueueJobWithStoredOptions()
-     store.ensureVersion(…)
+     store.findVersionId(…)                         # same lookup-only rule
-     enqueueScrapeJob(library, version, opts)
+     enqueueScrapeJob(library, version, opts, { onExisting: "replace" })
    status === COMPLETED → build initialQueue, isRefresh: true
-     enqueueScrapeJob(library, version, scraperOptions)
+     enqueueScrapeJob(library, version, scraperOptions, { onExisting: "replace" })   # C1: refresh must not be rejected

web server router.enqueueScrapeJob → PipelineClient → worker router → PipelineManager   # remote mode
+   worker router: typed store error → TRPCError(CONFLICT | BAD_REQUEST | NOT_FOUND)
+   PipelineClient: TRPCClientError with one of those codes → rethrow TRPCError(code, message)
+   web server router: TRPCError passes through unchanged → 409 / 400 / 404 at the browser
```

### Migration `017-add-library-display-name.sql`

This is a destructive migration under the `database-migrations` spec. The order of steps is the
constraint (D3). Mark the steps as two `@migration-step` blocks.

**Block "rebuild libraries"**
1. `DELETE FROM libraries WHERE id NOT IN (SELECT library_id FROM versions)`. This removes the
   versionless leftovers. Nothing references them, so no foreign key is affected.
2. Re-key padded legacy names: set `name` to its value trimmed of the `String.prototype.trim()` whitespace
   set (D3), where that changes the name, unless the trimmed key already exists. Foreign keys reference
   `id`, so none is affected.
3. `PRAGMA defer_foreign_keys = ON`.
4. Copy `id`, `name` and `created_at` into a temp table, and capture the current `sqlite_sequence` value
   for `libraries`.
5. `DROP TABLE libraries`. This also drops `idx_libraries_lower_name`.
6. `CREATE TABLE libraries (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE,
   display_name TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`.
7. Re-insert every row with its original `id` and `created_at`. Set `display_name` to the name trimmed
   of the same whitespace set. After step 2 that equals `name` for every row except a padded key that
   collided.
8. If a sequence value was captured in step 4, write it back to `sqlite_sequence`, inserting the row if
   necessary. The rebuild otherwise resets the value to `MAX(id)`, and AUTOINCREMENT would then reuse
   the ids of deleted libraries.

**Block "recreate index"**
9. Recreate `idx_libraries_lower_name` unchanged, and drop the temp table.
10. `PRAGMA defer_foreign_keys = OFF`, so later migrations in the same run check foreign keys immediately
    again.

Keeping the index step in its own block gives the rollback test a failure point *after* the `DROP` (see
tasks 1.4).

### Tests that change

- Raw `INSERT INTO libraries (name)` statements that run after all migrations must supply
  `display_name`. They are at `src/store/applyMigrations.test.ts:202,257,378,484,604,812` and
  `src/store/DocumentStore.test.ts:2613`. All of them run after every migration.
- `PipelineManager.test.ts`:
  - The `mockStore` objects at lines ~118, 523, 987, 1036, 1089, 1138 and 1201 need `claimVersion` and
    `findVersionId`.
  - The refresh tests at ~665-954 mock `ensureVersion`, and must mock `findVersionId` instead.
  - The two "should normalize … share one bucket" tests pass `{ onExisting: "replace" }` for the second
    enqueue.
- `test/version-resolution-e2e.test.ts`: cases that enqueue the same bucket twice must request
  replacement.
- `DocumentStore.test.ts` "treats library names case-insensitively and reuses same library id", and
  the `DocumentManagementService.test.ts` cases that mock `getLibrary` with lowercased names, gain a
  `displayName` expectation.
- The web client has no component-test harness (vitest runs in `node`, with no testing-library). Web
  behavior is therefore verified in the browser preview, not with unit tests.

## Risks / Trade-offs

- [Scripts and agents that re-run `scrape`/`scrape_docs` to re-index now fail] → The error names the
  exact remedy (`--replace`, `replace: true`, or refresh). The `scrape_docs` description states the rule.
  The README and basic-usage guide document `--replace`. Commit as `feat!` so the release notes call
  it out.
- [Older CLI talking to a newer server over tRPC gets the new default] → This is intended, and the
  message is self-explanatory. The web bundle ships with the server, so its version always matches.
- [Newer caller talking to an older remote worker] → The worker's non-strict schema strips `onExisting`,
  so it overwrites exactly as it does today. The release notes tell operators to upgrade workers
  together with, or before, their callers.
- [Removing a version while its job runs] → The job's next status update or page write recreates the
  library and version through `resolveVersionId()`, which is today's behavior. This is accepted as out
  of scope, and the spec's removal scenario states "while no job is indexing it".
- [An append cancels a running rebuild of the same version] → This is today's behavior, and it is
  accepted (D6).
- [Downgrade after migration] → Older releases insert libraries without `display_name` and would hit
  `NOT NULL`. Migrations are forward-only, so downgrading requires restoring a pre-upgrade backup. The
  release notes point to the existing backup guidance in `docs/concepts/data-storage.md`.
- [Existing libraries stay lowercase] → The casing is unrecoverable (see Non-Goals). They can be removed
  and re-added under the preferred casing. Renaming is follow-up work.
- [Non-ASCII legacy keys] → There are none to repair. Every SQLite-era writer lowercased with JS before
  inserting (see Context), so no stored key differs from its JS key by case.
- [A padded legacy key collides with its trimmed form] → This happens only if the same library was
  indexed once with padding and once without, before trimming was introduced. 017 then leaves both rows
  as they are, and the padded one stays unreachable by name, as it is today. The spec's rule that no two
  libraries compare equal is otherwise upheld for all upgraded data.
- [Legacy empty-named library] → It is kept, per the spec, and it is listed. No entry point accepts an
  empty name, so it cannot be searched or removed by name, as today. Cleaning it up is out of scope.
- [A failed first scrape blocks "Add library" for that name] → This is intended: the library is listed
  with a failed version. The inline hint in "Add library" points to the existing library, where "Edit &
  re-index" retries it.
- [The table rebuild fails mid-way] → The runner's single transaction rolls it back. A test fails the
  index block, which runs after the `DROP`, and asserts that the old table and the unapplied marker
  survive.

## Migration Plan

1. Ship migration 017 with the code. It runs at startup inside the runner's transaction. There is no
   manual step, no backfill job, and no dual-read period: the column is complete, and versionless
   leftovers are gone, when the migration commits.
2. In remote-worker deployments, upgrade the worker together with, or before, the web server, MCP server
   and CLI that call it.
3. To roll back, restore the pre-upgrade database copy and run the previous release. No in-place down
   migration is provided, consistent with the existing migrations.
