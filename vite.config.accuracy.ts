import type { ViteUserConfig as UserConfig } from "vitest/config";
import baseConfig from "./vite.config";

/**
 * Vitest config for the search accuracy benchmark.
 *
 * The benchmark downloads its corpus and calls the configured embedding
 * provider, so it runs without `setup-e2e.ts` (whose MSW server refuses every
 * outside request) and is never part of the default test run. Its summary is
 * printed by a passing test, so output stays on.
 *
 * Used by `npm run evaluate:accuracy` and `npm run evaluate:accuracy:baseline`.
 */
const base = baseConfig as UserConfig;
// The benchmark reads the provider's credentials from `.env`, which the base
// config hides from every test run.
const { DOTENV_CONFIG_PATH: _hiddenDotenv, ...env } = base.test?.env ?? {};

export default {
  ...base,
  test: {
    ...base.test,
    env,
    include: ["tests/search-accuracy/accuracy.eval.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    setupFiles: ["test/setup-env.ts"],
    globalSetup: [],
    silent: false,
    testTimeout: 60 * 60 * 1000,
  },
} satisfies UserConfig;
