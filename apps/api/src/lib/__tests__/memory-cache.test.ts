import { describe, it, expect } from 'vitest';
import { MemoryCache } from '../memory-cache';

/** A clock we control, so TTL behaviour is tested rather than waited for. */
function clocked(maxBytes: number) {
  let now = 1_000_000;
  const cache = new MemoryCache(maxBytes, () => now);
  return { cache, advance: (seconds: number) => { now += seconds * 1000; } };
}

const filler = (bytes: number) => JSON.stringify('x'.repeat(bytes));

describe('MemoryCache', () => {
  it('stores and returns a value', () => {
    const { cache } = clocked(1024);
    cache.set('a', '{"v":1}', 60);
    expect(cache.get('a')).toBe('{"v":1}');
  });

  it('misses a key it never held', () => {
    const { cache } = clocked(1024);
    expect(cache.get('nope')).toBeUndefined();
  });

  describe('expiry', () => {
    it('drops an entry once its TTL has passed', () => {
      const { cache, advance } = clocked(1024);
      cache.set('a', '{"v":1}', 60);

      advance(59);
      expect(cache.get('a')).toBe('{"v":1}');

      advance(2);
      expect(cache.get('a')).toBeUndefined();
    });

    it('releases the bytes an expired entry held', () => {
      const { cache, advance } = clocked(1024);
      cache.set('a', filler(100), 60);
      expect(cache.stats().bytes).toBeGreaterThan(0);

      advance(61);
      cache.get('a');
      expect(cache.stats()).toMatchObject({ keys: 0, bytes: 0 });
    });
  });

  describe('the byte budget', () => {
    it('is what bounds the cache, not the number of entries', () => {
      // 20 entries of ~100 bytes against a 600-byte budget: an entry count
      // would have admitted all of them.
      const { cache } = clocked(600);
      for (let i = 0; i < 20; i += 1) cache.set(`k${i}`, filler(100), 60);

      const stats = cache.stats();
      expect(stats.bytes).toBeLessThanOrEqual(600);
      expect(stats.keys).toBeLessThan(20);
      expect(stats.evictions).toBeGreaterThan(0);
    });

    it('evicts the least recently used entry first', () => {
      // Each entry is ~103 bytes, so two fit and the third forces an eviction.
      const { cache } = clocked(250);
      cache.set('a', filler(100), 60);
      cache.set('b', filler(100), 60);

      // Reading `a` makes `b` the oldest.
      cache.get('a');
      cache.set('c', filler(100), 60);

      expect(cache.get('a')).toBeDefined();
      expect(cache.get('c')).toBeDefined();
      expect(cache.get('b')).toBeUndefined();
    });

    it('spends expired entries before evicting live ones', () => {
      const { cache, advance } = clocked(250);
      cache.set('stale', filler(100), 10);
      cache.set('fresh', filler(100), 600);

      advance(60);
      cache.set('new', filler(100), 600);

      expect(cache.get('fresh')).toBeDefined();
      expect(cache.get('stale')).toBeUndefined();
      // The expired one was reclaimed, so nothing live had to go.
      expect(cache.stats().evictions).toBe(0);
    });

    it('refuses an entry larger than the whole budget rather than clearing the cache for it', () => {
      const { cache } = clocked(500);
      cache.set('keep', filler(100), 60);
      cache.set('huge', filler(5000), 60);

      expect(cache.get('huge')).toBeUndefined();
      expect(cache.get('keep')).toBeDefined();
    });

    it('does not double-count a key written twice', () => {
      const { cache } = clocked(4096);
      cache.set('a', filler(100), 60);
      const first = cache.stats().bytes;
      cache.set('a', filler(100), 60);

      expect(cache.stats()).toMatchObject({ keys: 1, bytes: first });
    });
  });

  describe('deleteByPrefix', () => {
    it('removes every key under the prefix and nothing else', () => {
      const { cache } = clocked(4096);
      cache.set('search:aaa:1', '1', 60);
      cache.set('search:aaa:2', '2', 60);
      cache.set('search:bbb:1', '3', 60);

      expect(cache.deleteByPrefix('search:aaa')).toBe(2);
      expect(cache.get('search:aaa:1')).toBeUndefined();
      expect(cache.get('search:bbb:1')).toBe('3');
    });

    it('gives back the bytes it removed', () => {
      const { cache } = clocked(4096);
      cache.set('p:a:1', filler(100), 60);
      cache.set('p:a:2', filler(100), 60);

      cache.deleteByPrefix('p:a');
      expect(cache.stats()).toMatchObject({ keys: 0, bytes: 0 });
    });
  });

  it('reports its budget alongside its occupancy', () => {
    const { cache } = clocked(999);
    expect(cache.stats().maxBytes).toBe(999);
  });
});
