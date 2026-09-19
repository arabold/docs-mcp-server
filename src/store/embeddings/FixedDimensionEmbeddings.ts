import { Embeddings } from "@langchain/core/embeddings";
import { DimensionError } from "../errors";

/**
 * Wrapper around an Embeddings implementation that ensures vectors have a fixed dimension.
 * - If a vector's dimension is greater than the target and truncation is allowed,
 *   the vector is truncated (e.g., for models that support MRL - Matryoshka
 *   Representation Learning).
 * - If a vector's dimension is greater than the target and truncation is not
 *   allowed, a DimensionError is thrown.
 * - If a vector's dimension is less than the target, it is padded with zeros.
 */
export class FixedDimensionEmbeddings extends Embeddings {
  constructor(
    private readonly embeddings: Embeddings,
    private readonly targetDimension: number,
    /** The model specification, kept verbatim for error messages. */
    private readonly providerAndModel: string,
    public readonly allowTruncate: boolean = false,
  ) {
    super({});
  }

  /**
   * Normalize a vector to the target dimension by truncating (for MRL models) or padding.
   * @throws {DimensionError} If vector is too large and provider doesn't support MRL
   */
  private normalizeVector(vector: number[]): number[] {
    const dimension = vector.length;

    if (dimension > this.targetDimension) {
      // If truncation is allowed (e.g., for MRL models like Gemini), truncate the vector
      if (this.allowTruncate) {
        return vector.slice(0, this.targetDimension);
      }
      // Otherwise, throw an error
      throw new DimensionError(this.providerAndModel, dimension, this.targetDimension);
    }

    if (dimension < this.targetDimension) {
      // Pad with zeros to reach target dimension
      return [...vector, ...new Array(this.targetDimension - dimension).fill(0)];
    }

    return vector;
  }

  async embedQuery(text: string): Promise<number[]> {
    const vector = await this.embeddings.embedQuery(text);
    return this.normalizeVector(vector);
  }

  async embedDocuments(documents: string[]): Promise<number[][]> {
    const vectors = await this.embeddings.embedDocuments(documents);
    return vectors.map((vector) => this.normalizeVector(vector));
  }
}
