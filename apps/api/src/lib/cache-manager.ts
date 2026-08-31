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
 *
 * **A Redis that is down is cheap to discover.** Measured on 2026-08-30 with
 * no Redis running: `GET /api/paper/:id` returned in 40,074 ms against about
 * 700 ms of actual provider work. The fallback below was already right — a
 * Redis failure is a miss, and the request carries on — but the client was
 * configured to park each command until it reconnected and then retry it three
 * times, so every one of the five or six cache operations a paper request
 * makes — a read by id, a read by DOI when the id is one, and up to four
 * writes — spent about eight seconds discovering the outage the one before it
 * had just discovered. Two changes: the client rejects a command immediately rather
 * than parking it (`enableOfflineQueue: false`), and the manager remembers —
 * one failure opens a circuit and the operations behind it go straight to L1
 * for a cooldown.
 *
 * The circuit guards reads and writes, which are what a request makes and what
 * a skipped L2 costs nothing but a miss. `delete`, `invalidate` and `clear`
 * still ask Redis every time: skipping those would silently leave behind an
 * entry a caller asked to remove, and they are rare — an admin route and the
 * invalidation helpers — so they are not what the cooldown is for. With the
 * offline queue disabled they fail immediately regardless.
 */

export enum CacheStrategy {
  SEARCH_RESULTS = 'search_results',
  PAPER_DETAILS = 'paper_details'
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
  /** False while the circuit is open — Redis failed within the cooldown. */
  l2Available: boolean;
}

const STRATEGY_CONFIGS: Record<CacheStrategy, CacheConfig> = {
  [CacheStrategy.SEARCH_RESULTS]: { l1: 300, l2: 3600 },
  [CacheStrategy.PAPER_DETAILS]: { l1: 600, l2: 7200 }
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

/**
 * How long L2 stays skipped after Redis has failed.
 *
 * Long enough that one request pays the discovery once rather than once per
 * cache operation, short enough that a Redis which comes back is picked up
 * within a request or two of doing so.
 */
const DEFAULT_L2_COOLDOWN_MS = 5000;

/** A connection that has not landed by here is not landing. */
const CONNECT_TIMEOUT_MS = 2000;

/** The slowest the background reconnect backs off to. */
const RECONNECT_MAX_DELAY_MS = 5000;

function configuredCooldownMs(): number {
  const raw = Number(process.env.CACHE_REDIS_COOLDOWN_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_L2_COOLDOWN_MS;
}

export class CacheManager {
  private readonly l1: MemoryCache;
  private readonly l2: Redis;
  private metrics = { hits: 0, misses: 0, l1Hits: 0, l2Hits: 0, avgResponseTime: 0 };

  /**
   * What the manager remembers about Redis between operations: whether the
   * last one failed, and when L2 may be tried again.
   */
  private l2Down = false;
  private l2RetryAt = 0;

  constructor(
    redisUrl?: string,
    maxBytes = configuredMaxBytes(),
    private readonly l2CooldownMs = configuredCooldownMs()
  ) {
    this.l1 = new MemoryCache(maxBytes);

    this.l2 = new Redis(redisUrl || process.env.REDIS_URL || 'redis://localhost:6379', {
      // A command issued while the client is not connected is rejected rather
      // than parked until it reconnects. Parking it is what made an
      // unreachable Redis expensive: the command waited out four connection
      // attempts and then the per-request retry limit — about eight seconds —
      // and the next command began the same wait from the start.
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: CONNECT_TIMEOUT_MS,
      // Reconnect for as long as it takes, backing off to a slow poll. A
      // strategy that gives up — returns null — ends the client for good,
      // which would turn a thirty-second Redis restart into a cache that stays
      // memory-only until the API is restarted.
      retryStrategy: times => Math.min(times * 200, RECONNECT_MAX_DELAY_MS),
      // Connect now rather than on the first command. A command issued before
      // the socket is ready is rejected outright once the offline queue is
      // gone, so a lazy client would spend the first cache operation of every
      // boot discovering a Redis that is in fact fine — and would say so in
      // the log. Nothing but the server constructs this.
      lazyConnect: false,
      keepAlive: 30000
    });

    this.l2.on('ready', () => {
      log.debug('Redis connected');
      this.resetL2();
    });
    // A connection error arrives here rather than at a call site, and it
    // arrives before the next operation does — the earliest point at which the
    // manager can know to stop asking.
    this.l2.on('error', err => this.reportL2Failure('Redis connection failed; the cache is memory-only:', err));
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

      if (this.l2Usable()) {
        try {
          const l2Value = await this.l2.get(key);
          this.resetL2();
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
          this.reportL2Failure('Redis read failed; treating as a miss:', redisError);
        }
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

      if (this.l2Usable()) {
        try {
          await this.l2.setex(key, config.l2, serialized);
          this.resetL2();
        } catch (redisError) {
          this.reportL2Failure('Redis write failed; the entry is cached in memory only:', redisError);
        }
      }
    } catch (error) {
      log.error('Cache set error:', error);
    }
  }

  async delete(key: string): Promise<void> {
    this.l1.delete(key);
    try {
      await this.l2.del(key);
      this.resetL2();
    } catch (redisError) {
      this.tripL2();
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
   *
   * No route calls this today. Its two callers — `invalidatePaper` and
   * `invalidateSearchCache` — were themselves unreachable and went in the
   * 2026-08-30 dead-code sweep. It is kept rather than deleted with them
   * because the namespace/subject split in `generateKey` exists *for* it: the
   * key layout is designed around being able to invalidate a subject across
   * its variants, and the suite here pins the bug that design fixed. Deleting
   * it would leave that layout with no stated reason to be that shape.
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
      this.resetL2();
    } catch (redisError) {
      this.tripL2();
      log.warn('Failed to invalidate in Redis:', redisError);
    }

    return removed;
  }

  getMetrics(): CacheMetrics {
    const { keys, bytes, maxBytes, evictions } = this.l1.stats();
    return { ...this.metrics, keys, bytes, maxBytes, evictions, l2Available: !this.l2Down };
  }

  async clear(): Promise<void> {
    this.l1.clear();
    try {
      await this.l2.flushdb();
      this.resetL2();
    } catch (redisError) {
      this.tripL2();
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

  /**
   * Whether an operation should reach for Redis at all.
   *
   * Discovering an outage is cheap now, but it is not free, and it is paid per
   * operation: a paper request makes five or six of them. After a failure the manager
   * stops asking for the cooldown and the operations behind it go straight to
   * L1, then one gets through to find out whether Redis is back.
   */
  private l2Usable(): boolean {
    return !this.l2Down || Date.now() >= this.l2RetryAt;
  }

  /**
   * Holds L2 shut for the cooldown. Returns whether this was the first failure
   * of the outage, which is the only one worth a log line.
   */
  private tripL2(): boolean {
    const firstFailure = !this.l2Down;
    this.l2Down = true;
    this.l2RetryAt = Date.now() + this.l2CooldownMs;
    return firstFailure;
  }

  /** Redis answered, so the circuit closes and the next failure is news again. */
  private resetL2(): void {
    if (!this.l2Down) return;
    this.l2Down = false;
    this.l2RetryAt = 0;
    log.info('Redis is reachable again; the cache is using it');
  }

  /**
   * Trips the circuit, and says so once.
   *
   * Once per outage rather than once per operation: while Redis is down every
   * operation fails, and so does every reconnect attempt behind them, so a
   * line each would bury the one line that carried the news.
   */
  private reportL2Failure(message: string, error: unknown): void {
    if (this.tripL2()) log.warn(message, error);
    else log.debug(message, error);
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
      // `quit` is itself a command, and with the offline queue disabled a
      // command issued while Redis is unreachable is rejected rather than
      // queued. The client would still hold a reconnect timer, which keeps the
      // process alive after the server has closed, so end it outright.
      this.l2.disconnect();
      log.debug('Redis did not answer QUIT; disconnected instead', error);
    }
  }
}

export const cacheManager = new CacheManager();
