import { describe, it, expect, vi } from 'vitest';
import { ProviderCache, providerCacheKey, sizeOf } from '../provider-cache';
import { paper } from './helpers';

const parts = (over: Partial<Parameters<typeof providerCacheKey>[0]> = {}) => ({
  provider: 'europepmc' as const,
  nativeQuery: 'crispr AND OPEN_ACCESS:y',
  depth: 600,
  offset: 0,
  normalizerVersion: 1,
  ...over
});

const outcome = () => ({ papers: [paper()], skipped: [] });

describe('providerCacheKey', () => {
  it('is stable for the same inputs', () => {
    expect(providerCacheKey(parts())).toBe(providerCacheKey(parts()));
  });

  it('keeps the provider readable so one can be invalidated alone', () => {
    expect(providerCacheKey(parts())).toMatch(/^provider:europepmc:/);
  });

  it.each([
    ['a different native query', { nativeQuery: 'other' }],
    ['a different depth', { depth: 100 }],
    ['a different offset', { offset: 600 }],
    ['a bumped normaliser version', { normalizerVersion: 2 }]
  ])('changes for %s', (_name, over) => {
    expect(providerCacheKey(parts(over as any))).not.toBe(providerCacheKey(parts()));
  });
});

describe('ProviderCache', () => {
  it('runs the work once and serves the second call from cache', async () => {
    const cache = new ProviderCache();
    const work = vi.fn(async () => outcome());

    const first = await cache.fetch(parts(), work);
    const second = await cache.fetch(parts(), work);

    expect(work).toHaveBeenCalledTimes(1);
    expect(first.hit).toBe(false);
    expect(second.hit).toBe(true);
  });

  it('is what makes page and sort changes free', async () => {
    // The measured 29-second page-2 click: the old cache keyed on the whole
    // request, so paging missed and refetched every provider even though none
    // of them was asked anything different.
    const cache = new ProviderCache();
    const work = vi.fn(async () => outcome());

    await cache.fetch(parts(), work);   // page 1
    await cache.fetch(parts(), work);   // page 2, sort change, filter change

    expect(work).toHaveBeenCalledTimes(1);
  });

  it('collapses concurrent misses onto one call', async () => {
    const cache = new ProviderCache();
    const work = vi.fn(async () => {
      await new Promise(r => setTimeout(r, 20));
      return outcome();
    });

    await Promise.all([
      cache.fetch(parts(), work), cache.fetch(parts(), work),
      cache.fetch(parts(), work), cache.fetch(parts(), work)
    ]);

    expect(work).toHaveBeenCalledTimes(1);
  });

  it('expires an entry once its ttl has passed', async () => {
    let clock = 1000;
    const cache = new ProviderCache({ defaultTtlMs: 100, now: () => clock });
    const work = vi.fn(async () => outcome());

    await cache.fetch(parts(), work);
    clock += 99;
    await cache.fetch(parts(), work);
    expect(work).toHaveBeenCalledTimes(1);

    clock += 2;
    await cache.fetch(parts(), work);
    expect(work).toHaveBeenCalledTimes(2);
  });

  it('honours a per-provider ttl', async () => {
    // TTLs become per provider, which one key for the whole search could not express.
    let clock = 0;
    const cache = new ProviderCache({ defaultTtlMs: 1000, ttlMs: { europepmc: 50 }, now: () => clock });
    const work = vi.fn(async () => outcome());

    await cache.fetch(parts(), work);
    clock = 60;
    await cache.fetch(parts(), work);

    expect(work).toHaveBeenCalledTimes(2);
  });

  it('does not cache a failure', async () => {
    const cache = new ProviderCache();
    const work = vi.fn()
      .mockRejectedValueOnce(new Error('upstream down'))
      .mockResolvedValueOnce(outcome());

    await expect(cache.fetch(parts(), work as any)).rejects.toThrow('upstream down');
    const retried = await cache.fetch(parts(), work as any);

    expect(retried.outcome.papers).toHaveLength(1);
    expect(work).toHaveBeenCalledTimes(2);
  });

  it('invalidates one provider without touching the others', async () => {
    // One failed provider can be retried without discarding the ones that worked.
    const cache = new ProviderCache();
    const work = vi.fn(async () => outcome());

    await cache.fetch(parts({ provider: 'europepmc' }), work);
    await cache.fetch(parts({ provider: 'ncbi' }), work);
    expect(cache.size).toBe(2);

    expect(cache.invalidateProvider('europepmc')).toBe(1);
    expect(cache.size).toBe(1);
    expect((await cache.fetch(parts({ provider: 'ncbi' }), work)).hit).toBe(true);
  });

  it('bounds itself, evicting oldest first', async () => {
    // Bounded in bytes, so the budget is stated as a multiple of what one
    // entry is charged rather than as a count of entries.
    const each = sizeOf(outcome());
    const cache = new ProviderCache({ maxBytes: each * 3 });

    for (let i = 0; i < 5; i++) {
      await cache.fetch(parts({ nativeQuery: `q${i}` }), async () => outcome());
    }

    expect(cache.size).toBe(3);
    // The oldest went: q0 and q1 are gone, q4 is still there.
    expect((await cache.fetch(parts({ nativeQuery: 'q4' }), async () => outcome())).hit).toBe(true);
  });
});

/**
 * The bound is bytes, not entries.
 *
 * It used to cap at 500 entries under a comment saying a page of Papers has no
 * fixed size — which is the reason a count cannot bound it, not a reason to use
 * one. An entry holds up to `depth` papers and the default depth is 600, so
 * 500 entries is 300,000 records: about 518 MB serialised at the measured 1,809
 * bytes each, and one to one and a half gigabytes of live heap. `MemoryCache`
 * had already been through this and caps in bytes; this is the same fix on its
 * sibling.
 */
describe('ProviderCache byte budget', () => {
  const big = (n: number) => ({
    papers: Array.from({ length: n }, (_, i) =>
      paper({ id: `p${i}`, abstract: 'x'.repeat(2000) })),
    skipped: []
  });

  it('charges an entry for the text it actually carries', () => {
    // Two entries with the same number of records are not the same size, which
    // is the whole reason a count cannot be the bound.
    const slim = sizeOf({ papers: [paper({ abstract: undefined })], skipped: [] });
    const fat = sizeOf({ papers: [paper({ abstract: 'x'.repeat(5000) })], skipped: [] });

    expect(fat).toBeGreaterThan(slim + 4900);
  });

  it('never charges less than the serialised size', () => {
    // Over-charging costs cache entries; under-charging costs the bound. The
    // estimate is calibrated to err the first way.
    const outcomes = [big(1), big(20), { papers: [paper()], skipped: [] }];
    for (const o of outcomes) {
      expect(sizeOf(o)).toBeGreaterThanOrEqual(JSON.stringify(o).length);
    }
  });

  it('evicts by size, so a few large entries go where many small ones stay', async () => {
    const cache = new ProviderCache({ maxBytes: sizeOf(big(10)) });

    await cache.fetch(parts({ nativeQuery: 'large-a' }), async () => big(10));
    await cache.fetch(parts({ nativeQuery: 'large-b' }), async () => big(10));

    // The second alone fills the budget, so the first is gone.
    expect(cache.size).toBe(1);
    expect(cache.stats().bytes).toBeLessThanOrEqual(cache.stats().maxBytes);
  });

  it('refuses an entry bigger than the whole budget rather than emptying itself', async () => {
    // Reachable: at maximum depth one provider's answer is around a megabyte,
    // so a small configured budget is one a single entry can exceed.
    const cache = new ProviderCache({ maxBytes: sizeOf(big(5)) });

    await cache.fetch(parts({ nativeQuery: 'keep-me' }), async () => outcome());
    await cache.fetch(parts({ nativeQuery: 'too-big' }), async () => big(50));

    expect(cache.size).toBe(1);
    expect((await cache.fetch(parts({ nativeQuery: 'keep-me' }), async () => outcome())).hit).toBe(true);
  });

  it('gives back what an entry was charged when it goes', async () => {
    const cache = new ProviderCache();

    await cache.fetch(parts({ provider: 'europepmc' }), async () => big(5));
    const filled = cache.stats().bytes;
    expect(filled).toBeGreaterThan(0);

    cache.invalidateProvider('europepmc');
    expect(cache.stats().bytes).toBe(0);
  });

  it('gives back the bytes of an expired entry when a read finds it dead', async () => {
    let clock = 0;
    const cache = new ProviderCache({ defaultTtlMs: 100, now: () => clock });

    await cache.fetch(parts(), async () => big(5));
    expect(cache.stats().bytes).toBeGreaterThan(0);

    clock = 500;
    await cache.fetch(parts(), async () => outcome());
    // The dead entry was charged back rather than leaking its bytes forever.
    expect(cache.stats().bytes).toBe(sizeOf(outcome()));
  });

  it('drops expired entries before live ones under pressure', async () => {
    // An expired megabyte in front of a warm entry would otherwise cost that
    // entry its place for memory that was reclaimable anyway.
    let clock = 0;
    const cache = new ProviderCache({
      maxBytes: sizeOf(outcome()) * 2,
      ttlMs: { europepmc: 100, ncbi: 10_000 },
      now: () => clock
    });

    await cache.fetch(parts({ provider: 'europepmc', nativeQuery: 'dies' }), async () => outcome());
    await cache.fetch(parts({ provider: 'ncbi', nativeQuery: 'lives' }), async () => outcome());

    clock = 500;
    await cache.fetch(parts({ provider: 'ncbi', nativeQuery: 'new' }), async () => outcome());

    expect((await cache.fetch(parts({ provider: 'ncbi', nativeQuery: 'lives' }), async () => outcome())).hit).toBe(true);
  });
});
