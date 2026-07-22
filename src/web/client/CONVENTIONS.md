# Web Client Conventions

This is the React admin dashboard that replaces the old HTMX/Alpine server-rendered
web UI. It is a standard Vite + React + React Router + tRPC/React Query SPA, built by
`vite.config.web.ts` into the project-root `public/` directory and served by
`AppServer` (Fastify static files + a SPA catch-all for client-side routes).

Read this file before adding a page, a data hook, or a UI component here.

## Directory layout

```
src/web/client/
├── index.html          # Vite entry HTML (script tag points at main.tsx)
├── main.tsx             # Bootstraps QueryClient, tRPC client (HTTP+WS), BrowserRouter, imports styles/
├── App.tsx               # Real app shell (Shell: Sidebar + Topbar + <Outlet/>) and the route table
├── api/
│   ├── trpc.ts            # createTRPCReact<AppRouter>() — the typed tRPC client
│   └── hooks.ts            # Thin hooks wrapping the procedures pages call
├── styles/
│   ├── theme.css            # Design tokens (4 theme blocks), base reset, keyframes, reduced-motion guard
│   └── components.css       # Every component class ported from the admin mockup + responsive breakpoints
├── hooks/
│   └── useTheme.ts          # Theme preference hook (light/dark/auto), used by ThemeToggle
├── pages/
│   ├── Overview.tsx
│   ├── Libraries.tsx        # Real implementation — also the reference example for components/
│   ├── LibraryDetail.tsx
│   ├── Jobs.tsx
│   ├── Search.tsx
│   └── Settings.tsx
└── components/              # Shared UI library (Wave 2) — see components/README.md
```

`AppRouter` (the merged tRPC router type) lives at `src/services/appRouter.ts` and is
always imported here as a **type-only** import (`import type { AppRouter } from
"../../../services/appRouter"`), so no server code or its dependencies (e.g.
better-sqlite3) is ever bundled into the browser build.

## Adding a page + route

1. Create `src/web/client/pages/MyPage.tsx`. The project's `tsconfig.json` sets the
   default JSX runtime to `react`, so no per-file pragma is needed.
2. Export a default component:

   ```tsx
   export default function MyPage() {
     return <div>My Page</div>;
   }
   ```

3. Register the route in `App.tsx`, inside the `<Shell>` route's children:

   ```tsx
   <Route path="my-page" element={<MyPage />} />
   ```

No other wiring is required — `vite.config.web.ts` builds every file reachable from
`main.tsx`, and the Fastify catch-all in `AppServer` serves `index.html` for any
unmatched GET route so deep links and refreshes work.

## Calling the API

Never call `trpc.<procedure>.useQuery`/`useMutation` directly from a page. Add (or
reuse) a thin wrapper in `api/hooks.ts` instead — it keeps the procedure surface
pages depend on explicit and typed, and gives later waves one place to add
cross-cutting concerns (e.g. shared error toasts) without touching every page.

Example — the pattern `Libraries.tsx` already follows:

```tsx
// api/hooks.ts
export function useListLibraries() {
  return trpc.listLibraries.useQuery();
}

// pages/Libraries.tsx
import { useListLibraries } from "../api/hooks";

export default function Libraries() {
  const { data, isLoading, isError, error } = useListLibraries();
  if (isLoading) return <div>Loading…</div>;
  if (isError) return <div>Failed to load: {error.message}</div>;
  return (
    <ul>
      {(data ?? []).map((lib) => (
        <li key={lib.library}>{lib.library}</li>
      ))}
    </ul>
  );
}
```

For a mutation, wrap it the same way (`useEnqueueScrapeJob`, `useCancelJob`, etc. in
`api/hooks.ts` are already there) and call `.mutate()` / `.mutateAsync()` from the page.

For the real-time event stream, use `useEventsSubscription` from `api/hooks.ts`; it
wraps `trpc.events.subscribe.useSubscription`, which rides the WebSocket link
configured in `main.tsx` (queries and mutations use the HTTP batch link instead).

## Styling and shared components

The design system and shared component library are in place (Wave 2). Before
writing any markup or CSS in a page, **read
[`components/README.md`](./components/README.md)** — it catalogues every
shared component (import path, props, one-line usage), plus how to use the
app-wide toast/confirm-dialog/documentation-drawer APIs
(`useToast`/`useConfirm`/`useDocumentationDrawer`). Reuse what's there instead
of reinventing a button, table, badge, form field, modal, or drawer.

Quick orientation:

- `styles/theme.css` + `styles/components.css` — the full design system,
  ported verbatim from the admin mockup (imported once from `main.tsx`).
- `components/` — one file per component (Button, Card, Pill, Table, Modal,
  Drawer, Toast, etc.) — see the README for the full list.
- `App.tsx`'s `Shell` — the real sidebar/topbar/content layout — already
  wires up the icon sprite and the overlay providers; pages just render their
  content inside `<Outlet/>`.
- `pages/Libraries.tsx` — a real (non-placeholder) page that demonstrates the
  intended composition; use it as a reference when building the remaining
  pages (Overview, Jobs, Search, Settings, LibraryDetail).

Still no Tailwind, no third-party component library, and no chart library —
charts are hand-rolled SVG (`Sparkline`, `AreaChart` in `components/`).
