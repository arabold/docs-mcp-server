# Admin UI Rebuild — Backlog

Follow-up items from the multi-agent rebuild of the admin dashboard (React + Vite
+ tRPC SPA replacing the old HTMX/Alpine UI). Reflects the triage decisions made
after the first build. Nothing here is a silent gap — the shipped UI is wired to
real data for every feature that has a backing API today.

## Filed as GitHub issues

- **[#449](https://github.com/arabold/docs-mcp-server/issues/449) — Atomic `removeLibrary`.**
  No transactional whole-library delete exists. The Libraries list **defers** its
  library-level "Remove" action until this lands; per-version removal on the
  Library Detail page still works.
- **[#450](https://github.com/arabold/docs-mcp-server/issues/450) — Per-chunk token counts.**
  No token column in the schema, so the token stat is **removed from the UI** for
  now (char counts only; `tokenCount`/`avgTokensPerChunk` return `null`).
- **[#451](https://github.com/arabold/docs-mcp-server/issues/451) — Favicon-at-scrape persistence.**
  `LibIcon` does ad-hoc client-side favicon resolution with a monogram fallback
  for now; resolve + persist during scraping later.

## Planned (post-UI)

- **Activity time-series** (Overview chart). No per-day indexing-throughput history
  is recorded, so the chart shows an honest "coming soon" empty state. Add a
  time-series source + query, then wire the chart.

## Decided — not doing

- **`UPDATING` vs `INDEXING` status.** A re-index intentionally shows as `INDEXING`
  (like a first run); no separate "rebuilding" state — not worth the change.
- **Per-job dismiss / history time-boxing / pagination.** Bulk `clearCompletedJobs`
  is sufficient; no per-job dismiss or "last 24h" windowing needed.
- **Cross-library search.** Not supported by the `search` procedure yet; deferred
  and tracked in a pre-existing GitHub issue.
- **Settings write + service restart.** Settings stays read-only for now; runtime
  mutation + restart is a possible future extension.
- **Chunk explorer "Assembled" view.** Removed — the Search page already returns
  assembled, full-context results, so the toggle was redundant.

## Open — frontend polish & hygiene

- **Verify live job cards.** The running/failed/`cancelling` job cards weren't
  exercised against real live jobs (store was idle during QA). Confirm progress,
  `currentUrl`, error surfacing, and Retry / Edit-&-retry against an actual index.
- **Bundle size.** SPA is ~560 kB (167 kB gzip), over Vite's 500 kB warning.
  Route-level `React.lazy` code-splitting if it matters.
- **Version-tab deep-linking.** The active version tab on Library Detail is
  local state; consider a `?version=` query param.
- **Vite `publicDir === outDir` warning.** SPA builds into `public/` alongside
  static assets (works, but warns); consider a cleaner asset pipeline.

## Addressed in the follow-up pass (for reference)

- Exposed `maxConcurrency` via `getSystemHealth`; Jobs shows "N worker slots".
- Restored the "Update available" GitHub-release check + sidebar pill (was
  deleted with the legacy client).
- Wired the sidebar status footer to real `getSystemHealth` data.
- Removed the entire old HTMX UI; fixed the `/libraries/:x` deep-link collision;
  extended Biome to lint `.tsx`.
- Removed the non-functional topbar ⌘K search placeholder.
- Removed unused legacy deps (`alpinejs`, `@alpinejs/collapse`, `htmx.org`,
  `flowbite`, `flowbite-typography`, `idiomorph`, `@kitajs/html`,
  `@kitajs/ts-html-plugin`) and the unused Tailwind/PostCSS stack (`tailwindcss`,
  `@tailwindcss/vite`, `@tailwindcss/postcss`, `postcss`, `autoprefixer`);
  flipped `tsconfig.json`'s default JSX runtime to React and removed the
  per-file `@jsxImportSource react` pragmas (now redundant) from all
  `src/web/client/**/*.tsx` files.
- Removed orphaned event types `ServerEventName` / `SseEventPayloads` (and the
  derived `SseEventName`) from `src/events/types.ts` — existed only for the
  deleted SSE endpoint.
- Added `.claude/launch.json` so run/preview tooling can boot the app
  (`node dist/index.js web --port <port>`).
- Re-enabled the four temporarily-suppressed Biome rules and fixed the code:
  `SegmentedControl` renders a `<fieldset>`, the Libraries row is a real
  `<Link>`, header rows / search results use stable keys, and the chunk-explorer
  offset resets during render (not via an unread-dep effect). Override removed.
- Deduped the one identical cross-page helper (`displayUrl`) into
  `src/web/client/utils/format.ts`. The relative-time formatters intentionally
  differ per page (short vs. verbose, `Date` vs. ISO vs. `now`-param), so they
  are not true duplication and stay page-local.
