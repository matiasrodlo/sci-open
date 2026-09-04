import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SearchParams, SearchResponse, OARecord } from '@open-access-explorer/shared';

vi.mock('ioredis', () => {
  class FakeRedis {
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

import { CacheManager } from '../cache-manager';
import { SearchCacheManager, worthCaching } from '../search-cache-manager';

// Longer than the 500 characters the cache used to keep
const LONG_ABSTRACT =
  'Clustered regularly interspaced short palindromic repeats provide adaptive immunity in prokaryotes. '.repeat(12);

function response(over: Partial<SearchResponse> = {}): SearchResponse {
  const hit: OARecord = {
    id: 'europepmc:1',
    doi: '10.1/abc',
    title: 'A study of things',
    authors: ['Lovelace, Ada'],
    year: 2020,
    source: 'europepmc',
    sourceId: '1',
    oaStatus: 'published',
    abstract: LONG_ABSTRACT,
    createdAt: '2024-01-01T00:00:00.000Z',
    sourceMetadata: { source: 'europepmc', latency: 12 }
  } as OARecord;

  return { hits: [hit], facets: {}, page: 1, pageSize: 20, total: 1, ...over };
}

const PARAMS: SearchParams = { q: 'crispr', page: 1, pageSize: 20 };

let cache: SearchCacheManager;
beforeEach(() => {
  cache = new SearchCacheManager(new CacheManager('redis://stub'));
});

describe('SearchCacheManager round trip', () => {
  it('returns the abstract in full, however long it is', async () => {
    // The cache used to truncate every abstract to 500 characters on write,
    // with a decompress step that was a no-op — so the first visitor to a
    // query got the whole text and everyone afterwards got a fragment cut
    // mid-word. A read has to be indistinguishable from a fresh result.
    const fresh = response();
    await cache.cacheSearchResults(PARAMS, fresh);
    const cached = await cache.getCachedSearchResults(PARAMS);

    expect(cached).not.toBeNull();
    expect(cached!.hits[0].abstract).toBe(LONG_ABSTRACT);
    expect(cached!.hits[0].abstract!.length).toBeGreaterThan(500);
  });

  it('round-trips a response unchanged', async () => {
    const fresh = response();
    await cache.cacheSearchResults(PARAMS, fresh);
    const cached = await cache.getCachedSearchResults(PARAMS);

    expect(cached).toEqual(fresh);
  });

  it('keeps every field of sourceMetadata', async () => {
    // The write path used to strip this object, so provenance was lost on the
    // second request for a query.
    await cache.cacheSearchResults(PARAMS, response());
    const cached = await cache.getCachedSearchResults(PARAMS);

    expect(cached!.hits[0].sourceMetadata).toEqual({
      source: 'europepmc',
      latency: 12
    });
  });

  it('misses on a different query', async () => {
    await cache.cacheSearchResults(PARAMS, response());
    expect(await cache.getCachedSearchResults({ ...PARAMS, q: 'something else' })).toBeNull();
  });

  it('misses on a different page of the same query', async () => {
    await cache.cacheSearchResults(PARAMS, response());
    const page2 = await cache.getCachedSearchResults({ ...PARAMS, page: 2 });
    expect(page2).toBeNull();
  });
});

describe('SearchCacheManager key identity', () => {
  // The key used to be built from a `query` argument passed in beside the
  // params, and the route passed `params.q || ''`. `params.doi` never reached
  // it, so every DOI lookup with no `q` hashed the empty string and they all
  // shared one entry — the second caller was served the first caller's paper,
  // and the single-flight guard, which keys the same way, coalesced concurrent
  // ones onto a single fan-out.
  it('separates two different DOI lookups', () => {
    const a = cache.keyFor({ doi: '10.1234/aaa' });
    const b = cache.keyFor({ doi: '10.5678/bbb' });

    expect(a).not.toBe(b);
  });

  it('keys a DOI lookup on the DOI, not on the absent query', () => {
    // `runOrchestrator` builds its Query from `params.doi ?? params.q`, so the
    // key has to name the DOI whether or not `q` is also set.
    const doiOnly = cache.keyFor({ doi: '10.1234/aaa' });
    const doiWithQuery = cache.keyFor({ doi: '10.1234/aaa', q: 'crispr' });

    expect(doiWithQuery).toBe(doiOnly);
    expect(doiOnly).not.toBe(cache.keyFor({ q: 'crispr' }));
  });

  it('separates queries that differ only in punctuation', () => {
    // `\\w` is ASCII-only in JavaScript, so stripping everything outside
    // `[\\w\\s]` folded these pairs together.
    expect(cache.keyFor({ q: 'TNF-\u03b1' })).not.toBe(cache.keyFor({ q: 'TNF' }));
    expect(cache.keyFor({ q: 'alpha/beta' })).not.toBe(cache.keyFor({ q: 'alphabeta' }));
  });

  it('still folds case and runs of whitespace', () => {
    // The lossless half of the normalisation stays: these really are one search.
    expect(cache.keyFor({ q: '  Machine   Learning ' })).toBe(cache.keyFor({ q: 'machine learning' }));
  });
});

/**
 * A degraded answer is returned but not remembered.
 *
 * `complete: false` means a provider failed or timed out, so `total` is a lower
 * bound and whole sources are missing from the hits and the facets. Cached
 * under the same key as a whole answer, one provider's bad minute was served to
 * everyone asking that question for the next hour — and the frontend's retry
 * could not get past it, because it re-posted the identical request and was
 * answered from that entry.
 */
describe('worthCaching', () => {
  it('is false only for an answer that reported itself incomplete', () => {
    expect(worthCaching(response({ complete: false }))).toBe(false);
    expect(worthCaching(response({ complete: true }))).toBe(true);
  });

  it('treats an absent `complete` as cacheable', () => {
    // The field is optional in `SearchResponse`, and a response that never
    // claimed to be partial is not one to throw away. Only an explicit false
    // is evidence of a degraded read.
    expect(worthCaching(response())).toBe(true);
  });
});

describe('cacheSearchResults — refusing a degraded answer', () => {
  it('does not store an incomplete result, and says it did not', async () => {
    const manager = new SearchCacheManager(new CacheManager());
    const params: SearchParams = { q: 'crispr' };

    const stored = await manager.cacheSearchResults(params, response({ complete: false, total: 3 }));

    expect(stored).toBe(false);
    expect(await manager.getCachedSearchResults(params)).toBeNull();
  });

  it('stores a complete one', async () => {
    const manager = new SearchCacheManager(new CacheManager());
    const params: SearchParams = { q: 'crispr' };

    const stored = await manager.cacheSearchResults(params, response({ complete: true }));

    expect(stored).toBe(true);
    expect(await manager.getCachedSearchResults(params)).not.toBeNull();
  });

  it('leaves an earlier complete answer in place when a later read is degraded', async () => {
    // The refusal must not become a deletion: a good answer already cached is
    // better than none, and a provider failing now says nothing about it.
    const manager = new SearchCacheManager(new CacheManager());
    const params: SearchParams = { q: 'crispr' };

    await manager.cacheSearchResults(params, response({ complete: true, total: 42 }));
    await manager.cacheSearchResults(params, response({ complete: false, total: 3 }));

    expect((await manager.getCachedSearchResults(params))?.total).toBe(42);
  });
});
