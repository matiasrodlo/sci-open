import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Query } from '@open-access-explorer/shared';

const { fetchPage } = vi.hoisted(() => ({ fetchPage: vi.fn() }));

// Module scope, not inside a describe: `vi.mock`'s factory is hoisted above
// everything else in the file, so a binding declared in a block would not be
// initialised by the time the factory runs.
vi.mock('../fetch', () => ({
  fetchPage,
  OpenAlexUnavailableError: class extends Error {}
}));

import { search } from '../index';

const query = (over: Partial<Query>): Query => ({ terms: [], phrases: [], join: 'AND', ...over });

const work = (id: string) => ({
  id: `https://openalex.org/${id}`,
  title: `Paper ${id}`,
  authorships: [],
  publication_year: 2022,
  primary_location: { source: {} },
  open_access: { oa_status: 'gold' },
  type: 'article'
});

const page = (from: number, n: number) => ({
  results: Array.from({ length: n }, (_, i) => work(`W${from + i}`)),
  meta: { count: 12345 }
});

const fullPages = () =>
  fetchPage.mockImplementation(async (_params: any, o: any) => page(o.offset, 200));

const run = (pageSize: number, offset = 0) =>
  search(query({ terms: ['crispr'] }), { pageSize, offset, timeoutMs: 1000 });

// The braces matter. `mockClear()` returns the mock, and an arrow with an
// expression body returns it too — which Vitest reads as a teardown callback
// and duly invokes after each test, calling the mock with no arguments. The
// implementation then throws on the missing argument and fails the test that
// installed it.
beforeEach(() => {
  fetchPage.mockClear();
});

/**
 * `fanOut` asks each provider once, and OpenAlex caps a page at 200, so a
 * depth of 600 was returning 200 where the old path's `discoverWorks`
 * paginated to 600. Measured across a 22-query sweep: 12,000 records against
 * 4,200, and the only part of the two paths' count gap that was lost coverage
 * rather than a deliberate decision.
 */
describe('search — pagination across the 200-record cap', () => {
  it('issues one request per 200 records asked for', async () => {
    fullPages();
    const r = await run(600);

    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(fetchPage.mock.calls.map((c: any) => c[1].offset)).toEqual([0, 200, 400]);
    expect(r.papers).toHaveLength(600);
  });

  it('makes a single request when one page is enough', async () => {
    fetchPage.mockImplementation(async (_p: any, o: any) => page(o.offset, 50));
    await run(50);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('asks every page for a full 200, because the page number derives from the offset', async () => {
    // Sizing the last request to the remainder would send `offset=400,
    // pageSize=100`, which `fetchPage` turns into page 5 rather than page 3.
    fullPages();
    await run(500);
    expect(fetchPage.mock.calls.every((c: any) => c[1].pageSize === 200)).toBe(true);
  });

  it('trims the surplus rather than returning a whole extra page', async () => {
    fullPages();
    expect((await run(500)).papers).toHaveLength(500);
  });

  it('keeps ranks continuous across the page boundary', async () => {
    fullPages();
    const ranks = (await run(400)).papers.map(p => p.sources[0].rank);
    expect([ranks[0], ranks[199], ranks[200], ranks[399]]).toEqual([0, 199, 200, 399]);
  });

  it('carries a caller offset into the page arithmetic', async () => {
    fullPages();
    await run(400, 600);
    expect(fetchPage.mock.calls.map((c: any) => c[1].offset)).toEqual([600, 800]);
  });

  it('reports the corpus-wide count once, not once per page', async () => {
    fullPages();
    expect((await run(400)).totalHits).toBe(12345);
  });

  it('returns what came back when the corpus runs out mid-read', async () => {
    // The pages go out together, so a short page cannot stop the ones already
    // in flight — it simply contributes fewer records. Fewer than asked for is
    // a real answer, not a failure.
    fetchPage.mockImplementation(async (_p: any, o: any) => page(o.offset, o.offset === 0 ? 200 : 30));

    const r = await run(600);
    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(r.papers).toHaveLength(260);
  });
});

describe('search — a failed page fails the read', () => {
  it('propagates rather than returning the pages that succeeded', async () => {
    // `ProviderReport` has no way to say "short by 400", so returning the
    // successful pages would report a partial read as a complete one — the
    // silent-shortfall failure this refactor exists to remove, and the shape
    // of the Europe PMC and arXiv defects it already fixed.
    fetchPage.mockImplementation(async (_p: any, o: any) => {
      if (o.offset === 400) throw new Error('OpenAlex 429: Insufficient budget');
      return page(o.offset, 200);
    });

    await expect(run(600)).rejects.toThrow(/Insufficient budget/);
  });

  it('propagates a first-page failure too', async () => {
    fetchPage.mockRejectedValue(new Error('OpenAlex 429: Insufficient budget'));
    await expect(run(600)).rejects.toThrow(/Insufficient budget/);
  });
});
