/**
 * Built-in blocklist of third-party sub-resource origins that pages commonly
 * load during rendering but that never carry documentation content.
 *
 * Consulted from `HtmlPlaywrightMiddleware.setupCachingRouteInterception` to
 * abort matching requests before any bytes transfer. The list is intentionally
 * hand-curated and lives in code (not config) so that new entries ship to every
 * user on release — see `openspec/changes/add-subresource-blocklist/design.md`
 * for the rationale.
 *
 * Categories included: Analytics, Session Replay, Chat Widgets, Captcha, and
 * Social Embed runtimes. Two categories are deliberately excluded:
 *
 * - **Advertising networks** (e.g. doubleclick.net, googlesyndication.com) —
 *   blocking these can trigger anti-adblock detection on monetized sites.
 * - **Generic CDNs** (e.g. unpkg.com, cdn.jsdelivr.net) — pages legitimately
 *   fetch content-bearing libraries (Mermaid, KaTeX, MathJax) from them.
 */

export type BlocklistCategory =
  | "Analytics"
  | "Session Replay"
  | "Chat Widget"
  | "Captcha"
  | "Social Embed";

interface HostEntry {
  host: string;
  category: BlocklistCategory;
}

interface HostPathEntry {
  host: string;
  pathPrefix: string;
  category: BlocklistCategory;
}

type BlocklistEntry = HostEntry | HostPathEntry;

export type BlocklistMatch =
  | { blocked: true; category: BlocklistCategory }
  | { blocked: false };

const BLOCKLIST_NOT_BLOCKED: BlocklistMatch = Object.freeze({ blocked: false });

export const SUBRESOURCE_BLOCKLIST: ReadonlyArray<BlocklistEntry> = Object.freeze([
  // Analytics — page-view and event tracking SDKs; no content.
  { host: "google-analytics.com", category: "Analytics" },
  { host: "googletagmanager.com", category: "Analytics" },
  { host: "segment.io", category: "Analytics" },
  { host: "segment.com", category: "Analytics" },
  { host: "mixpanel.com", category: "Analytics" },
  { host: "amplitude.com", category: "Analytics" },
  { host: "plausible.io", category: "Analytics" },
  { host: "matomo.cloud", category: "Analytics" },
  { host: "stats.wp.com", category: "Analytics" },

  // Session Replay — record user interactions; never content.
  { host: "hotjar.com", category: "Session Replay" },
  { host: "fullstory.com", category: "Session Replay" },
  { host: "logrocket.com", category: "Session Replay" },
  { host: "lr-ingest.io", category: "Session Replay" },
  { host: "smartlook.com", category: "Session Replay" },

  // Chat Widgets — UI overlays the sanitizer strips post-fetch anyway.
  { host: "intercom.io", category: "Chat Widget" },
  { host: "intercomcdn.com", category: "Chat Widget" },
  { host: "widget.kapa.ai", category: "Chat Widget" },
  { host: "drift.com", category: "Chat Widget" },
  { host: "driftt.com", category: "Chat Widget" },
  { host: "crisp.chat", category: "Chat Widget" },
  { host: "tawk.to", category: "Chat Widget" },
  { host: "zdassets.com", category: "Chat Widget" },

  // Captcha — challenge runtimes; documentation pages don't need them.
  { host: "hcaptcha.com", category: "Captcha" },
  { host: "recaptcha.net", category: "Captcha" },

  // Social Embed runtimes — the embed-document iframe is allowed (document type
  // is exempt at the route handler); only the runtime JS is blocked.
  {
    host: "youtube-nocookie.com",
    pathPrefix: "/s/_/ytembeds/",
    category: "Social Embed",
  },
  { host: "platform.twitter.com", category: "Social Embed" },
  { host: "connect.facebook.net", category: "Social Embed" },
  { host: "platform.linkedin.com", category: "Social Embed" },
] satisfies ReadonlyArray<BlocklistEntry>);

// Validate entries at module load — catches typos before any request fires.
for (const entry of SUBRESOURCE_BLOCKLIST) {
  if (!entry.host || entry.host.includes("/") || entry.host.includes(":")) {
    throw new Error(
      `Invalid blocklist entry: host must be a bare hostname (got "${entry.host}")`,
    );
  }
  if ("pathPrefix" in entry && !entry.pathPrefix.startsWith("/")) {
    throw new Error(
      `Invalid blocklist entry for "${entry.host}": pathPrefix must start with "/" (got "${entry.pathPrefix}")`,
    );
  }
}

function hostMatches(requestHost: string, entryHost: string): boolean {
  if (requestHost === entryHost) return true;
  return requestHost.endsWith(`.${entryHost}`);
}

/**
 * Checks whether a URL is on the built-in blocklist.
 *
 * Matching rules:
 * - Hostname matches when it equals an entry's host or ends with `.<entry-host>`
 *   (label boundary), so `evil-google-analytics.com` does not match
 *   `google-analytics.com`.
 * - When an entry has a `pathPrefix`, the URL's pathname must also start with
 *   that prefix.
 * - Invalid URLs return `{ blocked: false }` rather than throwing.
 */
export function isBlockedSubresource(url: string): BlocklistMatch {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return BLOCKLIST_NOT_BLOCKED;
  }

  const host = parsed.hostname;
  for (const entry of SUBRESOURCE_BLOCKLIST) {
    if (!hostMatches(host, entry.host)) continue;
    if ("pathPrefix" in entry && !parsed.pathname.startsWith(entry.pathPrefix)) {
      continue;
    }
    return { blocked: true, category: entry.category };
  }
  return BLOCKLIST_NOT_BLOCKED;
}
