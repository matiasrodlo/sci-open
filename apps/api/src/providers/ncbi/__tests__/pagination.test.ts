import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Query } from '@open-access-explorer/shared';

const { fetchPage } = vi.hoisted(() => ({ fetchPage: vi.fn() }));

// Module scope, not inside a describe: `vi.mock`'s factory is hoisted above
// everything else in the file, so a binding declared in a block would not be
// initialised by the time the factory runs.
vi.mock('../fetch', () => ({
  fetchPage,
  NcbiUnavailableError: class extends Error {}
}));

import { search } from '../index';

const query = (over: Partial<Query>): Query => ({ terms: [], phrases: [], join: 'AND', ...over });

/** One efetch article, minimal but enough for `normalize` to keep it. */
const article = (n: number) => ({
  MedlineCitation: [
    {
      PMID: [{ _: String(n) }],
      Article: [{ ArticleTitle: [`Paper ${n}`] }]
    }
  ]
});

/** A PubMed corpus of `size` records, served `pageSize` at a time from `offset`. */
const corpus = (size: number) =>
  fetchPage.mockImplementation(async (_q: string, { pageSize, offset }: any) => ({
    totalHits: size,
    articles: Array.from(
      { length: Math.max(Math.min(pageSize, size - offset), 0) },
      (_, i) => article(offset + i)
    )
  }));

const run = (pageSize: number, offset = 0) =>
  search(query({ terms: ['crispr'] }), { pageSize, offset, timeoutMs: 1000, openAccessOnly: true });

const asked = () => fetchPage.mock.calls.map(([, o]) => ({ pageSize: o.pageSize, offset: o.offset }));

beforeEach(() => {
  fetchPage.mockReset();
});

/**
 * `fanOut` asks each provider once, for `depth` records — 600 by default — and
 * this provider's page ceiling is 500, so a search retrieved 500 and had it
 * recorded as a complete read. Smaller than the shortfall DOAJ and OpenAIRE
 * had, and the same silence. See `providers/read-pages.ts`.
 */
describe('search — pagination across the 500-record ceiling', () => {
  it('reads the full requested depth rather than one page', async () => {
    corpus(5000);

    const { papers } = await run(600);

    expect(papers).toHaveLength(600);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('asks the closing page for only the records still wanted', async () => {
    // The ceiling exists to bound how much abstract XML one response carries,
    // and this provider takes `retstart` — an absolute offset — so a short
    // final request is well defined. Asking for a full second page would fetch
    // 1,000 abstracts to return 600, which is the cost the ceiling is for.
    corpus(5000);

    await run(600);

    expect(asked()).toEqual([
      { pageSize: 500, offset: 0 },
      { pageSize: 100, offset: 500 }
    ]);
  });

  it('ranks the concatenated pages contiguously', async () => {
    // `SourceRef.rank` feeds reciprocal rank fusion, and this provider is the
    // one whose ordering was already got wrong once — esearch defaults to PMID
    // descending, so the relevance sort is set explicitly. A second page whose
    // records all rank 0 would undo that a different way.
    corpus(5000);

    const { papers } = await run(600);

    expect(papers[0]!.sources[0]!.rank).toBe(0);
    expect(papers[500]!.sources[0]!.rank).toBe(500);
    expect(papers[599]!.sources[0]!.rank).toBe(599);
  });

  it('reports PubMed own corpus count, not what was read', async () => {
    corpus(5000);

    expect((await run(600)).totalHits).toBe(5000);
  });

  it('costs one read when the query fits in a page', async () => {
    corpus(400);

    const { papers } = await run(600);

    expect(papers).toHaveLength(400);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('costs one read when the depth is within the ceiling', async () => {
    // The common case before `depth` was raised, and the one that must not
    // start paying for a second esearch/efetch pair.
    corpus(5000);

    await run(500);

    expect(asked()).toEqual([{ pageSize: 500, offset: 0 }]);
  });

  it('reads only the pages the reported count says exist', async () => {
    corpus(520);

    const { papers } = await run(600);

    expect(papers).toHaveLength(520);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('fails the read when a page fails, rather than reporting a short one as whole', async () => {
    fetchPage.mockImplementation(async (_q: string, { pageSize, offset }: any) => {
      if (offset === 500) throw new Error('NCBI 429');
      return {
        totalHits: 5000,
        articles: Array.from({ length: pageSize }, (_, i) => article(offset + i))
      };
    });

    await expect(run(600)).rejects.toThrow('NCBI 429');
  });

  it('makes no request at all when translate produces no clauses', async () => {
    // Unlike DOAJ's, this guard needs `openAccessOnly` off to fire: with it on,
    // `translate` always emits the open-access clause, so an empty query is
    // still an expressible search — for every open-access paper PubMed holds.
    // That is pre-existing behaviour and not something pagination changes; what
    // matters here is that the guard runs before the read, so pagination never
    // begins on a query there is nothing to page through.
    const result = await search(query({}), {
      pageSize: 600,
      offset: 0,
      timeoutMs: 1000,
      openAccessOnly: false
    });

    expect(result.papers).toEqual([]);
    expect(fetchPage).not.toHaveBeenCalled();
  });
});
