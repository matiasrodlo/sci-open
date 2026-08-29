import { describe, it, expect, vi, beforeEach } from 'vitest';

// The manager opens a Redis client in its constructor. These tests are about
// key construction and L1 behaviour, so the L2 client is a stub — a test that
// needs a real Redis belongs in an opt-in integration suite.
vi.mock('ioredis', () => {
  class FakeRedis {
    store = new Map<string, string>();
    async get() { return null; }
    async setex() { return 'OK'; }
    async del() { return 0; }
    async keys() { return []; }
    async flushdb() { return 'OK'; }
    async info() { return ''; }
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
  it('namespaces the key and hashes the parts', () => {
    const key = cache.generateKey('paper', 'abc123');
    expect(key).toMatch(/^paper:[0-9a-f]{32}$/);
  });

  it('is stable for the same parts and different for different parts', () => {
    expect(cache.generateKey('paper', 'a')).toBe(cache.generateKey('paper', 'a'));
    expect(cache.generateKey('paper', 'a')).not.toBe(cache.generateKey('paper', 'b'));
  });

  it('keeps namespaces apart even for identical parts', () => {
    expect(cache.generateKey('paper', 'a')).not.toBe(cache.generateKey('doi', 'a'));
  });
});

describe('CacheManager pattern invalidation', () => {
  it('removes an entry when the pattern matches the literal key', async () => {
    await cache.set('plain-key-value', { hit: true }, CacheStrategy.SEARCH_RESULTS);
    expect(await cache.get('plain-key-value', CacheStrategy.SEARCH_RESULTS)).toEqual({ hit: true });

    await cache.invalidatePattern('plain-key');
    expect(await cache.get('plain-key-value', CacheStrategy.SEARCH_RESULTS)).toBeNull();
  });

  /**
   * KNOWN DEFECT — flips to passing when phase 10 collapses the cache.
   *
   * `generateKey` md5-hashes the parts, so a stored key looks like
   * `paper:9f2a…`. `invalidatePattern` then does a substring match for the
   * unhashed value the callers pass — `paper-cache-manager` invalidates with
   * `paper:<id>`, `metadata:<id>` and so on. The hash removed exactly the
   * substring being searched for, so every pattern invalidation across the
   * paper and API cache managers is a silent no-op: entries live to their TTL
   * however often they are "invalidated".
   */
  it.fails('removes an entry addressed by a generated key', async () => {
    const key = cache.generateKey('paper', 'doi:10.1/abc');
    await cache.set(key, { hit: true }, CacheStrategy.PAPER_DETAILS);

    // what PaperCacheManager.invalidatePaperCache actually passes
    await cache.invalidatePattern('paper:doi:10.1/abc');

    expect(await cache.get(key, CacheStrategy.PAPER_DETAILS)).toBeNull();
  });
});
