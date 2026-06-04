// ============================================================================
// Performance Optimization - Caching Layer
// ============================================================================

import type { CommunityContext, ArticleNode, PathNode } from "../shared/types";
import logger from "../shared/logger";

// ----------------------------------------------------------------------------
// Cache Configuration
// ----------------------------------------------------------------------------

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  hits: number;
}

export interface CacheConfig {
  ttl: number; // Time to live in milliseconds
  maxSize: number; // Maximum number of entries per cache
}

const DEFAULT_CACHE_CONFIG: CacheConfig = {
  ttl: 30 * 60 * 1000, // 30 minutes
  maxSize: 1000,
};

// ----------------------------------------------------------------------------
// Generic Cache
// ----------------------------------------------------------------------------

export class Cache<T> {
  private cache: Map<string, CacheEntry<T>> = new Map();
  private hits = 0;
  private misses = 0;

  constructor(private config: CacheConfig = DEFAULT_CACHE_CONFIG) {}

  get(key: string): T | undefined {
    const entry = this.cache.get(key);

    if (!entry) {
      this.misses++;
      return undefined;
    }

    // Check if entry has expired
    if (Date.now() - entry.timestamp > this.config.ttl) {
      this.cache.delete(key);
      this.misses++;
      return undefined;
    }

    entry.hits++;
    this.hits++;
    return entry.data;
  }

  set(key: string, data: T): void {
    // Evict oldest entry if cache is full
    if (this.cache.size >= this.config.maxSize) {
      let oldestKey: string | null = null;
      let oldestTime = Date.now();

      for (const [k, v] of this.cache.entries()) {
        if (v.timestamp < oldestTime) {
          oldestTime = v.timestamp;
          oldestKey = k;
        }
      }

      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      hits: 0,
    });
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  get size(): number {
    return this.cache.size;
  }

  getStats(): { hits: number; misses: number; hitRate: number } {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
    };
  }
}

// ----------------------------------------------------------------------------
// Specialized Caches
// ----------------------------------------------------------------------------

/**
 * Cache for community contexts
 * Community contexts are expensive to compute (require graph traversal)
 * and are frequently accessed
 */
export class CommunityContextCache extends Cache<CommunityContext> {
  constructor() {
    super({
      ttl: 60 * 60 * 1000, // 1 hour - community contexts change rarely
      maxSize: 500,
    });
  }

  generateKey(articleId: string, level: number): string {
    return `community:${articleId}:${level}`;
  }

  async getOrCompute(
    articleId: string,
    level: number,
    computeFn: () => Promise<CommunityContext>,
  ): Promise<CommunityContext> {
    const key = this.generateKey(articleId, level);
    const cached = this.get(key);

    if (cached) {
      logger.debug(`Cache hit for community context: ${key}`);
      return cached;
    }

    logger.debug(`Cache miss for community context: ${key}, computing...`);
    const result = await computeFn();
    this.set(key, result);
    return result;
  }
}

/**
 * Cache for article nodes
 * Articles are frequently accessed during retrieval
 */
export class ArticleCache extends Cache<ArticleNode> {
  constructor() {
    super({
      ttl: 30 * 60 * 1000, // 30 minutes
      maxSize: 1000,
    });
  }

  async getOrCompute(
    articleId: string,
    computeFn: () => Promise<ArticleNode | null>,
  ): Promise<ArticleNode | null> {
    const cached = this.get(articleId);

    if (cached) {
      logger.debug(`Cache hit for article: ${articleId}`);
      return cached;
    }

    logger.debug(`Cache miss for article: ${articleId}, computing...`);
    const result = await computeFn();

    if (result) {
      this.set(articleId, result);
    }

    return result;
  }

  warmUp(articles: ArticleNode[]): void {
    logger.info(`Warming up article cache with ${articles.length} articles`);

    for (const article of articles) {
      this.set(article.id, article);
    }

    logger.info(`Article cache warmed up: ${this.size} entries`);
  }
}

/**
 * Cache for path traversal results
 * Path computation is expensive due to graph traversal
 */
export class PathCache extends Cache<PathNode[]> {
  constructor() {
    super({
      ttl: 15 * 60 * 1000, // 15 minutes - paths may change during updates
      maxSize: 200,
    });
  }

  generateKey(seedArticleId: string, maxDepth: number): string {
    return `path:${seedArticleId}:${maxDepth}`;
  }

  async getOrCompute(
    seedArticleId: string,
    maxDepth: number,
    computeFn: () => Promise<PathNode[]>,
  ): Promise<PathNode[]> {
    const key = this.generateKey(seedArticleId, maxDepth);
    const cached = this.get(key);

    if (cached) {
      logger.debug(`Cache hit for path: ${key}`);
      return cached;
    }

    logger.debug(`Cache miss for path: ${key}, computing...`);
    const result = await computeFn();
    this.set(key, result);
    return result;
  }
}

/**
 * LLM Response Cache
 * Cache LLM responses to avoid redundant API calls
 */
export class LLMResponseCache extends Cache<string> {
  constructor() {
    super({
      ttl: 24 * 60 * 60 * 1000, // 24 hours - LLM responses don't change
      maxSize: 2000,
    });
  }

  generateHash(prompt: string, model: string): string {
    // Simple hash function (in production, use a proper hash)
    return `${model}:${prompt.substring(0, 100)}${prompt.length}`;
  }

  async getOrGenerate(
    prompt: string,
    model: string,
    generateFn: () => Promise<string>,
  ): Promise<string> {
    const key = this.generateHash(prompt, model);
    const cached = this.get(key);

    if (cached) {
      logger.debug(`Cache hit for LLM response: ${key.substring(0, 50)}...`);
      return cached;
    }

    logger.debug(`Cache miss for LLM response, generating...`);
    const result = await generateFn();
    this.set(key, result);
    return result;
  }
}

// ----------------------------------------------------------------------------
// Cache Manager
// ----------------------------------------------------------------------------

export class CacheManager {
  public readonly communityContext: CommunityContextCache;
  public readonly articles: ArticleCache;
  public readonly paths: PathCache;
  public readonly llmResponses: LLMResponseCache;

  constructor() {
    this.communityContext = new CommunityContextCache();
    this.articles = new ArticleCache();
    this.paths = new PathCache();
    this.llmResponses = new LLMResponseCache();
  }

  /**
   * Get statistics for all caches
   */
  getAllStats(): Record<string, ReturnType<Cache<unknown>["getStats"]>> {
    return {
      communityContext: this.communityContext.getStats(),
      articles: this.articles.getStats(),
      paths: this.paths.getStats(),
      llmResponses: this.llmResponses.getStats(),
    };
  }

  /**
   * Clear all caches
   */
  clearAll(): void {
    this.communityContext.clear();
    this.articles.clear();
    this.paths.clear();
    this.llmResponses.clear();
    logger.info("All caches cleared");
  }

  /**
   * Log cache statistics
   */
  logStats(): void {
    const stats = this.getAllStats();

    logger.info("=== Cache Statistics ===");
    for (const [name, stat] of Object.entries(stats)) {
      logger.info(
        `${name}: ${stat.hits} hits, ${stat.misses} misses, ${(
          stat.hitRate * 100
        ).toFixed(1)}% hit rate`,
      );
    }
    logger.info("========================");
  }
}

// ----------------------------------------------------------------------------
// Singleton Instance
// ----------------------------------------------------------------------------

let cacheManagerInstance: CacheManager | null = null;

export function getCacheManager(): CacheManager {
  if (!cacheManagerInstance) {
    cacheManagerInstance = new CacheManager();
    logger.info("CacheManager initialized");
  }
  return cacheManagerInstance;
}

export function resetCacheManager(): void {
  if (cacheManagerInstance) {
    cacheManagerInstance.clearAll();
  }
  cacheManagerInstance = null;
}
