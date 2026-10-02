import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Query } from '@open-access-explorer/shared';

const { fetchPage } = vi.hoisted(() => ({ fetchPage: vi.fn() }));

// Module scope, not inside a describe: `vi.mock`'s factory is hoisted above
// everything else in the file, so a binding declared in a block would not be
// initialised by the time the factory runs.
vi.mock('../fetch', () => ({
  fetchPage,
  fetchArticle: vi.fn(),
  DoajUnavailableError: class extends Error {}
}));

import { search } from '../index';

const query = (over: Partial<Query>): Query => ({ terms: [], phrases: [], join: 'AND', ...over });

const article = (n: number) => ({
  id: `a${n}`,
  bibjson: {
    title: `Paper ${n}`,
    year: '2022',
    author: [{ name: 'Lovelace, A.' }],
    identifier: [{ type: 'doi', id: `10.1234/a${n}` }],
    link: [{ type: 'fulltext', url: `https://example.org/a${n}.pdf` }]
  }
});

/** A DOAJ corpus of `size` articles, served in pages of at most `pageSize`. */
const corpus = (size: number) =>
  fetchPage.mockImplementation(async (_q: string, { pageSize, offset }: any) => ({
    total: size,
    results: Array.from(
      { length: Math.max(Math.min(pageSize, size - offset), 0) },
      (_, i) => article(offset + i)
    )
  }));

const run = (pageSize: number, offset = 0) =>
  search(query({ terms: ['crispr'] }), { pageSize, offset, timeoutMs: 1000, openAccessOnly: true });

// The braces matter. `mockClear()` returns the mock, and an arrow with an
// expression body returns it too — which Vitest reads as a teardown callback.
beforeEach(() => {
  fetchPage.mockReset();
});

/**
 * `fanOut` asks each provider once, for `depth` records — 600 by default — and
 * DOAJ caps a page at 100. So a search retrieved 100, and `ProviderReport`
 * recorded `status: 'ok'` beside `retrieved: 100`, which reads as "this is what
 * DOAJ had" rather than "this is one page of it". See `providers/read-pages.ts`.
 */
describe('search — pagination across the 100-article cap', () => {
  it('reads the full requested depth rather than one page', async () => {
    corpus(5000);

    const result = await run(600);

    expect(result.papers).toHaveLength(600);
    expect(fetchPage).toHaveBeenCalledTimes(6);
  });

  it('asks each page for its own offset, at the cap', async () => {
    corpus(5000);

    await run(600);

    expect(fetchPage.mock.calls.map(([, o]) => o.offset)).toEqual([0, 100, 200, 300, 400, 500]);
    expect(fetchPage.mock.calls.map(([, o]) => o.pageSize)).toEqual([100, 100, 100, 100, 100, 100]);
  });

  it('ranks the concatenated pages contiguously', async () => {
    // `SourceRef.rank` is the input to rank fusion, so a second page whose
    // records all rank 0 would fuse as though DOAJ had put them first.
    corpus(5000);

    const result = await run(300);

    expect(result.papers[0]!.sources[0]!.rank).toBe(0);
    expect(result.papers[100]!.sources[0]!.rank).toBe(100);
    expect(result.papers[299]!.sources[0]!.rank).toBe(299);
  });

  it('reports the corpus-wide total, not the number of pages read', async () => {
    corpus(5000);

    expect((await run(600)).totalHits).toBe(5000);
  });

  it('costs one request when the query fits in a page', async () => {
    corpus(40);

    const result = await run(600);

    expect(result.papers).toHaveLength(40);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('reads only the pages the total says exist', async () => {
    corpus(250);

    const result = await run(600);

    expect(result.papers).toHaveLength(250);
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it('fails the read when a page fails, rather than reporting a short one as whole', async () => {
    fetchPage.mockImplementation(async (_q: string, { pageSize, offset }: any) => {
      if (offset === 200) throw new Error('DOAJ 503');
      return {
        total: 5000,
        results: Array.from({ length: pageSize }, (_, i) => article(offset + i))
      };
    });

    await expect(run(600)).rejects.toThrow('DOAJ 503');
  });

  it('makes no request at all for a query it cannot express', async () => {
    // The empty-query guard runs before the read, so pagination never begins.
    const result = await search(query({}), {
      pageSize: 600,
      offset: 0,
      timeoutMs: 1000,
      openAccessOnly: true
    });

    expect(result.papers).toEqual([]);
    expect(fetchPage).not.toHaveBeenCalled();
  });
});
