import type { UserConfig } from "vitest/config";
import baseConfig from "./vite.config";

/**
 * Vitest config for the live e2e suite.
 *
 * The default config excludes the live e2e tests so that a bare `vitest` —
 * including watch mode — never hits real documentation sites. The CLI cannot
 * undo that: `--exclude` only *adds* globs, and `mergeConfig` concatenates
 * them. So running those tests needs a config that replaces the exclude list
 * outright, which is what this one does.
 *
 * Used by `npm run test:live`.
 */
const base = baseConfig as UserConfig;

export default {
  ...base,
  test: {
    ...base.test,
    exclude: ["**/node_modules/**", "**/dist/**"],
    // No `setup-e2e.ts`: it starts the MSW mock server, which intercepts every
    // request. These tests deliberately hit the real internet, and MSW's
    // passthrough path throws on each one.
    setupFiles: ["test/setup-env.ts"],
  },
} satisfies UserConfig;
