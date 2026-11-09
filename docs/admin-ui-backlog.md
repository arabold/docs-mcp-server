# Web UI Backlog

Open follow-ups for the React web interface in `src/web/client/`, and the requests decided against. Done items are removed; git history keeps the earlier triage.

## Tracked in GitHub Issues

- [#449](https://github.com/arabold/docs-mcp-server/issues/449): atomic library removal. No procedure removes all versions of a library in one transaction, so the Libraries page has no library-level Remove action. The Library Detail page removes single versions, and removing the last version removes the library.
- [#450](https://github.com/arabold/docs-mcp-server/issues/450): per-chunk token counts. The schema stores no token counts, so the UI shows character counts, and `tokenCount` and `avgTokensPerChunk` are always `null`.
- [#451](https://github.com/arabold/docs-mcp-server/issues/451): favicons stored at scrape time. `LibIcon` tries the site's `/favicon.ico` in the browser and falls back to a monogram.
- [#14](https://github.com/arabold/docs-mcp-server/issues/14): cross-library search. The `search` procedure takes one library, so the Search page searches one library at a time.

## Open

- Live job cards. The running, failed and cancelling job cards have not been checked against real jobs. Confirm progress, the current URL, error display, Retry and Edit & retry against an actual index.
- Bundle size. The build emits one JavaScript chunk of about 850 kB (240 kB gzip), above Vite's 500 kB warning. Route-level `React.lazy` splitting would bring it under.
- Version deep links. The active version tab on Library Detail is component state. A `?version=` query parameter would make it linkable.

## Decided Against

- A separate status for re-indexing. A re-index shows as "indexing", like a first run.
- Per-job dismiss, time-boxed history and pagination on the Jobs page. Clearing all finished jobs at once is enough.
- Editing settings from the UI. The Settings page is a read-only view of how the process was started.
- An "Assembled" view in the chunk explorer. The Search page already shows assembled, full-context results.
