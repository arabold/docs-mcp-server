# Shared component library

Everything in this directory is styled to match the admin mockup's design
system (`../styles/theme.css` + `../styles/components.css`). **Reuse these
instead of writing new markup/CSS** — every control a page needs should
already exist here. If something is missing, add it here rather than
inlining one-off styles in a page.

All components are typed and TSDoc'd (see `../CONVENTIONS.md`). Import each from
its file directly, e.g. `import { Button } from "../components/Button"`.

## Design system foundation

| File | What it is |
|---|---|
| `../styles/theme.css` | CSS custom properties (colors, fonts, radii, shadows, sidebar/topbar sizes) for all four theme blocks (light default, OS-dark, explicit light, explicit dark), plus the base reset, `.icon` sizing, keyframes, and the `prefers-reduced-motion` guard. |
| `../styles/components.css` | Every component class (`.card`, `.btn`, `.pill`, `.tbl`, `.drawer`, `.modal`, …) ported from the mockup, plus the two responsive breakpoints. |
| `../hooks/useTheme.ts` | `useTheme()` — reads/writes the theme preference (see below). |

## Theme

```ts
import { useTheme } from "../hooks/useTheme";

const { preference, resolvedTheme, setTheme, cycleTheme } = useTheme();
// preference: "light" | "dark" | "auto" (persisted to localStorage)
// resolvedTheme: "light" | "dark" (auto resolved against the OS)
```

`ThemeToggle` (`components/ThemeToggle.tsx`) is the topbar icon button that
calls `cycleTheme()` (auto → light → dark → auto) and swaps the moon/sun icon
to match the mockup. It's already wired into `Topbar`; most pages won't need
to touch `useTheme` directly.

## Components

| Component | Import | Props (see file for full TSDoc) | Example |
|---|---|---|---|
| `Icon` | `components/Icon` | `{ name: IconName; size?: "md"\|"sm"\|"xs"; className?; style? }` | `<Icon name="i-search" size="sm" />` |
| `IconSprite` | `components/Icon` | none — mount once | `<IconSprite />` (already in `Shell`) |
| `ThemeToggle` | `components/ThemeToggle` | none | `<ThemeToggle />` (already in `Topbar`) |
| `Button` | `components/Button` | `{ variant?: "primary"\|"ghost"\|"danger"; size?: "default"\|"sm"; ...button props }` | `<Button variant="ghost" size="sm">Cancel</Button>` |
| `Card` | `components/Card` | `{ ...div props }` — renders `.card` | `<Card className="panel">...</Card>` |
| `StatusDot` | `components/StatusDot` | `{ variant?: "ok"\|"run"\|"queued"\|"err"\|"idle"; pulse?: boolean }` | `<StatusDot variant="run" pulse />` |
| `Pill` | `components/Pill` | `{ variant?: StatusVariant; withDot?: boolean; pulse?: boolean; children }` | `<Pill variant="run" pulse>running</Pill>` |
| `Chip` | `components/Chip` | `{ ...span props }` — renders `.chip` | `<Chip>v15.1</Chip>` |
| `Input` | `components/Input` | `{ label?; hint?; icon?: IconName; ...input props }` | `<Input icon="i-search" placeholder="Filter…" />` |
| `Textarea` | `components/Textarea` | `{ label?; hint?; ...textarea props }` | `<Textarea label="Exclude patterns" rows={4} />` |
| `Checkbox` | `components/Checkbox` | `{ label; hint?; ...input props (no type) }` | `<Checkbox label="Follow redirects" defaultChecked />` |
| `SegmentedControl` | `components/SegmentedControl` | `{ options; value; onChange; variant?: "compact"\|"full"; hint? }` | `<SegmentedControl variant="full" options={...} value={scope} onChange={setScope} />` |
| `ProgressBar` | `components/ProgressBar` | `{ value: number; variant?: "run"\|"ok"\|"queued"\|"err" }` | `<ProgressBar value={64} />` |
| `Sparkline` | `components/Sparkline` | `{ values: number[]; accent?: boolean }` | `<Sparkline values={[24,22,23,16,14,9,6]} />` |
| `AreaChart` | `components/AreaChart` | `{ values: number[]; yLabels?; xLabels?; label?; width?; height? }` | `<AreaChart values={pagesPerDay} yLabels={["1k","600","300","0"]} />` |
| `LibIcon` | `components/LibIcon` | `{ name: string; url?: string \| null; big?: boolean }` | `<LibIcon name="react" url="https://react.dev/reference" />` |
| `Markdown` | `components/Markdown` | `{ children: string; className? }` — renders GFM Markdown + code blocks, wrapped in `.md` (safe: no raw HTML). Use for search results & chunk content. | `<Markdown>{result.content}</Markdown>` |
| `Table`, `TableHead`, `TableBody`, `Th`, `Td` | `components/Table` | `Th`/`Td` accept `{ num?: boolean }` for right-aligned numeric columns | see `pages/Libraries.tsx` |
| `Modal` | `components/Modal` | `{ open; onClose; children; "aria-labelledby"? }` — generic centered dialog | used internally by `ConfirmDialog` |
| `ConfirmProvider` / `useConfirm` | `components/ConfirmDialog` | see below | see below |
| `Drawer` | `components/Drawer` | `{ open; onClose; icon?; title; children; footer? }` — generic slide-over | used internally by the documentation drawer |
| `DocumentationDrawerProvider` / `useDocumentationDrawer` | `components/AddEditDocumentationDrawer` | see below | see below |
| `ToastProvider` / `useToast` | `components/Toast` | see below | see below |
| `EmptyState` | `components/EmptyState` | `{ icon?; title; description?; action? }` | `<EmptyState icon="i-books" title="No libraries indexed yet" />` |
| `Spinner`, `Loading` | `components/Spinner` | `Spinner: { size? }`, `Loading: { label? }` | `<Loading label="Loading libraries…" />` |
| `Sidebar` | `components/Sidebar` | none — the app sidebar | already mounted by `Shell` in `App.tsx` |
| `Topbar` | `components/Topbar` | none — the app topbar | already mounted by `Shell` in `App.tsx` |
| `AppProviders` | `components/AppProviders` | `{ children }` — composes Toast/Confirm/Drawer providers | already mounted in `App.tsx` |

## App-wide overlay APIs

`App.tsx` wraps the routed app in `<AppProviders>`, which mounts
`ToastProvider`, `ConfirmProvider`, and `DocumentationDrawerProvider` once.
Any page or component below it can use the hooks below with **no local
open/close state of its own**.

### Toasts

```tsx
import { useToast } from "../components/Toast";

const toast = useToast();
toast.success("Indexing started");
toast.error("Failed to remove version", "Try again in a moment.");
toast.info("Heads up: this may take a minute.");
```

Toasts auto-dismiss after 5s (or click the close icon). This is a
design-system addition — the mockup has no toast markup — styled from the
same tokens (`.toast-viewport`/`.toast` in `components.css`).

### Confirm dialog

```tsx
import { useConfirm } from "../components/ConfirmDialog";

const confirm = useConfirm();
const ok = await confirm({
  title: "Remove version",
  description: (
    <>This permanently removes <b>react 19.0</b> and its <b>14,880 chunks</b> from the index. This can't be undone.</>
  ),
});
if (ok) await removeVersion.mutateAsync({ library: "react", version: "19.0" });
```

Matches the mockup's confirm modal exactly (trash icon, red danger button).
Pass `danger: false` for a non-destructive confirmation (primary-colored
icon/button instead of red).

### Add/Edit documentation drawer

```tsx
import { useDocumentationDrawer } from "../components/AddEditDocumentationDrawer";

const drawer = useDocumentationDrawer();

// Add mode — blank form, submits via enqueueScrapeJob, shows "Start indexing".
drawer.open({ mode: "add" });

// Edit mode — prefills every field from the version's stored scraper options
// (getScraperOptions), shows the destructive amber warning banner, and
// submits (still enqueueScrapeJob — a full clean rebuild) as "Save & re-index".
drawer.open({ mode: "edit", library: "react", version: "19.0" });
```

On success the drawer invalidates all tRPC queries (`trpc.useUtils().invalidate()`)
and shows a toast, so any list/detail page reading `useListLibraries`/`useGetJobs`
updates automatically — no manual refetch needed.

## Reference example

`pages/Libraries.tsx` is wired for real (not a placeholder) and demonstrates
the intended composition: `Table`/`Th`/`Td`, `LibIcon`, `Pill`, `Chip`,
`EmptyState`, `Loading`, the documentation drawer, and `useConfirm` +
`removeVersion`/`enqueueRefreshJob` with `trpc.useUtils()` cache invalidation
after each mutation. Copy its patterns for Jobs/Search/Settings/LibraryDetail
rather than inventing new ones.
