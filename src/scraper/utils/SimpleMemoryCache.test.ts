import { describe, expect, it } from "vitest";
import { SimpleMemoryCache } from "./SimpleMemoryCache";

describe("SimpleMemoryCache", () => {
  it("should store, update, look up and clear entries", () => {
    const cache = new SimpleMemoryCache<string, string>(10);

    cache.set("key1", "value1");
    cache.set("key2", "value2");
    cache.set("key1", "updated");

    expect(cache.get("key1")).toBe("updated");
    expect(cache.get("missing")).toBeUndefined();
    expect(cache.has("key2")).toBe(true);
    expect(cache.has("missing")).toBe(false);
    expect(cache.size).toBe(2);

    cache.clear();

    expect(cache.size).toBe(0);
    expect(cache.get("key1")).toBeUndefined();
    expect(cache.get("key2")).toBeUndefined();
  });

  it("should enforce LRU eviction when full", () => {
    const cache = new SimpleMemoryCache<string, number>(3);
    cache.set("key1", 1);
    cache.set("key2", 2);
    cache.set("key3", 3);

    // Cache is full (3/3)
    expect(cache.size).toBe(3);

    // Adding 4th item should evict key1 (oldest)
    cache.set("key4", 4);
    expect(cache.size).toBe(3);
    expect(cache.get("key1")).toBeUndefined();
    expect(cache.get("key2")).toBe(2);
    expect(cache.get("key3")).toBe(3);
    expect(cache.get("key4")).toBe(4);

    // A cache of one keeps only the latest entry.
    const single = new SimpleMemoryCache<string, number>(1);
    single.set("key1", 1);
    expect(single.get("key1")).toBe(1);
    single.set("key2", 2);
    expect(single.get("key1")).toBeUndefined();
    expect(single.get("key2")).toBe(2);
    expect(single.size).toBe(1);
  });

  it("should mark accessed keys as recently used", () => {
    const cache = new SimpleMemoryCache<string, number>(3);
    cache.set("key1", 1);
    cache.set("key2", 2);
    cache.set("key3", 3);

    // Access key1 to mark it as recently used
    cache.get("key1");

    // Add key4, should evict key2 (now oldest, not key1)
    cache.set("key4", 4);
    expect(cache.get("key1")).toBe(1); // Still present
    expect(cache.get("key2")).toBeUndefined(); // Evicted
    expect(cache.get("key3")).toBe(3);
    expect(cache.get("key4")).toBe(4);
  });
});
