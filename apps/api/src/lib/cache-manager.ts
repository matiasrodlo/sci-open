import Redis from 'ioredis';
import { createHash } from 'crypto';
import { MemoryCache } from './memory-cache';
import { log } from './logger';

/**
 * One cache: L1 in memory, L2 in Redis.
 *
 * Phase 10 collapsed three levels into two, and the third was not merely
 * redundant — it was silently defeating the other two.
 *
 * **L3 was a `Map` with no expiry, and `get` promoted from it.** Every `set`
 * wrote to all three levels; L1 and L2 carried TTLs and L3 carried none, and a
 * read that missed L1 and L2 found the value in L3 and wrote it *back* into
 * both. So once an entry reached L3 its TTLs stopped meaning anything and it
 * was served indefinitely — a search result cached once was never refetched.
 * The `l3` TTL in every strategy config (up to 24 hours) was declared and
 * never applied to anything. Demonstrated against the old code before removal.
 *
 * **Bounds are in bytes now.** See `MemoryCache`.
 *
 * **Invalidation addresses a subject rather than matching a substring.** The
 * old `invalidatePattern` did `key.includes(pattern)` against keys that
 * `generateKey` had md5-hashed, so it searched for exactly the substrings the
 * hash had removed. Every pattern invalidation in the paper and search cache
 * managers was a silent no-op, which phase 01 recorded as a failing test.
 * A key now carries its subject's hash verbatim, so the subject is addressable.
 *
 * **Redis is walked with SCAN.** The old code called `KEYS *pattern*` under a
 * comment claiming it used SCAN. `KEYS` blocks the server for the length of
 * the keyspace.
 */

export enum CacheStrategy {
  SEARCH_RESULTS = 'search_results',
  PAPER_DETAILS = 'paper_details',
  API_RESPONSES = 'api_responses',
  FACETS = 'facets',
  METADATA = 'metadata'
}

/** TTL in seconds per level. */
export interface CacheConfig {
  l1: number;
  l2: number;
}

export interface CacheMetrics {
  hits: number;
  misses: number;
  l1Hits: number;
  l2Hits: number;
  avgResponseTime: number;
  /** L1 occupancy, and the budget it is held under. */
  keys: number;
  bytes: number;
  maxBytes: number;
  evictions: number;
}

const STRATEGY_CONFIGS: Record<CacheStrategy, CacheConfig> = {
  [CacheStrategy.SEARCH_RESULTS]: { l1: 300, l2: 3600 },
  [CacheStrategy.PAPER_DETAILS]: { l1: 600, l2: 7200 },
  [CacheStrategy.API_RESPONSES]: { l1: 60, l2: 1800 },
  [CacheStrategy.FACETS]: { l1: 900, l2: 3600 },
  [CacheStrategy.METADATA]: { l1: 1800, l2: 14400 }
};

/**
 * How much heap L1 may hold. At the ~158 KB per cached page phase 01 measured
 * this is roughly 1,600 entries, against the 10,000 the entry count allowed.
 */
const DEFAULT_MAX_BYTES = 256 * 1024 * 1024;

function configuredMaxBytes(): number {
  const raw = Number(process.env.CACHE_MAX_BYTES);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_BYTES;
}

export class CacheManager {
  private readonly l1: MemoryCache;
  private readonly l2: Redis;
  private metrics = { hits: 0, misses: 0, l1Hits: 0, l2Hits: 0, avgResponseTime: 0 };

  constructor(redisUrl?: string, maxBytes = configuredMaxBytes()) {
    this.l1 = new MemoryCache(maxBytes);

    this.l2 = new Redis(redisUrl || process.env.REDIS_URL || 'redis://localhost:6379', {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      keepAlive: 30000
    });

    this.l2.on('connect', () => log.debug('Redis connected'));
    this.l2.on('error', err => log.error('Redis error:', err));
  }

  async get<T>(key: string, strategy: CacheStrategy = CacheStrategy.SEARCH_RESULTS): Promise<T | null> {
    const startedAt = Date.now();
    const config = STRATEGY_CONFIGS[strategy];

    try {
      const l1Value = this.l1.get(key);
      if (l1Value !== undefined) {
        this.metrics.l1Hits += 1;
        this.metrics.hits += 1;
        this.record(startedAt);
        return JSON.parse(l1Value) as T;
      }

      try {
        const l2Value = await this.l2.get(key);
        if (l2Value !== null) {
          // Promoted as the string Redis returned, so L1 holds exactly the
          // bytes it accounts for and the value is parsed once here.
          this.l1.set(key, l2Value, config.l1);
          this.metrics.l2Hits += 1;
          this.metrics.hits += 1;
          this.record(startedAt);
          return JSON.parse(l2Value) as T;
        }
      } catch (redisError) {
        // A cache is optional. Redis being unreachable is a miss, not an error.
        log.warn('Redis read failed; treating as a miss:', redisError);
      }

      this.metrics.misses += 1;
      this.record(startedAt);
      return null;
    } catch (error) {
      log.error('Cache get error:', error);
      this.metrics.misses += 1;
      this.record(startedAt);
      return null;
    }
  }

  async set<T>(key: string, value: T, strategy: CacheStrategy = CacheStrategy.SEARCH_RESULTS): Promise<void> {
    const config = STRATEGY_CONFIGS[strategy];

    try {
      const serialized = JSON.stringify(value);
      if (serialized === undefined) return;

      this.l1.set(key, serialized, config.l1);

      try {
        await this.l2.setex(key, config.l2, serialized);
      } catch (redisError) {
        log.warn('Redis write failed; the entry is cached in memory only:', redisError);
      }
    } catch (error) {
      log.error('Cache set error:', error);
    }
  }

  async delete(key: string): Promise<void> {
    this.l1.delete(key);
    try {
      await this.l2.del(key);
    } catch (redisError) {
      log.warn('Failed to delete from Redis:', redisError);
    }
  }

  /**
   * Everything cached about one subject, across every namespace variant.
   *
   * The replacement for `invalidatePattern`. It takes the subject in the form
   * the caller holds it — a paper id, a query — and derives the same prefix
   * `generateKey` built, rather than asking the caller to know how keys are
   * spelled. Returns how many entries went, so a caller can tell an
   * invalidation that did something from one that did not; the defect this
   * replaces was invisible precisely because it always returned nothing.
   */
  async invalidate(namespace: string, subject: string): Promise<number> {
    const prefix = this.subjectPrefix(namespace, subject);
    let removed = this.l1.deleteByPrefix(prefix);

    try {
      const keys = await this.scanKeys(`${prefix}*`);
      if (keys.length > 0) {
        await this.l2.del(...keys);
        removed += keys.length;
      }
    } catch (redisError) {
      log.warn('Failed to invalidate in Redis:', redisError);
    }

    return removed;
  }

  getMetrics(): CacheMetrics {
    const { keys, bytes, maxBytes, evictions } = this.l1.stats();
    return { ...this.metrics, keys, bytes, maxBytes, evictions };
  }

  async clear(): Promise<void> {
    this.l1.clear();
    try {
      await this.l2.flushdb();
    } catch (redisError) {
      log.warn('Failed to clear Redis:', redisError);
    }
    this.metrics = { hits: 0, misses: 0, l1Hits: 0, l2Hits: 0, avgResponseTime: 0 };
  }

  /**
   * `namespace:hash(subject)`, plus `:hash(variant)` when there is one.
   *
   * The subject's hash appears verbatim in the key, which is what makes
   * `invalidate` able to find it. The variant — a page number, a sort, a set
   * of filters — is what distinguishes entries *about the same subject*, and
   * it is deliberately not addressable on its own: nothing wants to invalidate
   * "page 3 of everything".
   */
  generateKey(namespace: string, subject: string, ...variant: (string | number)[]): string {
    const base = this.subjectPrefix(namespace, subject);
    return variant.length > 0 ? `${base}:${this.hashKey(variant.join(':'))}` : base;
  }

  private subjectPrefix(namespace: string, subject: string): string {
    return `${namespace}:${this.hashKey(subject)}`;
  }

  private hashKey(key: string): string {
    return createHash('md5').update(key).digest('hex');
  }

  /**
   * Walks the keyspace in bounded batches.
   *
   * `KEYS` blocks the Redis server for as long as it takes to scan every key,
   * which is a production stall proportional to how well the cache is working.
   */
  private async scanKeys(match: string): Promise<string[]> {
    const found: string[] = [];
    let cursor = '0';

    do {
      const [next, batch] = await this.l2.scan(cursor, 'MATCH', match, 'COUNT', 500);
      cursor = next;
      found.push(...batch);
    } while (cursor !== '0');

    return found;
  }

  private record(startedAt: number): void {
    const elapsed = Date.now() - startedAt;
    const total = this.metrics.hits + this.metrics.misses;
    if (total > 0) {
      this.metrics.avgResponseTime = (this.metrics.avgResponseTime * (total - 1) + elapsed) / total;
    }
  }

  async close(): Promise<void> {
    try {
      await this.l2.quit();
    } catch (error) {
      log.error('Error closing Redis connection:', error);
    }
  }
}

export const cacheManager = new CacheManager();
