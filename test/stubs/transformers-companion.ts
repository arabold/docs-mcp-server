/**
 * Test-only stub for the optional `@arabold/docs-mcp-server-transformers` companion package.
 *
 * The real companion is a separately installed package whose build output (`dist/`) is not
 * produced during the test job. Vitest's import analysis statically resolves the dynamic
 * `import("@arabold/docs-mcp-server-transformers")` in `transformersLoader.ts`, which would
 * fail when that build output is absent. A `test.alias` entry maps the companion specifier to
 * this stub so resolution always succeeds.
 *
 * Tests that exercise local embeddings mock the loader (`./transformersLoader`) directly, so
 * this stub is never actually invoked; it throws if it ever is, to surface accidental use.
 */

export const pipeline = (): never => {
  throw new Error(
    "transformers companion stub should not be invoked in tests; mock the loader instead",
  );
};

export const env: Record<string, unknown> = {};
