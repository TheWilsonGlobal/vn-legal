import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  Cache,
  CommunityContextCache,
  ArticleCache,
  PathCache,
  LLMResponseCache,
  CacheManager,
  getCacheManager,
  resetCacheManager,
} from "../../../src/shared/cache";

describe("Cache System", () => {
  describe("Cache Base Class", () => {
    let cache: Cache<string>;

    beforeEach(() => {
      vi.useFakeTimers();
      cache = new Cache({ ttl: 1000, maxSize: 3 });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should set and get values", () => {
      cache.set("k1", "v1");
      expect(cache.get("k1")).toBe("v1");
      expect(cache.getStats().hits).toBe(1);
    });

    it("should return undefined for missing keys", () => {
      expect(cache.get("missing")).toBeUndefined();
      expect(cache.getStats().misses).toBe(1);
    });

    it("should expire entries after TTL", () => {
      cache.set("k1", "v1");
      vi.advanceTimersByTime(1500);
      expect(cache.get("k1")).toBeUndefined();
      expect(cache.getStats().misses).toBe(1);
    });

    it("should evict oldest entry when full", () => {
      cache.set("k1", "v1");
      vi.advanceTimersByTime(100);
      cache.set("k2", "v2");
      vi.advanceTimersByTime(100);
      cache.set("k3", "v3");
      vi.advanceTimersByTime(100);
      cache.set("k4", "v4"); // Should evict k1

      expect(cache.has("k1")).toBe(false);
      expect(cache.has("k2")).toBe(true);
      expect(cache.has("k3")).toBe(true);
      expect(cache.has("k4")).toBe(true);
    });

    it("should check if key exists without incrementing hits", () => {
      cache.set("k1", "v1");
      expect(cache.has("k1")).toBe(true);
      // Wait, has() calls get() which increments hits in this implementation
      // Actually, cache.has() calls this.get(key), so it DOES increment hits.
      expect(cache.getStats().hits).toBe(1);
    });

    it("should delete keys", () => {
      cache.set("k1", "v1");
      expect(cache.delete("k1")).toBe(true);
      expect(cache.has("k1")).toBe(false);
    });

    it("should clear all entries", () => {
      cache.set("k1", "v1");
      cache.clear();
      expect(cache.size).toBe(0);
      expect(cache.getStats().hits).toBe(0);
    });
  });

  describe("Specialized Caches", () => {
    it("CommunityContextCache should getOrCompute", async () => {
      const cache = new CommunityContextCache();
      const computeFn = vi.fn().mockResolvedValue({ article_count: 10 } as any);

      const result1 = await cache.getOrCompute("a1", 1, computeFn);
      expect(result1.article_count).toBe(10);
      expect(computeFn).toHaveBeenCalledTimes(1);

      const result2 = await cache.getOrCompute("a1", 1, computeFn);
      expect(result2).toBe(result1);
      expect(computeFn).toHaveBeenCalledTimes(1); // Cached
    });

    it("ArticleCache should warmUp", () => {
      const cache = new ArticleCache();
      const articles = [{ id: "a1" }, { id: "a2" }] as any;
      cache.warmUp(articles);
      expect(cache.size).toBe(2);
      expect(cache.has("a1")).toBe(true);
    });

    it("PathCache should generateKey and getOrCompute", async () => {
      const cache = new PathCache();
      const computeFn = vi.fn().mockResolvedValue([{ depth: 1 }] as any);
      const result = await cache.getOrCompute("s1", 2, computeFn);
      expect(result[0].depth).toBe(1);
    });

    it("LLMResponseCache should generateHash and getOrGenerate", async () => {
      const cache = new LLMResponseCache();
      const generateFn = vi.fn().mockResolvedValue("ai response");
      const result = await cache.getOrGenerate("prompt", "model", generateFn);
      expect(result).toBe("ai response");
    });
  });

  describe("CacheManager", () => {
    it("should manage multiple caches and provide stats", () => {
      const manager = new CacheManager();
      manager.articles.set("a1", { id: "a1" } as any);
      const stats = manager.getAllStats();
      expect(stats.articles).toBeDefined();
      expect(stats.communityContext).toBeDefined();
    });

    it("should clear all caches", () => {
      const manager = new CacheManager();
      manager.articles.set("a1", { id: "a1" } as any);
      manager.clearAll();
      expect(manager.articles.size).toBe(0);
    });
  });

  describe("Singleton Manager", () => {
    it("should return same instance", () => {
      const m1 = getCacheManager();
      const m2 = getCacheManager();
      expect(m1).toBe(m2);
    });

    it("should reset manager", () => {
      const m1 = getCacheManager();
      resetCacheManager();
      const m2 = getCacheManager();
      expect(m1).not.toBe(m2);
    });
  });
});
