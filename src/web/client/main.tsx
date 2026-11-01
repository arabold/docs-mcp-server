/**
 * Bootstraps the React admin dashboard: sets up the tRPC + React Query client
 * (HTTP for queries/mutations, WebSocket for `events.subscribe`), the browser
 * router, and mounts the app shell into `#root`.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { createApiLinks } from "../../services/apiClient";
import { App } from "./App";
import { mcpAdminHeaders } from "./api/adminAccess";
import { trpc } from "./api/trpc";
import "./styles/theme.css";
import "./styles/components.css";

// The server injects <base href> for the public URL's path (e.g. "/docs/"),
// so the app, its API and its live updates all live under that path.
const baseUrl = new URL(
  document.querySelector("base")?.href ?? `${window.location.origin}/`,
);
const basename = baseUrl.pathname.replace(/\/$/, "") || "/";
const apiUrl = new URL("api", baseUrl).href;

const queryClient = new QueryClient();

const trpcClient = trpc.createClient({
  links: createApiLinks(apiUrl, { subscriptions: true, headers: mcpAdminHeaders }).links,
});

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root container '#root' not found in index.html");
}

createRoot(container).render(
  <StrictMode>
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter basename={basename}>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </trpc.Provider>
  </StrictMode>,
);
