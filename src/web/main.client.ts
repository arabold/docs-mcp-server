/**
 * Bootstraps the client-side experience for the Docs MCP Server web UI.
 * Initializes Alpine stores, HTMX helpers, Flowbite components, and the
 * release checker that surfaces update notifications in the header.
 */
import "./styles/main.css";

import Alpine from "alpinejs";
import { initFlowbite } from "flowbite";
import htmx from "htmx.org";
import { fallbackReleaseLabel, isVersionNewer } from "./utils/versionCheck";

const LATEST_RELEASE_ENDPOINT =
  "https://api.github.com/repos/arabold/docs-mcp-server/releases/latest";
const LATEST_RELEASE_FALLBACK_URL =
  "https://github.com/arabold/docs-mcp-server/releases/latest";

interface VersionUpdateConfig {
  currentVersion: string | null;
}

interface GithubReleaseResponse {
  tag_name?: unknown;
  html_url?: unknown;
}

document.addEventListener("alpine:init", () => {
  Alpine.data("versionUpdate", (config: VersionUpdateConfig) => ({
    currentVersion:
      typeof config?.currentVersion === "string" ? config.currentVersion : null,
    hasUpdate: false,
    latestVersionLabel: "",
    latestReleaseUrl: LATEST_RELEASE_FALLBACK_URL,
    hasChecked: false,
    queueCheck() {
      window.setTimeout(() => {
        void this.checkForUpdate();
      }, 0);
    },
    async checkForUpdate() {
      if (this.hasChecked) {
        return;
      }
      this.hasChecked = true;

      if (!this.currentVersion) {
        return;
      }

      try {
        const response = await fetch(LATEST_RELEASE_ENDPOINT, {
          headers: {
            Accept: "application/vnd.github+json",
            "User-Agent": "docs-mcp-server-ui",
          },
        });

        if (!response.ok) {
          console.debug("Release check request failed", response.status);
          return;
        }

        const payload = (await response.json()) as GithubReleaseResponse;
        const tagName = payload.tag_name;

        if (!isVersionNewer(tagName, this.currentVersion)) {
          return;
        }

        const releaseLabel =
          (typeof tagName === "string" && tagName.trim().length > 0
            ? tagName.trim()
            : null) ?? fallbackReleaseLabel(tagName);

        if (!releaseLabel) {
          return;
        }

        this.latestVersionLabel = releaseLabel;
        this.latestReleaseUrl =
          typeof payload.html_url === "string" && payload.html_url.trim().length
            ? payload.html_url
            : LATEST_RELEASE_FALLBACK_URL;
        this.hasUpdate = true;
      } catch (error) {
        console.debug("Release check request threw", error);
      }
    },
  }));
});

// Ensure Alpine global store for confirmation actions is initialized before Alpine components render
Alpine.store("confirmingAction", {
  type: null,
  id: null,
  timeoutId: null,
  isDeleting: false,
});

Alpine.start();

// Initialize Flowbite components
initFlowbite();

// Add a global event listener for 'job-list-refresh' that uses HTMX to reload the job list
// This is still useful for manual refresh after actions like clearing jobs
document.addEventListener("job-list-refresh", () => {
  htmx.ajax("get", "/web/jobs", "#job-queue");
});

// Auto-refresh job list every 3 seconds for real-time progress updates
function autoRefreshJobList() {
  // Only refresh if the job queue element exists on the current page
  if (document.querySelector("#job-queue")) {
    htmx.ajax("get", "/web/jobs", "#job-queue");
  }
}

// Global variable to track the current interval
let autoRefreshInterval = setInterval(autoRefreshJobList, 3000);

// Stop auto-refresh when page is hidden to save resources
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    clearInterval(autoRefreshInterval);
  } else {
    // Restart auto-refresh when page becomes visible again
    autoRefreshInterval = setInterval(autoRefreshJobList, 3000);
  }
});

// Add a global event listener for 'version-list-refresh' that reloads the version list container using HTMX
document.addEventListener("version-list-refresh", (event: Event) => {
  const customEvent = event as CustomEvent<{ library: string }>;
  const library = customEvent.detail?.library;
  if (library) {
    htmx.ajax(
      "get",
      `/web/libraries/${encodeURIComponent(library)}/versions`,
      "#version-list",
    );
  }
});

// Listen for htmx swaps after a version delete and dispatch version-list-refresh with payload
document.body.addEventListener("htmx:afterSwap", (event) => {
  // Always re-initialize AlpineJS for swapped-in DOM to fix $store errors
  if (event.target instanceof HTMLElement) {
    Alpine.initTree(event.target);
  }

  // Existing logic for version delete refresh
  const detail = (event as CustomEvent).detail;
  if (
    detail?.xhr?.status === 204 &&
    detail?.requestConfig?.verb === "delete" &&
    (event.target as HTMLElement)?.id?.startsWith("row-")
  ) {
    // Extract library name from the row id: row-<library>-<version>
    const rowId = (event.target as HTMLElement).id;
    const match = rowId.match(/^row-([^-]+)-/);
    const library = match ? match[1] : null;
    if (library) {
      document.dispatchEvent(
        new CustomEvent("version-list-refresh", { detail: { library } }),
      );
    } else {
      window.location.reload();
    }
  }
});
