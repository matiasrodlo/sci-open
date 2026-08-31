import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * The manager opens a Redis client in its constructor. These tests are about
 * key construction, L1 behaviour and invalidation, so the L2 client is a stub
 * that actually stores — a test that needs a real Redis belongs in an opt-in
 * integration suite.
 *
 * The stub implements `scan` rather than `keys`, which is the point: a manager
 * that reached for `keys` would now fail here rather than quietly blocking a
 * production Redis for the length of the keyspace.
 */
vi.mock('ioredis', () => {
  class FakeRedis {
    store = new Map<string, string>();
    constructor(_url: string, public options: any = {}) {}
    async get(key: string) { return this.store.get(key) ?? null; }
    async setex(key: string, _ttl: number, value: string) { this.store.set(key, value); return 'OK'; }
    async del(...keys: string[]) {
      let n = 0;
      for (const key of keys) if (this.store.delete(key)) n += 1;
      return n;
    }
    async scan(cursor: string, _m: string, match: string, _c: string, count: number) {
      const all = [...this.store.keys()];
      const start = Number(cursor);
      const page = all.slice(start, start + count);
      const re = new RegExp(`^${match.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*')}$`);
      const next = start + count >= all.length ? '0' : String(start + count);
      return [next, page.filter(k => re.test(k))] as [string, string[]];
    }
    async flushdb() { this.store.clear(); return 'OK'; }
    on() { return this; }
    async quit() { return 'OK'; }
  }
  return { default: FakeRedis };
});

import { CacheManager, CacheStrategy } from '../cache-manager';

let cache: CacheManager;
beforeEach(() => {
  cache = new CacheManager('redis://stub');
});

describe('CacheManager.generateKey', () => {
  it('namespaces the key and hashes the subject', () => {
    expect(cache.generateKey('paper', 'abc123')).toMatch(/^paper:[0-9a-f]{32}$/);
  });

  it('appends a second hash for the variant', () => {
    expect(cache.generateKey('search', 'crispr', '{"page":1}')).toMatch(/^search:[0-9a-f]{32}:[0-9a-f]{32}$/);
  });

  it('is stable for the same parts and different for different parts', () => {
    expect(cache.generateKey('paper', 'a')).toBe(cache.generateKey('paper', 'a'));
    expect(cache.generateKey('paper', 'a')).not.toBe(cache.generateKey('paper', 'b'));
    expect(cache.generateKey('search', 'q', '1')).not.toBe(cache.generateKey('search', 'q', '2'));
  });

  it('keeps namespaces apart even for identical parts', () => {
    expect(cache.generateKey('paper', 'a')).not.toBe(cache.generateKey('doi', 'a'));
  });

  it('puts every variant of a subject under one prefix', () => {
    // This is the property invalidation depends on.
    const prefix = cache.generateKey('search', 'crispr');
    expect(cache.generateKey('search', 'crispr', 'page=1').startsWith(`${prefix}:`)).toBe(true);
    expect(cache.generateKey('search', 'crispr', 'page=2').startsWith(`${prefix}:`)).toBe(true);
  });
});

describe('CacheManager subject invalidation', () => {
  /**
   * Phase 01 recorded this as a failing test, marked "flips to passing when
   * phase 10 collapses the cache". It flipped.
   *
   * `generateKey` md5-hashed everything it was given, so a stored key looked
   * like `paper:9f2a…`; `invalidatePattern` then substring-matched the
   * unhashed value its callers passed. The hash had removed exactly the
   * substring being searched for, so every pattern invalidation across the
   * paper and search cache managers was a silent no-op and entries lived to
   * their TTL however often they were "invalidated".
   */
  it('removes an entry addressed by a generated key', async () => {
    const key = cache.generateKey('paper', 'doi:10.1/abc');
    await cache.set(key, { hit: true }, CacheStrategy.PAPER_DETAILS);

    expect(await cache.invalidate('paper', 'doi:10.1/abc')).toBeGreaterThan(0);
    expect(await cache.get(key, CacheStrategy.PAPER_DETAILS)).toBeNull();
  });

  it('removes every variant of the subject', async () => {
    const keys = ['page=1', 'page=2', 'page=3'].map(v => cache.generateKey('search', 'crispr', v));
    for (const key of keys) await cache.set(key, { hit: true }, CacheStrategy.SEARCH_RESULTS);

    await cache.invalidate('search', 'crispr');

    for (const key of keys) {
      expect(await cache.get(key, CacheStrategy.SEARCH_RESULTS)).toBeNull();
    }
  });

  it('leaves a different subject in the same namespace alone', async () => {
    const kept = cache.generateKey('search', 'alzheimer', 'page=1');
    const gone = cache.generateKey('search', 'crispr', 'page=1');
    await cache.set(kept, { hit: 'alzheimer' }, CacheStrategy.SEARCH_RESULTS);
    await cache.set(gone, { hit: 'crispr' }, CacheStrategy.SEARCH_RESULTS);

    await cache.invalidate('search', 'crispr');

    expect(await cache.get(kept, CacheStrategy.SEARCH_RESULTS)).toEqual({ hit: 'alzheimer' });
    expect(await cache.get(gone, CacheStrategy.SEARCH_RESULTS)).toBeNull();
  });

  it('clears the entry out of Redis too, not just memory', async () => {
    const key = cache.generateKey('search', 'crispr', 'page=1');
    await cache.set(key, { hit: true }, CacheStrategy.SEARCH_RESULTS);

    // Drop L1 so a surviving L2 entry would be visible as a hit.
    (cache as any).l1.clear();
    await cache.invalidate('search', 'crispr');

    expect(await cache.get(key, CacheStrategy.SEARCH_RESULTS)).toBeNull();
  });

  it('reports nothing removed when there was nothing to remove', async () => {
    expect(await cache.invalidate('search', 'never-cached')).toBe(0);
  });
});

describe('CacheManager levels', () => {
  it('serves from Redis when memory has lost the entry, and promotes it back', async () => {
    const key = cache.generateKey('search', 'crispr', 'page=1');
    await cache.set(key, { hit: true }, CacheStrategy.SEARCH_RESULTS);
    (cache as any).l1.clear();

    expect(await cache.get(key, CacheStrategy.SEARCH_RESULTS)).toEqual({ hit: true });
    expect(cache.getMetrics().l2Hits).toBe(1);
    // Promoted, so the next read is an L1 hit.
    expect(await cache.get(key, CacheStrategy.SEARCH_RESULTS)).toEqual({ hit: true });
    expect(cache.getMetrics().l1Hits).toBe(1);
  });

  it('does not resurrect an entry both levels have dropped', async () => {
    // The L3 defect: a Map with no TTL that `get` promoted from, so an entry
    // that had expired out of memory and Redis was served anyway — and written
    // back into both. Once a search result reached L3 it was never refetched.
    const key = cache.generateKey('search', 'crispr', 'page=1');
    await cache.set(key, { hit: true }, CacheStrategy.SEARCH_RESULTS);

    (cache as any).l1.clear();
    await (cache as any).l2.flushdb();

    expect(await cache.get(key, CacheStrategy.SEARCH_RESULTS)).toBeNull();
  });

  it('hands out a fresh object, so a reader cannot corrupt the cache', async () => {
    // The old L1 ran with `useClones: false` and returned the stored reference.
    const key = cache.generateKey('paper', 'a');
    await cache.set(key, { topics: ['crispr'] }, CacheStrategy.PAPER_DETAILS);

    const first = await cache.get<{ topics: string[] }>(key, CacheStrategy.PAPER_DETAILS);
    first!.topics.push('mutated');

    expect(await cache.get(key, CacheStrategy.PAPER_DETAILS)).toEqual({ topics: ['crispr'] });
  });

  it('survives Redis being unreachable by treating it as a miss', async () => {
    const failing = new CacheManager('redis://stub');
    (failing as any).l2.get = async () => { throw new Error('ECONNREFUSED'); };
    (failing as any).l2.setex = async () => { throw new Error('ECONNREFUSED'); };

    const key = failing.generateKey('search', 'crispr', 'page=1');
    await failing.set(key, { hit: true }, CacheStrategy.SEARCH_RESULTS);
    // Written to memory even though Redis refused.
    expect(await failing.get(key, CacheStrategy.SEARCH_RESULTS)).toEqual({ hit: true });

    (failing as any).l1.clear();
    expect(await failing.get(key, CacheStrategy.SEARCH_RESULTS)).toBeNull();
  });
});

describe('CacheManager when Redis is unreachable', () => {
  /**
   * Measured on 2026-08-30 with no Redis running: a paper request returned in
   * 40,074 ms against about 700 ms of provider work. The fallback was correct
   * — every failure was treated as a miss — but each of the six cache
   * operations the request makes paid about eight seconds to rediscover the
   * outage the one before it had just found.
   */
  const noRedis = (cooldownMs: number) => {
    const manager = new CacheManager('redis://stub', undefined, cooldownMs);
    const calls = { reads: 0, writes: 0 };
    (manager as any).l2.get = async () => { calls.reads += 1; throw new Error('ECONNREFUSED'); };
    (manager as any).l2.setex = async () => { calls.writes += 1; throw new Error('ECONNREFUSED'); };
    return { manager, calls };
  };

  it('fails a command rather than queueing it while disconnected', () => {
    // Where the eight seconds per operation went: ioredis parked each command
    // in its offline queue, waited out the connection retries, then retried the
    // command three times. Nothing below can be fast while a command can still
    // be parked there.
    const options = (cache as any).l2.options;
    expect(options).toMatchObject({ enableOfflineQueue: false, maxRetriesPerRequest: 1 });
    expect(options.connectTimeout).toBeLessThanOrEqual(2000);
    // Bounded delay, but it never gives up: a strategy that returns null ends
    // the client, and a Redis restart would take the cache down until the API
    // was restarted too.
    expect(options.retryStrategy(1)).toBeLessThanOrEqual(5000);
    expect(options.retryStrategy(1000)).toBeLessThanOrEqual(5000);
  });

  it('stops asking after the first failure and serves from memory', async () => {
    const { manager, calls } = noRedis(10_000);

    for (const subject of ['a', 'b', 'c', 'd']) {
      const key = manager.generateKey('paper', subject);
      expect(await manager.get(key, CacheStrategy.PAPER_DETAILS)).toBeNull();
    }

    expect(calls.reads).toBe(1);
    expect(manager.getMetrics().l2Available).toBe(false);
  });

  it('holds the circuit open across reads and writes alike', async () => {
    const { manager, calls } = noRedis(10_000);
    const key = manager.generateKey('paper', 'a');

    await manager.set(key, { hit: 1 }, CacheStrategy.PAPER_DETAILS);
    await manager.set(key, { hit: 2 }, CacheStrategy.PAPER_DETAILS);
    await manager.get(manager.generateKey('paper', 'b'), CacheStrategy.PAPER_DETAILS);

    // One write discovered it; the second write and the read that followed
    // went straight to memory.
    expect(calls.writes).toBe(1);
    expect(calls.reads).toBe(0);
    // And L1 took every write regardless, which is the point of degrading.
    expect(await manager.get(key, CacheStrategy.PAPER_DETAILS)).toEqual({ hit: 2 });
  });

  it('tries again once the cooldown has passed, and uses Redis when it answers', async () => {
    const manager = new CacheManager('redis://stub', undefined, 20);
    const l2 = (manager as any).l2;
    const answer = l2.get.bind(l2);
    let reads = 0;
    let down = true;
    l2.get = async (key: string) => {
      reads += 1;
      if (down) throw new Error('ECONNREFUSED');
      return answer(key);
    };

    const key = manager.generateKey('paper', 'a');
    await manager.set(key, { hit: true }, CacheStrategy.PAPER_DETAILS);
    (manager as any).l1.clear();

    expect(await manager.get(key, CacheStrategy.PAPER_DETAILS)).toBeNull();
    expect(await manager.get(key, CacheStrategy.PAPER_DETAILS)).toBeNull();
    expect(reads).toBe(1);

    down = false;
    await new Promise(resolve => setTimeout(resolve, 40));

    expect(await manager.get(key, CacheStrategy.PAPER_DETAILS)).toEqual({ hit: true });
    expect(manager.getMetrics().l2Available).toBe(true);
  });

  it('still asks Redis to invalidate while the circuit is open', async () => {
    // Skipping a read costs a miss and nothing else. Skipping a delete leaves
    // an entry the caller asked to remove, to be served later as though it were
    // current, so the cooldown deliberately does not cover invalidation.
    const manager = new CacheManager('redis://stub', undefined, 10_000);
    const key = manager.generateKey('paper', 'a');
    await manager.set(key, { hit: true }, CacheStrategy.PAPER_DETAILS);

    (manager as any).l2.get = async () => { throw new Error('ECONNREFUSED'); };
    (manager as any).l1.clear();
    await manager.get(key, CacheStrategy.PAPER_DETAILS);
    expect(manager.getMetrics().l2Available).toBe(false);

    expect(await manager.invalidate('paper', 'a')).toBe(1);
  });
});

describe('CacheManager.getMetrics', () => {
  it('reports the byte budget rather than a key count alone', async () => {
    await cache.set(cache.generateKey('paper', 'a'), { some: 'value' }, CacheStrategy.PAPER_DETAILS);

    const metrics = cache.getMetrics();
    expect(metrics.keys).toBe(1);
    expect(metrics.bytes).toBeGreaterThan(0);
    expect(metrics.maxBytes).toBeGreaterThan(metrics.bytes);
  });
});
