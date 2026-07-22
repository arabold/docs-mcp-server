/**
 * Theme preference hook: light / dark / auto.
 *
 * "auto" removes the `data-theme` attribute from `<html>` so the CSS
 * `@media (prefers-color-scheme: dark)` block in `styles/theme.css` governs;
 * an explicit "light"/"dark" choice stamps `data-theme` so the
 * `:root[data-theme="..."]` override blocks win instead. The choice is
 * persisted to `localStorage` so it survives reloads.
 *
 * Backed by a module-level store (via `useSyncExternalStore`) rather than
 * local `useState`, so every `useTheme()` call anywhere in the app — not
 * just the one in `ThemeToggle` — reads the same live value and re-renders
 * when it changes. No Context provider needed for that.
 */
import { useCallback, useSyncExternalStore } from "react";

/** A user-selectable theme preference. "auto" follows the OS setting. */
export type ThemePreference = "light" | "dark" | "auto";

/** The theme actually in effect once "auto" is resolved against the OS. */
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "docs-mcp-theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

function readStoredPreference(): ThemePreference {
  if (typeof window === "undefined") return "auto";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === "light" || stored === "dark" || stored === "auto" ? stored : "auto";
}

function applyThemeAttribute(preference: ThemePreference): void {
  const root = document.documentElement;
  if (preference === "auto") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", preference);
  }
}

// Module-level state, applied immediately (before React even mounts) so
// there's no flash of the wrong theme on first paint.
let currentPreference: ThemePreference = readStoredPreference();
const listeners = new Set<() => void>();

if (typeof document !== "undefined") {
  applyThemeAttribute(currentPreference);
}

function setPreference(next: ThemePreference): void {
  currentPreference = next;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, next);
  }
  applyThemeAttribute(next);
  for (const listener of listeners) listener();
}

function subscribePreference(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getPreferenceSnapshot(): ThemePreference {
  return currentPreference;
}

function getSystemThemeSnapshot(): ResolvedTheme {
  if (typeof window === "undefined" || !window.matchMedia) return "light";
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

function subscribeSystemTheme(listener: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mql = window.matchMedia(DARK_QUERY);
  mql.addEventListener("change", listener);
  return () => mql.removeEventListener("change", listener);
}

export interface UseThemeResult {
  /** The stored preference: "light", "dark", or "auto". */
  preference: ThemePreference;
  /** The theme actually applied right now (auto resolved to light/dark). */
  resolvedTheme: ResolvedTheme;
  /** Sets an explicit preference and persists it. */
  setTheme: (preference: ThemePreference) => void;
  /** Cycles auto -> light -> dark -> auto, matching the topbar toggle button. */
  cycleTheme: () => void;
}

/**
 * Reads and updates the current theme preference, keeping `<html data-theme>`
 * and `localStorage` in sync with the returned state.
 */
export function useTheme(): UseThemeResult {
  const preference = useSyncExternalStore(subscribePreference, getPreferenceSnapshot);
  const systemTheme = useSyncExternalStore(subscribeSystemTheme, getSystemThemeSnapshot);

  const setTheme = useCallback((next: ThemePreference) => setPreference(next), []);

  const cycleTheme = useCallback(() => {
    setPreference(
      currentPreference === "auto"
        ? "light"
        : currentPreference === "light"
          ? "dark"
          : "auto",
    );
  }, []);

  const resolvedTheme: ResolvedTheme = preference === "auto" ? systemTheme : preference;

  return { preference, resolvedTheme, setTheme, cycleTheme };
}
