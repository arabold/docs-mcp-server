/**
 * App shell topbar: route-driven page title/breadcrumb, the "Add
 * documentation" action, and the theme toggle. Ported from the mockup's
 * `.topbar`.
 */
import { useLocation, useParams } from "react-router-dom";
import { useDocumentationDrawer } from "./AddEditDocumentationDrawer";
import { Button } from "./Button";
import { Icon } from "./Icon";
import { ThemeToggle } from "./ThemeToggle";

interface RouteTitle {
  title: string;
  crumb: string;
}

function useRouteTitle(): RouteTitle {
  const { pathname } = useLocation();
  const params = useParams<{ library?: string }>();

  if (pathname === "/") return { title: "Overview", crumb: "/ dashboard" };
  if (pathname === "/libraries") return { title: "Libraries", crumb: "/ libraries" };
  if (pathname.startsWith("/libraries/") && params.library) {
    const library = decodeURIComponent(params.library);
    return { title: library, crumb: `/ libraries / ${library}` };
  }
  if (pathname === "/jobs") return { title: "Jobs & Queue", crumb: "/ jobs" };
  if (pathname === "/search") return { title: "Search Playground", crumb: "/ search" };
  if (pathname === "/settings") return { title: "Settings", crumb: "/ settings" };
  return { title: "Overview", crumb: "/ dashboard" };
}

/** The sticky app topbar, rendered once by `Shell`. */
export function Topbar() {
  const { title, crumb } = useRouteTitle();
  const drawer = useDocumentationDrawer();

  return (
    <header className="topbar">
      <span className="topbar__title">{title}</span>
      <span className="topbar__crumb">{crumb}</span>

      <Button variant="primary" onClick={() => drawer.open({ mode: "add" })}>
        <Icon name="i-plus" size="sm" />
        Add library
      </Button>

      <ThemeToggle />
    </header>
  );
}
