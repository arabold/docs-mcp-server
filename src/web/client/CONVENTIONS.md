# Web Client Conventions

The web UI is a React single-page app built with Vite, React Router, and tRPC
on React Query. `vite.config.web.ts` builds it into the project-root `public/`
directory. `AppServer` serves that directory and answers every client-side
route (`/libraries`, `/jobs`, ...) with `index.html`, so deep links and reloads
work.

Read this file before adding a page, a data hook, or a component.

## Building

`npm run build:web` builds the UI once; `npm run build` builds it together with
the server. `npm run dev` runs the server under vite-node and rebuilds the UI
into `public/` on every change. The server reads `index.html` once and keeps it
in memory, so restart it to load a rebuilt UI.

## How the Client Is Organized

- `main.tsx` starts the app: the React Query client, the tRPC client, and the
  router. The server injects a `<base href>` for its public path (for example
  `/docs/`), and `main.tsx` derives the router's `basename` and the API URL from
  it.
- `App.tsx` holds the route table and `Shell`, the layout every page renders
  in: sidebar, topbar, and an `<Outlet/>` for the page. `AppProviders` wraps the
  routes with the toast, confirm-dialog and documentation-drawer providers.
- `api/trpc.ts` is the typed tRPC client, and `api/hooks.ts` has one thin hook
  per procedure the UI calls.
- `pages/` has one file per route. Parts that only one page uses live in a
  folder named after it, such as `pages/jobs/` and `pages/library-detail/`.
- `components/` is the shared component library. Its
  [README](./components/README.md) lists every component.
- `hooks/` holds app-wide hooks (theme, live updates, the release check), and
  `utils/` holds pure helpers.
- `styles/theme.css` defines the design tokens for light and dark themes, and
  `styles/components.css` defines every component class. `main.tsx` imports
  both once.

## Code Shared With the Server

The browser bundle must not pull in server code or its dependencies (such as
`better-sqlite3`). The client therefore imports from the server only:

- types, as type-only imports. `AppRouter` (`src/services/appRouter.ts`) is
  always imported with `import type`;
- the type modules `src/{events,pipeline,store,scraper}/types`, which have no
  server dependencies;
- `src/services/apiClient.ts`, whose `createApiLinks()` builds the client's
  links in `main.tsx` the same way Node processes build theirs for a remote
  worker. A Biome rule limits that file's imports to `@trpc/client`,
  `superjson` and the `AppRouter` type.

Biome also forbids the global `crypto` in `src/web/client/`:
`crypto.randomUUID()` and `crypto.subtle` exist only in secure contexts, and
the UI is often served over plain HTTP on a LAN address.

## Adding a Page

1. Create `pages/MyPage.tsx` with a default export. The project's
   `tsconfig.json` sets the React JSX runtime, so no pragma is needed.
2. Register the route in `App.tsx`, inside the `<Shell>` route:

   ```tsx
   <Route path="my-page" element={<MyPage />} />
   ```

3. Add the page's title and breadcrumb to `useRouteTitle()` in
   `components/Topbar.tsx`. Without an entry, the topbar shows "Overview".
4. If the page belongs in the navigation, add a `NavLink` to
   `components/Sidebar.tsx`.

Link between pages with React Router's `Link` or `NavLink` and route paths
such as `/jobs`; the router adds the server's path prefix. Build any other URL
relative to the document base, the way `main.tsx` builds the API URL.

## Calling the API

Pages call the API through the hooks in `api/hooks.ts`, never through
`trpc.<procedure>.useQuery` or `useMutation` directly. That keeps the set of
procedures the UI depends on in one typed place. When a page needs a procedure
that has no hook yet, add one that only passes through:

```tsx
// api/hooks.ts
export function useListLibraries() {
  return trpc.listLibraries.useQuery();
}
```

Call `.mutate()` or `.mutateAsync()` on a mutation hook such as
`useEnqueueRefreshJob()`, then refresh the affected queries through
`trpc.useUtils()`.

`Shell` mounts `useLiveInvalidation()`, which subscribes to job and library
events over the WebSocket link and refreshes the job list, the library list
and the system health as they change. Pages that show those queries stay
current without code of their own. For other live data, subscribe with
`useEventsSubscription()` from `api/hooks.ts`.

## Styling and Components

The UI uses plain CSS classes from `styles/components.css` and the tokens in
`styles/theme.css`, with no Tailwind, component library, or chart library;
charts are hand-drawn SVG (`components/AreaChart.tsx`).

Before writing markup in a page, read
[`components/README.md`](./components/README.md). It lists every shared
component and the app-wide toast, confirm-dialog and documentation-drawer
hooks. Reuse what is there. When a page needs a control the library lacks, add
it to `components/` instead of styling it inside the page.

`pages/Libraries.tsx` is a compact example of a page built from the shared
components.
