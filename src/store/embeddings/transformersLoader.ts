/**
 * Lazy loader for the optional `@arabold/docs-mcp-server-transformers` companion package.
 *
 * Local embeddings rely on `@huggingface/transformers`, whose native ONNX runtime is large.
 * To keep the default server install lightweight, that dependency lives in a separate
 * companion package which is only loaded when a `transformers:` model is selected.
 *
 * The main server never imports `@huggingface/transformers` (or the companion) at module load
 * time, not even its types: the structural types below describe the minimal surface we use, so
 * type-checking and bundling never pull in the heavy package.
 */

/** Minimal structural type for a feature-extraction tensor returned by Transformers.js. */
export interface FeatureExtractionTensor {
  data: Float32Array | number[];
  dims: number[];
}

/** Minimal structural type for the feature-extraction pipeline used by this server. */
export type FeatureExtractionPipeline = (
  input: string | string[],
  options?: { pooling?: "mean" | "cls" | "none"; normalize?: boolean },
) => Promise<FeatureExtractionTensor>;

/** Minimal surface of the companion module consumed by this server. */
export interface TransformersModule {
  pipeline: (
    task: "feature-extraction",
    model: string,
    options?: { device?: "cpu" | "webgpu" },
  ) => Promise<FeatureExtractionPipeline>;
  /** Shared, mutable Transformers.js environment singleton (used to configure `cacheDir`). */
  env: { cacheDir?: string } & Record<string, unknown>;
}

const COMPANION_PACKAGE = "@arabold/docs-mcp-server-transformers";

/**
 * Error thrown when the optional Transformers.js companion package is not installed.
 */
export class TransformersCompanionMissingError extends Error {
  constructor(cause?: unknown) {
    super(
      `❌ Local embeddings require the optional companion package "${COMPANION_PACKAGE}".\n` +
        "   Install it alongside the server, e.g.:\n" +
        `     npm install -g @arabold/docs-mcp-server ${COMPANION_PACKAGE}\n` +
        "   (The official Docker image already includes it.)",
      { cause },
    );
    this.name = "TransformersCompanionMissingError";
  }
}

let modulePromise: Promise<TransformersModule> | null = null;

/**
 * Dynamically loads the Transformers.js companion package.
 * Caches the import promise so the heavy module is initialized at most once.
 *
 * @returns The minimal companion module surface (`pipeline`, `env`).
 * @throws {TransformersCompanionMissingError} If the companion package is not installed.
 */
export async function loadTransformers(): Promise<TransformersModule> {
  if (modulePromise === null) {
    // The specifier must be a string literal so the bundler can externalize it and preserve
    // the dynamic import instead of trying to bundle the companion.
    modulePromise = import("@arabold/docs-mcp-server-transformers")
      .then((mod) => mod as unknown as TransformersModule)
      .catch((error: unknown) => {
        modulePromise = null; // allow a later retry (e.g. after the user installs it)
        if (isCompanionMissingError(error)) {
          throw new TransformersCompanionMissingError(error);
        }
        throw error;
      });
  }
  return modulePromise;
}

/**
 * Resets the cached companion import. Intended for tests only.
 */
export function resetTransformersLoader(): void {
  modulePromise = null;
}

/**
 * Determines whether a dynamic-import error means the companion package itself is missing,
 * as opposed to a broken file inside an installed companion or a failing transitive
 * dependency. Only a truly-missing package should be reported as "install the companion".
 *
 * A missing bare specifier produces a Node error whose message quotes the exact package name
 * (e.g. `Cannot find package '@arabold/...'`). A broken internal file instead quotes a file
 * path, and a missing export path uses a different code (`ERR_PACKAGE_PATH_NOT_EXPORTED`),
 * so both are correctly excluded here and rethrown unchanged.
 */
export function isCompanionMissingError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const code = (error as { code?: string }).code;
  const message = (error as { message?: string }).message ?? "";
  const isModuleNotFound = code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND";
  // Require the package name to appear as a quoted bare specifier, not merely as a substring
  // (which would also match an internal file path under the companion's directory).
  return isModuleNotFound && message.includes(`'${COMPANION_PACKAGE}'`);
}
