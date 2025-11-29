/**
 * Bootstraps the client-side experience for the Docs MCP Server web UI.
 * Initializes Alpine stores, HTMX helpers, Flowbite components, the
 * release checker that surfaces update notifications in the header,
 * and the unified event client for real-time updates.
 */
import "./styles/main.css";

import collapse from "@alpinejs/collapse";
import Alpine from "alpinejs";

// Register Alpine.js plugins before exposing globally
Alpine.plugin(collapse);

// Expose Alpine globally for Idiomorph and other extensions
(window as unknown as { Alpine: typeof Alpine }).Alpine = Alpine;

import { initFlowbite } from "flowbite";
import "idiomorph/htmx";
import { EventClient } from "./EventClient";
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

// Initialize toast store for global notifications
Alpine.store("toast", {
  visible: false,
  message: "",
  type: "info" as "success" | "error" | "warning" | "info",
  timeoutId: null as number | null,
  show(
    message: string,
    type: "success" | "error" | "warning" | "info" = "info",
    duration = 5000,
  ) {
    const store = Alpine.store("toast") as {
      timeoutId: number | null;
      message: string;
      type: "success" | "error" | "warning" | "info";
      visible: boolean;
      hide: () => void;
    };

    // Clear any existing timeout
    if (store.timeoutId !== null) {
      clearTimeout(store.timeoutId);
      store.timeoutId = null;
    }

    store.message = message;
    store.type = type;
    store.visible = true;

    // Auto-hide after duration
    store.timeoutId = window.setTimeout(() => {
      store.hide();
    }, duration);
  },
  hide() {
    const store = Alpine.store("toast") as {
      visible: boolean;
      timeoutId: number | null;
    };
    store.visible = false;
    if (store.timeoutId !== null) {
      clearTimeout(store.timeoutId);
      store.timeoutId = null;
    }
  },
});

Alpine.start();

// Initialize Flowbite components
initFlowbite();

// NOTE: job-status-change, job-progress, job-list-change, job-list-refresh, and library-change events
// are handled by hx-trigger attributes in the HTML templates (index.tsx).
// Do NOT add duplicate listeners here to avoid double requests and state corruption.

// Create and connect the unified event client
const eventClient = new EventClient();

// Subscribe to events and dispatch them as DOM events for HTMX
eventClient.subscribe((event) => {
  console.log(`📋 Received event: ${event.type}`, event.payload);
  // Dispatch custom event with payload that HTMX can listen to
  document.body.dispatchEvent(
    new CustomEvent(event.type, {
      detail: event.payload,
    }),
  );
});

// Start the connection
eventClient.connect();

// Clean up on page unload
window.addEventListener("beforeunload", () => {
  eventClient.disconnect();
});

// Central confirmation timeout manager
// Handles timeouts outside of Alpine so they survive DOM refreshes
const confirmationTimeouts = new Map<string, { timeoutId: number; expiresAt: number }>();

/**
 * Starts a confirmation timeout for an element.
 * When timeout expires, it clears the confirming state on the element.
 */
function startConfirmationTimeout(elementId: string, duration = 3000) {
  // Clear any existing timeout for this element
  clearConfirmationTimeout(elementId);

  const expiresAt = Date.now() + duration;
  const timeoutId = window.setTimeout(() => {
    // Timeout fired - clear the state
    confirmationTimeouts.delete(elementId);

    // Find the element and reset its state
    const el = document.getElementById(elementId);
    if (el) {
      const data = Alpine.$data(el) as { confirming?: boolean } | undefined;
      if (data) {
        data.confirming = false;
      }
    }
  }, duration);

  confirmationTimeouts.set(elementId, { timeoutId, expiresAt });
}

/**
 * Clears a confirmation timeout for an element.
 */
function clearConfirmationTimeout(elementId: string) {
  const entry = confirmationTimeouts.get(elementId);
  if (entry) {
    clearTimeout(entry.timeoutId);
    confirmationTimeouts.delete(elementId);
  }
}

/**
 * Checks if an element has an active confirmation state.
 */
function hasActiveConfirmation(elementId: string): boolean {
  const entry = confirmationTimeouts.get(elementId);
  return entry !== undefined && entry.expiresAt > Date.now();
}

// Expose functions globally for use in Alpine components
const confirmationManager = {
  start: startConfirmationTimeout,
  clear: clearConfirmationTimeout,
  isActive: hasActiveConfirmation,
};
(
  window as unknown as { confirmationManager: typeof confirmationManager }
).confirmationManager = confirmationManager;

// Handle Alpine lifecycle during HTMX swaps
document.body.addEventListener("htmx:beforeSwap", (event) => {
  const detail = (event as CustomEvent).detail;
  const target = detail?.target as HTMLElement;

  if (target) {
    // Destroy Alpine components before HTMX replaces the content
    Alpine.destroyTree(target);
  }
});

// Initialize Alpine on new content after HTMX swap
document.body.addEventListener("htmx:afterSwap", (event) => {
  const detail = (event as CustomEvent).detail;
  const target = detail?.target as HTMLElement;

  if (target) {
    // Restore confirmation state from central manager before Alpine init
    target.querySelectorAll<HTMLElement>("[x-data][id]").forEach((el) => {
      if (el.id && hasActiveConfirmation(el.id)) {
        el.dataset.confirming = "true";
      }
    });

    // Initialize Alpine components on the new content
    Alpine.initTree(target);
  }
});

// Global error handler for HTMX responses
document.body.addEventListener("htmx:responseError", (event) => {
  const detail = (event as CustomEvent).detail;
  const xhr = detail?.xhr;

  if (!xhr) return;

  let errorMessage = "An error occurred";

  // Try to parse JSON error response
  try {
    const contentType = xhr.getResponseHeader("content-type");
    if (contentType?.includes("application/json")) {
      const errorData = JSON.parse(xhr.response);
      errorMessage = errorData.message || errorData.error || errorMessage;
    } else if (xhr.response && typeof xhr.response === "string") {
      // If response is plain text, use it directly
      errorMessage = xhr.response;
    }
  } catch (_e) {
    // If parsing fails, use status text or generic message
    errorMessage = xhr.statusText || errorMessage;
  }

  // Show error toast
  const toastStore = Alpine.store("toast") as {
    show: (message: string, type: "error") => void;
  };
  toastStore.show(errorMessage, "error");

  // Prevent HTMX from swapping the error response into the DOM
  event.preventDefault();
});

// Global handler for successful responses that may include HX-Trigger with toast data
document.body.addEventListener("htmx:afterRequest", (event) => {
  const detail = (event as CustomEvent).detail;
  const xhr = detail?.xhr;

  if (!xhr || !xhr.getResponseHeader) return;

  // Check for HX-Trigger header with toast data
  const hxTrigger = xhr.getResponseHeader("HX-Trigger");
  if (hxTrigger) {
    try {
      const triggers = JSON.parse(hxTrigger);
      if (triggers.toast) {
        const toastStore = Alpine.store("toast") as {
          show: (message: string, type: "success" | "error" | "warning" | "info") => void;
        };
        toastStore.show(triggers.toast.message, triggers.toast.type || "info");
      }
    } catch (e) {
      console.debug("Failed to parse HX-Trigger header", e);
    }
  }
});
