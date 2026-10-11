# Proposal

## Why

A library's name is lowercased on the way in, so `React` is stored, listed and shown as `react` (#515).
Nothing marks a scrape as creating something new. Every entry point upserts, and the worker clears the
target version before scraping. Adding documentation under a name that is already indexed therefore
deletes the existing documentation without a warning. It is not orphaned, it is gone, and it stays gone
even if the new scrape fails. No spec defines what a library name is or when a scrape may overwrite
one, so each entry point has settled it by accident.

## What Changes

- **Add a `library-identity` capability** that defines a library's name, how it is matched, how it is
  displayed, and when indexing may create or overwrite a library or version.
- **Preserve the name as entered.** Each library stores a display name, the trimmed name its creator
  typed, with case, spaces and punctuation intact. The first write sets it and later writes never change
  it. Lookup stays case-insensitive: `react`, `REACT` and `React` all reach the same library, and no two
  libraries can differ only by case.
- **Populate display names during the migration.** The migration that adds the display name fills it
  in for every existing library, from the name stored today. The column is required (`NOT NULL`), so it
  is never missing, and no reader falls back to the lookup key. A legacy library stored with an empty
  name keeps an empty display name. Existing libraries keep their current lowercase names, because
  names have been lowercased on write since before v1.0 and the original casing cannot be recovered.
- **Validate new names.** A newly created library's name must be non-empty after trimming, free of
  control characters, and at most 100 characters. Existing names are not re-validated.
- **Treat names as opaque.** No character in a name separates a scope, ecosystem, language, platform or
  version, so `@tanstack/query`, `python/pandoc` and `react@18` are each just a name. When libraries
  gain a language or platform (#168, #436), it will be a separate attribute, not a name syntax.
- **Define identity in one place.** "The same library" is defined once, and the creation, overwrite and
  refresh rules refer to it. A later language/platform change then only has to extend that definition.
- **Make scrapes refuse to overwrite by default.** A scrape that would clear an existing version fails
  and leaves that version untouched, unless the caller explicitly asks to replace it.
  An existing version includes one that is queued, running, failed or cancelled.
  - **BREAKING** (CLI): `scrape <library> <url>` against an existing library version now fails.
    `--replace` restores the old rebuild behavior. `--no-clean` (append) is unaffected.
  - **BREAKING** (MCP): `scrape_docs` against an existing library version now fails. A new
    `replace: true` argument rebuilds it.
  - **BREAKING** (pipeline API): `enqueueScrapeJob` rejects an existing target unless the caller passes
    an explicit replace intent. Refresh, its stored-options fall-back, and job recovery pass it
    internally, so they keep working.
- **Web UI: enforce each form's intent on the server.** No new control is added. "Add library" fails
  when the same library already exists, whatever versions it holds. "Add version" fails when that
  version exists. "Edit & re-index" and job retry replace, as they do today.
- **Keep the library list and the stored records in agreement.** A library exists while it holds a
  version, and removing its last version removes it, as it does today. The migration deletes leftover
  library records that hold no versions, so none of them block "Add library".
- **Stop refresh from creating libraries.** Refreshing a library or version that does not exist fails
  without creating anything. Today such a refresh leaves behind the empty records that the migration
  cleans up.

## Capabilities

### New Capabilities

- `library-identity`: How a library is identified, and how its name is validated, stored, matched and
  displayed. Also covers when indexing may create a library or version, and when it may replace an
  existing one, across the MCP tools, CLI, web UI and pipeline API.

### Modified Capabilities

<!-- None. `version-resolution` governs version labels and is unchanged; its library-not-found
     suggestions become display names through the new capability's display requirement, without any
     change to its own requirements. Its scenario "All entry points normalize identically" still holds:
     a repeated submission lands in the same bucket, which is exactly why it is now rejected unless it
     requests replacement. No existing capability covers scrape targeting. -->

## Impact

**Behavior**
- MCP:
  - `scrape_docs`: new `replace` argument, conflict errors.
  - `refresh_version`: not-found errors.
  - `list_libraries`, and `search_docs` suggestions and version errors.
  - The `docs://libraries` and `docs://libraries/{library}/versions` resources.
- CLI `scrape` (new `--replace` flag), `refresh`, and `list`.
- Web UI: the Add library, Add version and Edit forms, the Libraries and Library detail pages, the
  Topbar title, and the Jobs page.
- Scripts that re-run `scrape` to re-index must add `--replace`, or switch to `refresh`.
- Remote-worker deployments must upgrade the worker together with, or before, the processes that call
  it. An older worker ignores the new intent and overwrites, as it does today.

**Data**
- A schema migration rebuilds the small `libraries` table to add a required display-name column. The
  column is filled in from each existing name in the same migration. Library ids, creation times and
  version references are preserved. The migration also deletes library records that hold no versions;
  they hold no documentation and are already hidden from every listing. It re-keys names stored with
  surrounding whitespace by older releases, which makes them reachable again.

**Code**
- `db/migrations/` — new migration
- `src/store/DocumentStore.ts`, `src/store/DocumentManagementService.ts`, `src/store/types.ts`,
  `src/store/errors.ts` — display name, name validation, atomic create-or-reject
- `src/pipeline/PipelineManager.ts`, `src/pipeline/PipelineClient.ts`, `src/pipeline/trpc/router.ts`,
  `src/pipeline/trpc/interfaces.ts` — explicit replace intent on enqueue; refresh no longer creates
- `src/tools/ScrapeTool.ts`, `src/cli/commands/scrape.ts`, `src/mcp/mcpServer.ts` — `replace` option;
  case-insensitive versions resource
- `src/tools/SearchTool.ts` — case-insensitive available-versions lookup
- `src/web/client/components/AddEditDocumentationDrawer.tsx`, `src/web/client/pages/Jobs.tsx`,
  `src/web/client/pages/LibraryDetail.tsx`, `src/web/client/components/Topbar.tsx` — intent per form,
  case-insensitive match, display-name title

**Defects closed**
- #515 — library names are lowercased, and a duplicate name silently replaces existing documentation

**Considered, not closed**
- #168 and #436 — libraries with the same name in different languages or ecosystems. This change adds
  no language or platform attribute. It keeps names opaque and identity defined in one requirement, so
  that attribute can be added later as a new column without reversing any rule introduced here. See
  design.md D11.
