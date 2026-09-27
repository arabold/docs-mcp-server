/**
 * Bootstraps the React admin dashboard: sets up the tRPC + React Query client
 * (HTTP for queries/mutations, WebSocket for `events.subscribe`), the browser
 * router, and mounts the app shell into `#root`.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createWSClient, httpBatchLink, splitLink, wsLink } from "@trpc/client";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import superjson from "superjson";
import { App } from "./App";
import { trpc } from "./api/trpc";
import "./styles/theme.css";
import "./styles/components.css";

// The server injects <base href> for the public URL's path (e.g. "/docs/"),
// so the app, its API and its live updates all live under that path.
const baseUrl = new URL(
  document.querySelector("base")?.href ?? `${window.location.origin}/`,
);
const basename = baseUrl.pathname.replace(/\/$/, "") || "/";
const httpUrl = new URL("api", baseUrl).href;
const wsUrl = httpUrl.replace(/^http/, "ws");

const wsClient = createWSClient({ url: wsUrl });

const queryClient = new QueryClient();

const trpcClient = trpc.createClient({
  links: [
    splitLink({
      condition: (op) => op.type === "subscription",
      true: wsLink({ client: wsClient, transformer: superjson }),
      false: httpBatchLink({ url: httpUrl, transformer: superjson }),
    }),
  ],
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
