import { describe, it, expect, vi } from 'vitest';
import { ProviderCache, providerCacheKey } from '../provider-cache';
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
    const cache = new ProviderCache({ maxEntries: 3 });
    for (let i = 0; i < 5; i++) {
      await cache.fetch(parts({ nativeQuery: `q${i}` }), async () => outcome());
    }
    expect(cache.size).toBe(3);
  });
});
