import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Query } from '@open-access-explorer/shared';

const { fetchPage } = vi.hoisted(() => ({ fetchPage: vi.fn() }));

// Module scope, not inside a describe: `vi.mock`'s factory is hoisted above
// everything else in the file, so a binding declared in a block would not be
// initialised by the time the factory runs.
vi.mock('../fetch', () => ({
  fetchPage,
  OpenAireUnavailableError: class extends Error {}
}));

import { search } from '../index';

const query = (over: Partial<Query>): Query => ({ terms: [], phrases: [], join: 'AND', ...over });

const result = (n: number) => ({
  header: { 'dri:objIdentifier': { $: `od______1234::${n}` } },
  metadata: {
    'oaf:entity': {
      'oaf:result': {
        title: { $: `Paper ${n}` },
        creator: [{ $: 'Lovelace, A.' }],
        dateofacceptance: { $: '2022-01-01' },
        children: { instance: [{ webresource: [{ url: { $: `https://example.org/${n}.pdf` } }] }] }
      }
    }
  }
});

/** Wrapped as OpenAIRE wraps it: `response.results.result`, with a header total. */
const payload = (records: unknown[], total: number) => ({
  response: {
    header: { total: { $: total } },
    // A single-element list comes back as a bare object, not an array — the
    // quirk `asArray` exists for, and the one a page-concatenating read has to
    // survive on the way *out* of a payload as well as into one.
    results: { result: records.length === 1 ? records[0] : records }
  }
});

const corpus = (size: number) =>
  fetchPage.mockImplementation(async (_params: any, { pageSize, offset }: any) =>
    payload(
      Array.from({ length: Math.max(Math.min(pageSize, size - offset), 0) }, (_, i) =>
        result(offset + i)
      ),
      size
    )
  );

const run = (pageSize: number, offset = 0) =>
  search(query({ terms: ['crispr'] }), { pageSize, offset, timeoutMs: 1000, openAccessOnly: true });

beforeEach(() => {
  fetchPage.mockReset();
});

/**
 * `fanOut` asks each provider once, for `depth` records — 600 by default — and
 * OpenAIRE serves at most 100 per page. So a search retrieved 100 and had it
 * recorded as a complete read. See `providers/read-pages.ts`.
 */
describe('search — pagination across the 100-record cap', () => {
  it('reads the full requested depth rather than one page', async () => {
    corpus(5000);

    const { papers } = await run(600);

    expect(papers).toHaveLength(600);
    expect(fetchPage).toHaveBeenCalledTimes(6);
  });

  it('asks each page for its own offset, at the cap', async () => {
    corpus(5000);

    await run(600);

    expect(fetchPage.mock.calls.map(([, o]) => o.offset)).toEqual([0, 100, 200, 300, 400, 500]);
    expect(fetchPage.mock.calls.map(([, o]) => o.pageSize)).toEqual([100, 100, 100, 100, 100, 100]);
  });

  it('ranks the concatenated pages contiguously', async () => {
    corpus(5000);

    const { papers } = await run(300);

    expect(papers[0]!.sources[0]!.rank).toBe(0);
    expect(papers[100]!.sources[0]!.rank).toBe(100);
    expect(papers[299]!.sources[0]!.rank).toBe(299);
  });

  it('reports the corpus-wide total, not the number of pages read', async () => {
    corpus(5000);

    expect((await run(600)).totalHits).toBe(5000);
  });

  it('costs one request when the query fits in a page', async () => {
    corpus(40);

    const { papers } = await run(600);

    expect(papers).toHaveLength(40);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('reads only the pages the total says exist', async () => {
    corpus(250);

    const { papers } = await run(600);

    expect(papers).toHaveLength(250);
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it('handles a page that carries one record as a bare object', async () => {
    // 201 records across pages of 100 makes the third page a single record,
    // which OpenAIRE serves unwrapped. Concatenating that without `asArray`
    // spreads the object's own keys instead of appending the record.
    corpus(201);

    const { papers } = await run(600);

    expect(papers).toHaveLength(201);
    expect(papers[200]!.sources[0]!.rank).toBe(200);
  });

  it('fails the read when a page fails, rather than reporting a short one as whole', async () => {
    fetchPage.mockImplementation(async (_params: any, { pageSize, offset }: any) => {
      if (offset === 200) throw new Error('OpenAIRE 503');
      return payload(
        Array.from({ length: pageSize }, (_, i) => result(offset + i)),
        5000
      );
    });

    await expect(run(600)).rejects.toThrow('OpenAIRE 503');
  });
});
