import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Query } from '@open-access-explorer/shared';
import { countFacets, paced, type CountSpec, type ProviderFacetArgs } from '../count-facets';

/**
 * A facet bucket, for a provider that reports a total and nothing finer, is
 * the total of a narrower query. These pin the arithmetic that turns those
 * totals into facets, and the two ways it saves requests: a count the search
 * already reported is not asked again, and one native query is asked once.
 */

const query = (over: Partial<Query> = {}): Query => ({ terms: ['ai'], phrases: [], join: 'AND', ...over });

/** A native query that says what was asked, so a fake can answer by it. */
const native = (q: Query): string =>
  `ai|${q.years ? `${q.years.from}-${q.years.to}` : '*'}|${q.stages?.join('+') ?? '*'}`;

function spec(counts: Record<string, number | Error>, over: Partial<CountSpec> = {}): CountSpec & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    holds: ['preprint', 'published', 'unknown'],
    translate: native,
    count: async q => {
      const key = native(q);
      asked.push(key);
      const answer = counts[key];
      if (answer instanceof Error) throw answer;
      return answer ?? 0;
    },
    pace: { burst: 100, perSecond: 100 },
    ...over
  };
}

const args = (over: Partial<ProviderFacetArgs> = {}): ProviderFacetArgs => ({
  requests: [],
  years: [2026, 2025, 2024],
  openAccessOnly: true,
  timeoutMs: 1000,
  ...over
});

describe('countFacets', () => {
  it('counts a year as the query bounded to that year', async () => {
    const s = spec({ 'ai|2026-2026|*': 40, 'ai|2025-2025|*': 30, 'ai|2024-2024|*': 20 });
    const { facets, failures } = await countFacets(args({ requests: [{ facet: 'year', query: query() }] }), s);

    expect(facets.year).toEqual([
      { value: 2026, count: 40 },
      { value: 2025, count: 30 },
      { value: 2024, count: 20 }
    ]);
    expect(failures).toEqual([]);
  });

  it('counts only the years inside the query’s own bound', async () => {
    const s = spec({ 'ai|2025-2025|*': 30 });
    await countFacets(args({ requests: [{ facet: 'year', query: query({ years: { from: 2025, to: 2025 } }) }] }), s);

    expect(s.asked).toEqual(['ai|2025-2025|*']);
  });

  it('counts a stage as the query narrowed to it, and never counts unknown', async () => {
    const s = spec({ 'ai|*|preprint': 5, 'ai|*|published': 95 });
    const { facets } = await countFacets(args({ requests: [{ facet: 'stage', query: query() }] }), s);

    expect(facets.stage).toEqual([{ value: 'preprint', count: 5 }, { value: 'published', count: 95 }]);
    expect(s.asked).not.toContain('ai|*|unknown');
  });

  it('takes a single-stage provider’s stage from the total the search reported', async () => {
    // arXiv is all preprints: its stage bucket is its total, which the search
    // already has. Asking again would spend arXiv's three seconds on it.
    const s = spec({}, { holds: ['preprint'] });
    const { facets } = await countFacets(
      args({ requests: [{ facet: 'stage', query: query() }], known: new Map([['ai|*|*', 60248]]) }),
      s
    );

    expect(facets.stage).toEqual([{ value: 'preprint', count: 60248 }]);
    expect(s.asked).toEqual([]);
  });

  it('asks one native query once, however many buckets it answers', async () => {
    // The year facet under a query already bounded to 2025, and the stage
    // facet of a provider holding one stage under that same query, are the
    // same request.
    const bounded = query({ years: { from: 2025, to: 2025 } });
    const s = spec({ 'ai|2025-2025|*': 30 }, { holds: ['published'] });
    const { facets } = await countFacets(
      args({ requests: [{ facet: 'year', query: bounded }, { facet: 'stage', query: bounded }] }),
      s
    );

    expect(s.asked).toEqual(['ai|2025-2025|*']);
    expect(facets.year).toEqual([{ value: 2025, count: 30 }]);
    expect(facets.stage).toEqual([{ value: 'published', count: 30 }]);
  });

  it('keeps the counts that arrived when some fail, and says which failed', async () => {
    const s = spec({ 'ai|2026-2026|*': 40, 'ai|2025-2025|*': new Error('429'), 'ai|2024-2024|*': 20 });
    const { facets, failures } = await countFacets(args({ requests: [{ facet: 'year', query: query() }] }), s);

    expect(facets.year).toEqual([{ value: 2026, count: 40 }, { value: 2024, count: 20 }]);
    expect(failures).toEqual(['429']);
  });

  it('tells "counted, and none" from "not counted"', async () => {
    const none = await countFacets(args({ requests: [{ facet: 'year', query: query() }] }), spec({}));
    expect(none.facets.year).toEqual([]);

    const failed = await countFacets(
      args({ requests: [{ facet: 'year', query: query({ years: { from: 2026, to: 2026 } }) }] }),
      spec({ 'ai|2026-2026|*': new Error('down') })
    );
    expect(failed.facets).not.toHaveProperty('year');
  });

  it('asks nothing for a facet with no query per value', async () => {
    const s = spec({});
    const { facets } = await countFacets(args({ requests: [{ facet: 'venue', query: query() }] }), s);

    expect(s.asked).toEqual([]);
    expect(facets).not.toHaveProperty('venue');
  });

  it('asks nothing for a query the provider would not send', async () => {
    const s = spec({}, { translate: () => '' });
    await countFacets(args({ requests: [{ facet: 'year', query: query() }] }), s);

    expect(s.asked).toEqual([]);
  });
});

describe('paced', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('starts a burst at once and the rest on the interval', async () => {
    vi.useFakeTimers();
    const started: number[] = [];
    const t0 = Date.now();
    const task = () => async () => { started.push(Date.now() - t0); return 1; };

    const done = paced([task(), task(), task(), task()], { burst: 2, perSecond: 2 });
    await vi.runAllTimersAsync();
    await done;

    expect(started).toEqual([0, 0, 500, 1000]);
  });

  it('settles every task, failed or not', async () => {
    const results = await paced(
      [async () => 1, async () => { throw new Error('no'); }],
      { burst: 2, perSecond: 1 }
    );

    expect(results.map(r => r.status)).toEqual(['fulfilled', 'rejected']);
  });
});
