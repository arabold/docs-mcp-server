/**
 * Shared icon system: a single inline `<svg>` sprite (`IconSprite`) mounted
 * once by the app shell, plus a lightweight `Icon` component that references
 * a symbol from it via `<use href="#...">`. Every symbol id and path comes
 * verbatim from the admin mockup's icon sprite.
 */
import type { CSSProperties, JSX } from "react";

/** Every icon symbol id defined by {@link IconSprite}. */
export type IconName =
  | "i-grid"
  | "i-books"
  | "i-queue"
  | "i-search"
  | "i-settings"
  | "i-plus"
  | "i-refresh"
  | "i-trash"
  | "i-ext"
  | "i-sun"
  | "i-moon"
  | "i-auto"
  | "i-db"
  | "i-file"
  | "i-layers"
  | "i-close"
  | "i-bolt"
  | "i-clock"
  | "i-up"
  | "i-x"
  | "i-check"
  | "i-globe"
  | "i-chevron";

export interface IconProps {
  /** Symbol id to render, e.g. `"i-search"`. */
  name: IconName;
  /** Size preset matching the mockup's `.icon`/`.icon-sm`/`.icon-xs` classes. @default "md" */
  size?: "md" | "sm" | "xs";
  /** Extra class names appended after the size class. */
  className?: string;
  style?: CSSProperties;
}

/**
 * Renders a single icon from the shared sprite.
 * @example <Icon name="i-search" size="sm" />
 */
export function Icon({ name, size = "md", className, style }: IconProps) {
  const sizeClass = size === "md" ? "icon" : `icon icon-${size}`;
  const classes = className ? `${sizeClass} ${className}` : sizeClass;
  return (
    <svg className={classes} style={style} aria-hidden="true">
      <use href={`#${name}`} />
    </svg>
  );
}

/**
 * The icon sprite itself: a visually-hidden `<svg>` holding every `<symbol>`
 * the app references via {@link Icon}. Mount exactly once, near the root of
 * the app shell (see `components/Shell.tsx`) — `<use href="#i-...">` resolves
 * against any sprite present anywhere in the document.
 */
export function IconSprite(): JSX.Element {
  return (
    <svg
      width="0"
      height="0"
      style={{ position: "absolute" }}
      aria-hidden="true"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: static, hand-authored icon paths ported verbatim from the mockup sprite; no user input involved.
      dangerouslySetInnerHTML={{
        __html: `
  <symbol id="i-grid" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></symbol>
  <symbol id="i-books" viewBox="0 0 24 24"><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H9v16H5.5A1.5 1.5 0 0 1 4 18.5z"/><path d="M9 4h4v16H9z"/><path d="m13.5 4.5 3.6.7a1.5 1.5 0 0 1 1.2 1.75l-2.3 12.1a1.5 1.5 0 0 1-1.75 1.2L13 20"/></symbol>
  <symbol id="i-queue" viewBox="0 0 24 24"><path d="M3 12h4l2 5 4-13 2 8h6"/></symbol>
  <symbol id="i-search" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></symbol>
  <symbol id="i-settings" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></symbol>
  <symbol id="i-plus" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></symbol>
  <symbol id="i-refresh" viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6"/></symbol>
  <symbol id="i-trash" viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14"/></symbol>
  <symbol id="i-ext" viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6"/></symbol>
  <symbol id="i-sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.2"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></symbol>
  <symbol id="i-moon" viewBox="0 0 24 24"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></symbol>
  <symbol id="i-auto" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 3A9 9 0 0 0 12 21Z" fill="currentColor" stroke="none"/></symbol>
  <symbol id="i-db" viewBox="0 0 24 24"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.66 3.58 3 8 3s8-1.34 8-3V5"/><path d="M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3"/></symbol>
  <symbol id="i-file" viewBox="0 0 24 24"><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5"/></symbol>
  <symbol id="i-layers" viewBox="0 0 24 24"><path d="m12 3 9 5-9 5-9-5z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/></symbol>
  <symbol id="i-close" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></symbol>
  <symbol id="i-bolt" viewBox="0 0 24 24"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></symbol>
  <symbol id="i-clock" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></symbol>
  <symbol id="i-up" viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7"/></symbol>
  <symbol id="i-x" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></symbol>
  <symbol id="i-check" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></symbol>
  <symbol id="i-globe" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.5 3.8 5.8 3.8 9S14.5 18.5 12 21c-2.5-2.5-3.8-5.8-3.8-9S9.5 5.5 12 3z"/></symbol>
  <symbol id="i-chevron" viewBox="0 0 24 24"><path d="m9 5 7 7-7 7"/></symbol>
        `,
      }}
    />
  );
}
