import { describe, it, expect } from 'vitest';
import type { CountedFacet, Paper, ProviderId, Query } from '@open-access-explorer/shared';
import { countSourceFacets, yearWindow } from '../source-facets';
import type { ProviderSettled } from '../fanout';
import type { ProviderEntry, ProviderFacetArgs, ProviderFacetOutcome } from '../registry';
import { ProviderCache } from '../provider-cache';
import { paper, ref } from './helpers';

const query = (over: Partial<Query> = {}): Query => ({ terms: ['ai'], phrases: [], join: 'AND', ...over });

type Fake = ProviderEntry & { calls: ProviderFacetArgs[] };

function provider(
  id: ProviderId,
  answer: (args: ProviderFacetArgs) => Promise<ProviderFacetOutcome>,
  over: Partial<ProviderEntry> = {},
  facets: CountedFacet[] = ['year', 'stage']
): Fake {
  const calls: ProviderFacetArgs[] = [];
  return {
    id,
    calls,
    capabilities: {
      keywordSearch: true, fieldedSearch: true, doiLookup: true, fields: [], yearFilter: true,
      maxPageSize: 100, reportsTotal: true, suppliesCitations: false,
      stages: { holds: ['preprint', 'published', 'unknown'], filter: true },
      facets
    },
    translate: q => `native:${q.years?.from ?? '*'}`,
    normalizerVersion: 1,
    search: async () => ({ papers: [], skipped: [] }),
    facets: args => {
      calls.push(args);
      return answer(args);
    },
    ...over
  };
}

const counted = (year: number, count: number): ProviderFacetOutcome =>
  ({ facets: { year: [{ value: year, count }] }, failures: [] });

const settled = (id: ProviderId, papers: Paper[], totalHits: number): ProviderSettled => ({
  papers,
  report: { provider: id, status: 'ok', retrieved: papers.length, totalHits, latency: 1 }
});

const options = (over: Partial<Parameters<typeof countSourceFacets>[1]> = {}) => ({
  queries: { year: query(), stage: query() },
  searched: query(),
  settled: async () => undefined,
  openAccessOnly: true,
  budgetMs: 1000,
  now: () => new Date('2026-09-25T00:00:00Z'),
  ...over
});

describe('yearWindow', () => {
  it('is the ten years up to now, newest first', () => {
    expect(yearWindow(undefined, new Date('2026-06-01'))).toEqual(
      [2026, 2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017]
    );
  });

  it('stays inside the query’s bound', () => {
    expect(yearWindow(query({ years: { from: 2020, to: 2022 } }), new Date('2026-06-01'))).toEqual([2022, 2021, 2020]);
    expect(yearWindow(query({ years: { from: 2025 } }), new Date('2026-06-01'))).toEqual([2026, 2025]);
  });
});

describe('countSourceFacets', () => {
  it('asks a provider that aggregates without waiting for its search', async () => {
    const aggregate = provider('openalex', async () => counted(2026, 424757), { facetsAggregate: true });
    const results = await countSourceFacets([aggregate], options({ settled: () => new Promise(() => {}) }));

    expect(results).toEqual([{ provider: 'openalex', facets: { year: [{ value: 2026, count: 424757 }] } }]);
  });

  it('hands a count-by-count provider the total its search reported', async () => {
    const counter = provider('ncbi', async () => counted(2026, 10));
    await countSourceFacets([counter], options({ settled: async () => settled('ncbi', [], 3250) }));

    expect(counter.calls[0]!.known).toEqual(new Map([['native:*', 3250]]));
  });

  it('counts the records in hand when the search read everything the provider matched', async () => {
    // Exact, free, and it covers a facet the provider could not have counted.
    const papers = [
      paper({ id: 'a', year: 2024, venue: 'Malaria Journal', sources: [ref('arxiv')] }),
      paper({ id: 'b', year: 2023, venue: 'Malaria Journal', sources: [ref('arxiv')] })
    ];
    const counter = provider('arxiv', async () => counted(2026, 1), {}, ['year', 'venue']);
    const results = await countSourceFacets(
      [counter],
      options({ queries: { year: query(), venue: query() }, settled: async () => settled('arxiv', papers, 2) })
    );

    expect(counter.calls).toEqual([]);
    expect(results[0]!.facets.year).toEqual([{ value: 2024, count: 1 }, { value: 2023, count: 1 }]);
    expect(results[0]!.facets.venue).toEqual([{ value: 'Malaria Journal', count: 2 }]);
  });

  it('still asks for a facet counted under a different query than the search', async () => {
    // The year facet with its ticked year lifted is not the query that was read.
    const counter = provider('arxiv', async () => counted(2021, 7));
    const results = await countSourceFacets([counter], options({
      queries: { year: query(), stage: query({ years: { from: 2024, to: 2024 } }) },
      searched: query({ years: { from: 2024, to: 2024 } }),
      settled: async () => settled('arxiv', [paper({ year: 2024, sources: [ref('arxiv')] })], 1)
    }));

    expect(counter.calls[0]!.requests.map(r => r.facet)).toEqual(['year']);
    expect(results[0]!.facets.year).toEqual([{ value: 2021, count: 7 }]);
  });

  it('reports a provider whose counts failed, keeping what it has', async () => {
    const failing = provider('doaj', async () => { throw new Error('HTTP 429'); });
    const partial = provider('ncbi', async () => ({ ...counted(2026, 5), failures: ['rate limit', 'rate limit'] }));

    const results = await countSourceFacets([failing, partial], options({
      settled: async id => settled(id, [], 100)
    }));

    expect(results).toEqual([
      { provider: 'doaj', facets: {}, error: 'HTTP 429' },
      { provider: 'ncbi', facets: { year: [{ value: 2026, count: 5 }] }, error: '2 counts failed: rate limit' }
    ]);
  });

  it('gives up on a provider whose search outlasts the budget', async () => {
    const counter = provider('europepmc', async () => counted(2026, 5));
    const results = await countSourceFacets([counter], options({
      budgetMs: 20,
      settled: () => new Promise(resolve => setTimeout(() => resolve(settled('europepmc', [], 9)), 200))
    }));

    expect(counter.calls).toEqual([]);
    expect(results).toEqual([{ provider: 'europepmc', facets: {}, error: 'no time left to count in' }]);
  });

  it('does not ask a provider that holds none of the types asked for', async () => {
    const preprintsOnly = provider('arxiv', async () => counted(2026, 5), {
      capabilities: { ...provider('arxiv', async () => counted(0, 0)).capabilities, stages: { holds: ['preprint'], filter: false } }
    });
    const results = await countSourceFacets([preprintsOnly], options({
      queries: { year: query({ stages: ['published'] }) }
    }));

    expect(preprintsOnly.calls).toEqual([]);
    expect(results).toEqual([]);
  });

  it('serves a repeat from the cache, but not a partial answer', async () => {
    const cache = new ProviderCache();
    let failures: string[] = ['429'];
    const counter = provider('openalex', async () => ({ ...counted(2026, 5), failures }), { facetsAggregate: true });

    await countSourceFacets([counter], options({ cache }));
    await countSourceFacets([counter], options({ cache }));
    expect(counter.calls).toHaveLength(2);

    failures = [];
    await countSourceFacets([counter], options({ cache }));
    await countSourceFacets([counter], options({ cache }));
    expect(counter.calls).toHaveLength(3);
  });
});
