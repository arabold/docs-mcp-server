/**
 * Provider-name helpers shared between run.ts, compare.ts, aggregate.ts, and
 * the comparison CLI. Keeping the list of known providers and the
 * normalisation rule in one place so they cannot drift apart — drift would
 * cause subtle bugs like a legacy baseline being silently treated as
 * compatible with a context7 run.
 */

/**
 * Every provider name that the benchmark currently knows how to drive.
 * The actual implementation registry (with exec-provider scripts, preflight
 * needs, etc.) lives in run.ts; this is the lighter view used by code that
 * only needs to *recognise* a provider name.
 *
 * Keep in sync with the PROVIDERS registry in run.ts.
 */
export const KNOWN_PROVIDER_NAMES = ["local", "context7"] as const;
export type ProviderName = (typeof KNOWN_PROVIDER_NAMES)[number];

/**
 * Normalise a raw provider value (from env, from a baseline file, etc.) to a
 * canonical string. Empty / whitespace-only / missing → `"local"`. Trims
 * surrounding whitespace; does NOT validate that the result is a known name
 * (the caller decides what to do with an unknown value).
 *
 * Mirrors the behaviour of run.ts's `resolveProvider()` so legacy baselines
 * (recorded before the `provider` field existed) compare cleanly against
 * fresh local runs.
 */
export function normalizeProviderName(raw: string | undefined | null): string {
  if (raw === undefined || raw === null) return "local";
  const trimmed = String(raw).trim();
  return trimmed || "local";
}

/** True iff `name` is one of the known providers above. */
export function isKnownProvider(name: string): name is ProviderName {
  return (KNOWN_PROVIDER_NAMES as readonly string[]).includes(name);
}
