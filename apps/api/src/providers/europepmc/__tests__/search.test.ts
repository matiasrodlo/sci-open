import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Query } from '@open-access-explorer/shared';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
// Resolved responses throughout, as the pooled client delivers them — its
// `validateStatus: status < 500` resolves a 4xx rather than throwing.
vi.mock('../../../lib/http-client-factory', () => ({ getPooledClient: () => ({ get }) }));

import { search } from '../index';

const query = (over: Partial<Query> = {}): Query => ({ terms: ['crispr'], phrases: [], join: 'AND', ...over });

const record = (id: string) => ({ id, source: 'MED', title: `Paper ${id}`, pubYear: '2022' });

/** The ids a batch query asks for, read back out of its `EXT_ID:"…" OR …` form. */
const idsIn = (q: string) => [...q.matchAll(/EXT_ID:"([^"]+)"/g)].map(m => m[1]!);

/**
 * A corpus of `size` records, ids `1`..`size` in rank order. The id list is
 * answered from it, and each by-id batch with its records *reversed* — Europe
 * PMC does not promise to answer an `OR` in the order it was asked, so nothing
 * here may rely on it.
 */
function corpus(size: number, { drop = [] as string[], failBatch = -1 } = {}) {
  const ids = Array.from({ length: size }, (_, i) => String(i + 1));
  let batch = 0;
  get.mockImplementation(async (_path: string, { params }: any) => {
    if (params.resultType === 'idlist') {
      return {
        status: 200,
        data: {
          hitCount: size,
          resultList: { result: ids.slice(0, params.pageSize).map(id => ({ id, source: 'MED' })) }
        }
      };
    }
    if (batch++ === failBatch) return { status: 429, data: {} };
    const asked = idsIn(params.query).filter(id => !drop.includes(id));
    return { status: 200, data: { hitCount: asked.length, resultList: { result: asked.map(record).reverse() } } };
  });
}

const run = (pageSize: number, offset = 0) =>
  search(query(), { pageSize, offset, timeoutMs: 1000, openAccessOnly: true });

const calls = () => get.mock.calls.map(([, config]) => config.params);
const batchCalls = () => calls().filter(p => p.resultType === 'core');

beforeEach(() => {
  get.mockReset();
});

describe('search — an id list, then the records by id', () => {
  it('asks for the ranked id list first, at the full depth', async () => {
    corpus(5000);

    await run(600);

    expect(calls()[0]).toMatchObject({ resultType: 'idlist', pageSize: 600 });
    expect(calls()[0].query).toContain('TITLE_ABS:crispr');
  });

  it('fetches 600 records as eight batches of 75', async () => {
    corpus(5000);

    await run(600);

    expect(batchCalls()).toHaveLength(8);
    expect(batchCalls().map(p => p.pageSize)).toEqual([75, 75, 75, 75, 75, 75, 75, 75]);
    expect(idsIn(batchCalls()[0].query)).toEqual(Array.from({ length: 75 }, (_, i) => String(i + 1)));
  });

  it('grows the batches rather than their number, to stay inside the throttle', async () => {
    // 10 requests a second, 500 a minute. A deeper read must not become a
    // bigger burst.
    corpus(5000);

    await run(1000);

    expect(batchCalls()).toHaveLength(8);
    expect(batchCalls()[0].pageSize).toBe(125);
  });

  it('costs one batch for a small result set', async () => {
    corpus(40);

    const { papers } = await run(600);

    expect(papers).toHaveLength(40);
    expect(batchCalls()).toHaveLength(1);
  });

  it('asks for nothing more when the list is empty', async () => {
    corpus(0);

    const { papers, totalHits } = await run(600);

    expect(papers).toEqual([]);
    expect(totalHits).toBe(0);
    expect(batchCalls()).toHaveLength(0);
  });

  it('keeps the id list\'s order, not the order a batch answered in', async () => {
    corpus(5000);

    const { papers } = await run(300);

    expect(papers.slice(0, 3).map(p => p.id)).toEqual(['europepmc:1', 'europepmc:2', 'europepmc:3']);
    expect(papers.map(p => p.sources[0]!.rank)).toEqual(Array.from({ length: 300 }, (_, i) => i));
  });

  it('reports the corpus-wide count from the id list', async () => {
    corpus(5000);

    expect((await run(600)).totalHits).toBe(5000);
  });

  it('sends neither page nor sortBy, which Europe PMC ignores', async () => {
    corpus(5000);

    await run(600);

    for (const params of calls()) {
      expect(params).not.toHaveProperty('page');
      expect(params).not.toHaveProperty('sortBy');
    }
  });
});

describe('search — what a short read looks like', () => {
  it('reports a listed record that did not come back, and keeps the ranks after it', async () => {
    corpus(200, { drop: ['5'] });

    const { papers, skipped } = await run(200);

    expect(papers).toHaveLength(199);
    expect(skipped).toEqual([
      { index: 4, nativeId: '5', reason: 'in the id list, but not returned when fetched by id' }
    ]);
    expect(papers.find(p => p.id === 'europepmc:6')!.sources[0]!.rank).toBe(5);
  });

  it('fails the read when a batch fails, rather than reporting a short one as whole', async () => {
    corpus(5000, { failBatch: 3 });

    await expect(run(600)).rejects.toThrow('HTTP 429');
  });
});

describe('search — an offset', () => {
  it('takes it from the id list, since Europe PMC has no parameter for one', async () => {
    corpus(5000);

    const { papers } = await run(100, 200);

    expect(calls()[0]).toMatchObject({ resultType: 'idlist', pageSize: 300 });
    expect(papers[0]!.id).toBe('europepmc:201');
    expect(papers[0]!.sources[0]!.rank).toBe(200);
  });

  it('reaches no deeper than the id list can', async () => {
    corpus(5000);

    await run(600, 800);

    expect(calls()[0].pageSize).toBe(1000);
  });
});
