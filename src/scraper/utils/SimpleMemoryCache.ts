/**
 * A simple in-memory LRU (Least Recently Used) cache.
 * When the cache reaches maxSize, the oldest (least recently used) entry is evicted.
 *
 * This implementation uses a Map to maintain insertion order, where:
 * - get() moves the accessed key to the end (marks as recently used)
 * - set() adds to the end (most recent)
 * - When full, the first key (oldest) is deleted
 */
export class SimpleMemoryCache<K, V> {
  private cache: Map<K, V>;
  private readonly maxSize: number;

  constructor(maxSize: number) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  /**
   * Retrieve a value from the cache.
   * Marks the key as recently used (moves to end of Map).
   */
  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Move to end (mark as recently used)
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  /**
   * Store a value in the cache.
   * If cache is full, evicts the oldest entry first.
   */
  set(key: K, value: V): void {
    // If key exists, delete it first so we can re-add at end
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Cache is full and this is a new key - evict oldest (first key)
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, value);
  }

  /**
   * Check if a key exists in the cache.
   */
  has(key: K): boolean {
    return this.cache.get(key) !== undefined;
  }

  /**
   * Get current cache size.
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Clear all entries from the cache.
   */
  clear(): void {
    this.cache.clear();
  }
}
