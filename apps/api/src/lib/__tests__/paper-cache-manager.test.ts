import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { OARecord } from '@open-access-explorer/shared';

vi.mock('ioredis', () => {
  class FakeRedis {
    async get() { return null; }
    async setex() { return 'OK'; }
    async del() { return 0; }
    async flushdb() { return 'OK'; }
    on() { return this; }
    async quit() { return 'OK'; }
  }
  return { default: FakeRedis };
});

import { CacheManager } from '../cache-manager';
import { PaperCacheManager } from '../paper-cache-manager';

const record = (over: Partial<OARecord> = {}): OARecord => ({
  id: 'arxiv:2310.12345',
  doi: '10.1234/abc',
  title: 'A study of things',
  authors: ['Lovelace, Ada'],
  source: 'arxiv',
  sourceId: '2310.12345',
  createdAt: '2026-01-01T00:00:00.000Z',
  ...over
} as OARecord);

let cache: CacheManager;
let papers: PaperCacheManager;
beforeEach(() => {
  cache = new CacheManager('redis://stub');
  papers = new PaperCacheManager(cache);
});

describe('PaperCacheManager', () => {
  it('round-trips a paper under its own id', async () => {
    await papers.cachePaperDetails(record());
    expect(await papers.getCachedPaper('arxiv:2310.12345')).toEqual(record());
  });

  it('writes once per paper, not once per key it might be asked by', async () => {
    // It used to write a second copy under the DOI, for a route probe gated on
    // `id.includes('10.')` — true of any arXiv id from 2010 on, so every
    // request paid a Redis round trip for a key only a bare DOI could match.
    // A bare DOI is not resolvable by this endpoint anyway, so the entry made
    // it answer 200 while cached and 404 once expired.
    const set = vi.spyOn(cache, 'set');
    await papers.cachePaperDetails(record());

    expect(set).toHaveBeenCalledTimes(1);
  });

  it('does not answer to a bare DOI', async () => {
    await papers.cachePaperDetails(record());
    // `/api/paper/:id` takes `source:nativeId`; a DOI is asked about through
    // `POST /api/search` with `{ doi }`.
    expect(await papers.getCachedPaper('10.1234/abc')).toBeNull();
  });

  it('still writes once for a paper with no DOI', async () => {
    const set = vi.spyOn(cache, 'set');
    await papers.cachePaperDetails(record({ doi: undefined }));

    expect(set).toHaveBeenCalledTimes(1);
  });
});
