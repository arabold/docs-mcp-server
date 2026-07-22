/**
 * App shell and route table for the admin dashboard.
 * `Shell` renders the real design-system layout (sidebar + topbar + scrollable
 * content, see `src/web/client/CONVENTIONS.md` and `components/README.md`):
 * the icon sprite, the sidebar/topbar, and the cross-cutting overlay
 * providers (toasts, confirm dialog, add/edit documentation drawer) all
 * mount here, once, above the routed pages.
 */
import { Outlet, Route, Routes, useLocation } from "react-router-dom";
import { AppProviders } from "./components/AppProviders";
import { IconSprite } from "./components/Icon";
import { Sidebar } from "./components/Sidebar";
import { Topbar } from "./components/Topbar";
import Jobs from "./pages/Jobs";
import Libraries from "./pages/Libraries";
import LibraryDetail from "./pages/LibraryDetail";
import Overview from "./pages/Overview";
import Search from "./pages/Search";
import Settings from "./pages/Settings";

/** Sidebar + sticky topbar + scrollable `<Outlet/>`, matching the mockup's `.app` layout. */
function Shell() {
  const location = useLocation();
  return (
    <div className="app">
      <IconSprite />
      <Sidebar />
      <div className="main">
        <Topbar />
        <div className="content">
          {/* Keyed by pathname so the `.view` fade-in replays on every navigation. */}
          <div className="view is-active" key={location.pathname}>
            <Outlet />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Root application component: mounts the shared overlay providers and declares the route table. */
export function App() {
  return (
    <AppProviders>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<Overview />} />
          <Route path="libraries" element={<Libraries />} />
          <Route path="libraries/:library" element={<LibraryDetail />} />
          <Route path="jobs" element={<Jobs />} />
          <Route path="search" element={<Search />} />
          <Route path="settings" element={<Settings />} />
        </Route>
      </Routes>
    </AppProviders>
  );
}
