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
import { SearchCacheManager } from '../search-cache-manager';

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
    sourceMetadata: { source: 'europepmc', latency: 12, enriched: true }
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
    await cache.cacheSearchResults('crispr', PARAMS, fresh);
    const cached = await cache.getCachedSearchResults('crispr', PARAMS);

    expect(cached).not.toBeNull();
    expect(cached!.hits[0].abstract).toBe(LONG_ABSTRACT);
    expect(cached!.hits[0].abstract!.length).toBeGreaterThan(500);
  });

  it('round-trips a response unchanged', async () => {
    const fresh = response();
    await cache.cacheSearchResults('crispr', PARAMS, fresh);
    const cached = await cache.getCachedSearchResults('crispr', PARAMS);

    expect(cached).toEqual(fresh);
  });

  it('keeps every field of sourceMetadata', async () => {
    // The same write path also stripped `enriched`, so provenance was lost
    // on the second request for a query.
    await cache.cacheSearchResults('crispr', PARAMS, response());
    const cached = await cache.getCachedSearchResults('crispr', PARAMS);

    expect(cached!.hits[0].sourceMetadata).toEqual({
      source: 'europepmc',
      latency: 12,
      enriched: true
    });
  });

  it('misses on a different query', async () => {
    await cache.cacheSearchResults('crispr', PARAMS, response());
    expect(await cache.getCachedSearchResults('something else', PARAMS)).toBeNull();
  });

  it('misses on a different page of the same query', async () => {
    await cache.cacheSearchResults('crispr', PARAMS, response());
    const page2 = await cache.getCachedSearchResults('crispr', { ...PARAMS, page: 2 });
    expect(page2).toBeNull();
  });
});
