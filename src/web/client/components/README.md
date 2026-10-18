# Shared Components

This directory holds the components every page builds on, styled by the
classes in `../styles/components.css` and the tokens in `../styles/theme.css`.
Reuse them instead of writing new markup and CSS in a page. When a page needs a
control that is missing, add it here.

Each component has its own file; import it from there, for example
`import { Button } from "../components/Button"`. Props and usage examples are
in each file's types and TSDoc.

## Catalogue

### App Shell

`App.tsx` mounts these once. Pages do not render them.

| Component | File | Purpose |
|---|---|---|
| `Sidebar` | `Sidebar.tsx` | Navigation with live counts, and the status footer |
| `Topbar` | `Topbar.tsx` | Page title and breadcrumb for the current route, the "Add library" button, and the theme toggle |
| `ThemeToggle` | `ThemeToggle.tsx` | Topbar button that cycles the theme between auto, light and dark |
| `IconSprite` | `Icon.tsx` | The SVG symbol sprite every `Icon` refers to |
| `AppProviders` | `AppProviders.tsx` | Mounts the toast, confirm-dialog and documentation-drawer providers |

### Content

| Component | File | Purpose |
|---|---|---|
| `Card` | `Card.tsx` | Panel container |
| `Table`, `TableHead`, `TableBody`, `Th`, `Td` | `Table.tsx` | Data tables; `num` on a cell right-aligns numbers |
| `EmptyState` | `EmptyState.tsx` | Placeholder for an empty list, with an optional action |
| `Markdown` | `Markdown.tsx` | Renders stored Markdown (search results, chunks) without raw HTML |
| `AreaChart` | `AreaChart.tsx` | SVG area chart for a series of values |
| `LibIcon` | `LibIcon.tsx` | Library avatar: the site's favicon, or a two-letter monogram |
| `Icon` | `Icon.tsx` | One icon from the sprite; `IconName` lists them |

### Status

| Component | File | Purpose |
|---|---|---|
| `StatusDot` | `StatusDot.tsx` | Colored dot for a status, optionally pulsing |
| `Pill` | `Pill.tsx` | Status label, optionally with a dot |
| `Chip` | `Chip.tsx` | Small neutral tag, such as a version |
| `ProgressBar` | `ProgressBar.tsx` | Progress bar in a status color |
| `Spinner`, `Loading` | `Spinner.tsx` | Spinner, and a spinner with a label for loading states |

### Forms and Actions

| Component | File | Purpose |
|---|---|---|
| `Button` | `Button.tsx` | Primary, ghost and danger buttons in two sizes |
| `Input` | `Input.tsx` | Text input with optional label, hint and leading icon |
| `Textarea` | `Textarea.tsx` | Multi-line input with optional label and hint |
| `Checkbox` | `Checkbox.tsx` | Checkbox with label and optional hint |
| `SegmentedControl` | `SegmentedControl.tsx` | Choice between a few options |

### Overlays

| Component | File | Purpose |
|---|---|---|
| `Modal` | `Modal.tsx` | Centered dialog; the confirm dialog builds on it |
| `Drawer` | `Drawer.tsx` | Slide-over panel; the documentation drawer builds on it |
| `ToastProvider`, `useToast` | `Toast.tsx` | Notifications |
| `ConfirmProvider`, `useConfirm` | `ConfirmDialog.tsx` | Confirmation before an action |
| `DocumentationDrawerProvider`, `useDocumentationDrawer` | `AddEditDocumentationDrawer.tsx` | The form that adds a library or version, or edits one and re-indexes it |

## App-Wide Overlays

`AppProviders` mounts the toast, confirm and documentation-drawer providers
above every page. Any component calls their hooks and keeps no open or closed
state of its own:

```tsx
const toast = useToast();
toast.success("Indexing started");

const confirm = useConfirm();
if (await confirm({ title: "Remove version", description: "This removes react 19.0." })) {
  // run the removal
}

const drawer = useDocumentationDrawer();
drawer.open({ mode: "add" });
drawer.open({ mode: "edit", library: "react", version: "19.0" });
```

- Toasts close themselves after five seconds.
- The confirm dialog styles its action as destructive unless the options pass
  `danger: false`. The promise resolves to `true` when the user confirms.
- The documentation drawer submits a scrape job. In edit mode it fills the form
  from the version's stored scraper options and rebuilds the version from
  scratch. After a successful submit it refreshes every tRPC query and shows a
  toast. The file's TSDoc describes each mode.

## Theme

`useTheme()` (`../hooks/useTheme.ts`) reads and sets the theme preference:
`auto`, `light` or `dark`, stored in `localStorage`. `auto` follows the
operating system through CSS. `ThemeToggle` in the topbar is the only control
that changes it, so pages rarely need the hook.

## Examples

- `../pages/Libraries.tsx` composes `Table`, `LibIcon`, `Pill`, `Chip`,
  `EmptyState` and `Loading`, opens the documentation drawer, shows toasts, and
  refreshes queries through `trpc.useUtils()` after a mutation.
- `../pages/library-detail/ScrapeConfigPanel.tsx` asks with `useConfirm()`
  before it removes a version.
