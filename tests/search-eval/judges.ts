/**
 * Judge model selection and validation for the search benchmark.
 *
 * The benchmark MUST pin its judge to a current, non-deprecated model from a
 * supported provider, and MUST reject deprecated identifiers at startup. The
 * allowlist below is the single source of truth; update it when introducing
 * new judges or retiring old ones (and bump the spec's open question if the
 * default changes).
 */

import type { JudgeAllowlistEntry } from "./types";

/** Default judge — see design.md Decision 4. */
export const DEFAULT_JUDGE = "openai:gpt-5.4-mini";

export const JUDGE_ALLOWLIST: readonly JudgeAllowlistEntry[] = [
  // OpenAI
  { id: "openai:gpt-5.4-mini", provider: "openai" },
  { id: "openai:gpt-5", provider: "openai" },
  // Anthropic
  { id: "anthropic:claude-sonnet-4-6", provider: "anthropic" },
  { id: "anthropic:claude-opus-4-7", provider: "anthropic" },
  // Google
  { id: "google:gemini-3-flash-preview", provider: "google" },
  { id: "google:gemini-3.1-flash-lite", provider: "google" },

  // Explicitly deprecated — listed so the error message can name them.
  { id: "openai:gpt-4o-mini", provider: "openai", deprecated: true },
  { id: "openai:gpt-4o", provider: "openai", deprecated: true },
  { id: "openai:gpt-3.5-turbo", provider: "openai", deprecated: true },
  { id: "openai:gpt-4-turbo", provider: "openai", deprecated: true },
];

export interface ResolvedJudge {
  id: string;
  provider: "openai" | "anthropic" | "google";
  crossJudge?: string;
}

export class JudgeConfigError extends Error {}

/**
 * Resolve and validate a judge identifier. Throws JudgeConfigError on a
 * deprecated or unknown model so the benchmark fails fast before burning
 * any LLM calls.
 */
export function resolveJudge(id: string): ResolvedJudge {
  const entry = JUDGE_ALLOWLIST.find((e) => e.id === id);
  if (!entry) {
    throw new JudgeConfigError(
      `Unknown judge model "${id}". Allowed: ${JUDGE_ALLOWLIST.filter(
        (e) => !e.deprecated,
      )
        .map((e) => e.id)
        .join(", ")}.`,
    );
  }
  if (entry.deprecated) {
    throw new JudgeConfigError(
      `Judge model "${id}" is deprecated for benchmarking. Pick one of: ${JUDGE_ALLOWLIST.filter(
        (e) => !e.deprecated,
      )
        .map((e) => e.id)
        .join(", ")}.`,
    );
  }
  return { id: entry.id, provider: entry.provider };
}

/**
 * Pick a sensible cross-judge: a non-deprecated model from a *different*
 * provider than the primary. Returns the first such entry in the allowlist,
 * or null if none exists.
 */
export function pickDefaultCrossJudge(primary: ResolvedJudge): string | null {
  const candidate = JUDGE_ALLOWLIST.find(
    (e) => !e.deprecated && e.provider !== primary.provider,
  );
  return candidate?.id ?? null;
}

/**
 * Read DOCS_EVAL_JUDGE from env, falling back to the pinned default.
 * Returns the resolved judge or throws JudgeConfigError.
 */
export function judgeFromEnv(env: NodeJS.ProcessEnv = process.env): ResolvedJudge {
  const requested = env.DOCS_EVAL_JUDGE?.trim() || DEFAULT_JUDGE;
  return resolveJudge(requested);
}
