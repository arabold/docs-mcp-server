/**
 * Optional companion package for `@arabold/docs-mcp-server`.
 *
 * This package exists only to carry and re-export the heavy `@huggingface/transformers`
 * dependency (ONNX runtime, ~hundreds of MB) so that the main server install stays small for
 * users who do not need local embeddings. The main server imports this package lazily and
 * only when a `transformers:` embedding model is selected.
 *
 * Re-exporting (rather than having the server depend on `@huggingface/transformers` directly)
 * keeps module resolution deterministic: the server imports this companion by name, and the
 * companion resolves `@huggingface/transformers` from its own dependency tree regardless of
 * how the package manager hoists or nests it.
 */

export type { FeatureExtractionPipeline } from "@huggingface/transformers";
export { env, pipeline } from "@huggingface/transformers";
